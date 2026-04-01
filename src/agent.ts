import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { createClient } from "./client.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { toolDefinitions, executeTool, setMaxOutputTokens } from "./tools/index.js";
import {
  createAccumulator,
  processChunk,
} from "./stream.js";
import { SessionManager } from "./session.js";
import { getImageDataUrl, buildImageMessageContent, buildImageInputContent } from "./image.js";
import {
  createUsageStats,
  extractUsageFromChatChunk,
  extractUsageFromResponse,
  accumulateUsage,
  formatUsage,
  type UsageStats,
} from "./usage.js";
import { runHooks } from "./hooks.js";
import { needsCompaction, compactConversation } from "./compaction.js";
import { formatApiError } from "./cli-errors.js";
import { collectResponseIncludes, serializeServerTools } from "./server-tools.js";
import { runLocalToolCalls } from "./tool-runner.js";
import {
  extractCitationsFromContent,
  extractServerToolUsage,
  getServerToolEvent,
  sanitizeResponseText,
} from "./response-utils.js";
import { augmentPromptWithMemory } from "./memory.js";
import { formatTask, listTasks } from "./tasks.js";
import {
  isJsonMode,
  emitSessionStarted,
  emitTurnStarted,
  emitTurnCompleted,
  emitServerToolCall,
  emitServerToolUsage,
  emitCitations,
  emitMemoryRecalled,
  emitMessage,
  emitError,
  emitSessionCompleted,
} from "./json-output.js";
import type {
  GrokConfig,
  ChatMessage,
  ToolDef,
  AgentOptions,
  SerializedToolCall,
  Citation,
  SessionEvent,
  SessionMeta,
} from "./types.js";

function logServerToolCall(config: GrokConfig, item: any): void {
  const event = getServerToolEvent(item);
  if (!event) return;
  emitServerToolCall(event.name, event.payload);
  if (config.showToolCalls && !isJsonMode()) {
    console.error(chalk.magenta(`  ◆ ${event.name}`) + chalk.dim(" (server-side)"));
  }
}

function logServerToolUsage(config: GrokConfig, response: any): void {
  const usage = extractServerToolUsage(response);
  if (!usage || typeof usage !== "object") return;
  emitServerToolUsage(usage);
  if (config.showServerToolUsage && !isJsonMode()) {
    const summary = Object.entries(usage)
      .map(([name, count]) => `${name}=${count}`)
      .join(", ");
    if (summary) {
      console.error(chalk.dim(`Server tools: ${summary}`));
    }
  }
}

function logMemoryRecall(
  recall: Awaited<ReturnType<typeof augmentPromptWithMemory>>["recall"],
  verbose: boolean,
): void {
  if (!recall || recall.entries.length === 0) return;

  emitMemoryRecalled({
    strategy: recall.strategy,
    entries: recall.entries.map((entry) => ({
      id: entry.id,
      scope: entry.scope,
      type: entry.type,
      title: entry.title,
      description: entry.description,
      updated: entry.updated,
    })),
  });

  if (verbose && !isJsonMode()) {
    const titles = recall.entries.map((entry) => entry.title).join(", ");
    console.error(chalk.dim(`Memory recall (${recall.strategy}): ${titles}`));
  }
}

async function preparePromptForTurn(
  config: GrokConfig,
  cwd: string,
  prompt: string,
  verbose: boolean,
): Promise<string> {
  const prepared = await augmentPromptWithMemory(config, cwd, prompt);
  logMemoryRecall(prepared.recall, verbose);
  return prepared.prompt;
}

function countTurns(messages: ChatMessage[]): number {
  return messages.filter((msg) => (msg as any).role === "user").length;
}

function sessionEventsFromMessages(meta: SessionMeta, messages: ChatMessage[]): SessionEvent[] {
  const events: SessionEvent[] = [
    { ts: meta.updated, type: "meta", meta },
  ];

  let turn = 0;
  for (const msg of messages) {
    const role = (msg as any).role;
    if (role === "user") turn++;

    const event: SessionEvent = {
      ts: new Date().toISOString(),
      type: "msg",
      role,
      turn: role === "system" ? undefined : turn,
      content: typeof (msg as any).content === "string" ? (msg as any).content : JSON.stringify((msg as any).content),
    };
    const toolCalls = (msg as any).tool_calls;
    if (toolCalls) {
      event.toolCalls = toolCalls.map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name || "",
        arguments: tc.function?.arguments || "",
      }));
    }
    const toolCallId = (msg as any).tool_call_id;
    if (toolCallId) event.toolCallId = toolCallId;
    events.push(event);
  }

  return events;
}

function rollbackConversationMessages(messages: ChatMessage[], turns: number): ChatMessage[] {
  if (turns <= 0) return messages;
  const system = messages[0];
  const rest = messages.slice(1);
  const turnGroups: ChatMessage[][] = [];
  let current: ChatMessage[] = [];

  for (const msg of rest) {
    if ((msg as any).role === "user") {
      if (current.length > 0) turnGroups.push(current);
      current = [msg];
    } else if (current.length > 0) {
      current.push(msg);
    }
  }
  if (current.length > 0) turnGroups.push(current);

  const kept = turnGroups.slice(0, Math.max(0, turnGroups.length - turns)).flat();
  return [system, ...kept];
}

function serializeClientToolDefinitions(tools: ToolDef[]): any[] {
  return tools.map((tool) => {
    const fn = (tool as any).function;
    if (!fn) return tool;
    return {
      type: "function",
      name: fn.name,
      description: fn.description,
      parameters: fn.parameters,
    };
  });
}

// ─── Chat Completions Agent Loop (streaming) ─────────────────────────────────

async function runChatLoop(
  config: GrokConfig,
  messages: ChatMessage[],
  options: AgentOptions,
  session: { manager: SessionManager; id: string } | null,
  toolSessionId: string,
): Promise<string> {
  const client = createClient(config);
  const tools: ToolDef[] = [...toolDefinitions];
  let turn = 0;
  const totalUsage = createUsageStats();
  let lastFingerprint: string | null = null;
  const jsonMode = isJsonMode();
  setMaxOutputTokens(config.maxOutputTokens);
  const showOutput = !jsonMode;

  // Add structured output if requested
  const extraParams: any = {};
  if (config.jsonSchema) {
    try {
      const schema = JSON.parse(config.jsonSchema);
      extraParams.response_format = {
        type: "json_schema",
        json_schema: { name: "output", schema, strict: true },
      };
    } catch {
      if (!jsonMode) console.error(chalk.yellow("Invalid JSON schema, ignoring --json-schema"));
    }
  }

  while (turn < options.maxTurns) {
    turn++;
    emitTurnStarted(turn);

    if (options.verbose && turn > 1 && !jsonMode) {
      console.error(chalk.dim(`\n--- turn ${turn} ---`));
    }

    // Auto-compact if conversation is getting long
    if (turn > 1 && needsCompaction(messages)) {
      messages = await compactConversation(config, messages);
    }

    const acc = createAccumulator();
    const turnUsage = createUsageStats();

    try {
      const stream = await client.chat.completions.create({
        model: config.model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: config.maxTokens,
        temperature: 0,
        ...extraParams,
      } as any);

      for await (const chunk of stream as any) {
        processChunk(acc, chunk, {
          showReasoning: options.showReasoning,
          showOutput,
        });
        extractUsageFromChatChunk(chunk, turnUsage);
        // Track fingerprint
        if (chunk?.system_fingerprint) lastFingerprint = chunk.system_fingerprint;
      }
    } catch (err: any) {
      if (err?.status === 429) {
        if (!jsonMode) console.error(chalk.yellow("\nRate limited. Waiting 5s..."));
        await sleep(5000);
        turn--;
        continue;
      }
      if (err?.status === 401) {
        emitError("Authentication failed");
        if (!jsonMode) console.error(chalk.red("\nAuth failed. Check XAI_API_KEY."));
        process.exit(1);
      }
      throw err;
    }

    accumulateUsage(totalUsage, turnUsage);
    emitTurnCompleted(turn, turnUsage);

    if (acc.toolCalls.length === 0) {
      if (showOutput && acc.content) process.stdout.write("\n");
      emitMessage(acc.content);
      if (session) {
        session.manager.appendMessage(session.id, "assistant", acc.content);
        session.manager.updateMeta(session.id, { turns: turn });
      }
      if (config.showUsage && !jsonMode) {
        console.error(formatUsage(config.model, totalUsage));
      }
      return acc.content;
    }

    // Tool calls
    const serializedCalls: SerializedToolCall[] = acc.toolCalls
      .filter(tc => tc.id && tc.function.name)
      .map(tc => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }));

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: acc.content || null,
      tool_calls: serializedCalls.map(tc => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    };
    messages.push(assistantMsg);

    if (session) {
      session.manager.appendMessage(session.id, "assistant", acc.content || null, {
        toolCalls: serializedCalls,
      });
    }

    if (showOutput && acc.content) process.stdout.write("\n");

    const executed = await runLocalToolCalls(serializedCalls, {
      config,
      cwd: options.cwd,
      verbose: options.verbose,
      showToolCalls: config.showToolCalls && !jsonMode,
      session,
      sessionId: toolSessionId,
    });

    for (const item of executed) {
      messages.push({ role: "tool", tool_call_id: item.call.id, content: item.result.output });
    }
  }

  if (!jsonMode) console.error(chalk.yellow(`\nMax turns (${options.maxTurns}) reached.`));
  if (config.showUsage && !jsonMode) console.error(formatUsage(config.model, totalUsage));
  if (lastFingerprint && options.verbose && !jsonMode) console.error(chalk.dim(`Fingerprint: ${lastFingerprint}`));
  return "";
}

// ─── Responses API Agent Loop ─────────────────────────────────────────────────

async function runResponsesLoop(
  config: GrokConfig,
  prompt: string,
  options: AgentOptions,
  session: { manager: SessionManager; id: string } | null,
  toolSessionId: string,
  previousResponseId?: string | null,
  imageUrls?: string[],
  fileIds?: string[],
): Promise<string> {
  const client = createClient(config);
  const cwd = options.cwd;
  const totalUsage = createUsageStats();
  let lastFingerprint: string | null = null;
  const jsonMode = isJsonMode();
  const showOutput = !jsonMode;
  setMaxOutputTokens(config.maxOutputTokens);

  // Build tools array
  const tools: any[] = [
    ...serializeServerTools(config.serverTools, config.mcpServers),
    ...serializeClientToolDefinitions(toolDefinitions),
  ];

  // Build input content
  const inputContent: any[] = [];
  if (imageUrls && imageUrls.length > 0) {
    for (const url of imageUrls) {
      inputContent.push(...buildImageInputContent(url, ""));
    }
  }
  if (fileIds && fileIds.length > 0) {
    for (const fid of fileIds) {
      inputContent.push({ type: "input_file", file_id: fid });
    }
  }
  inputContent.push({ type: "input_text", text: prompt });

  // Build initial input
  const input: any[] = [];
  if (!previousResponseId) {
    input.push({ role: "system", content: buildSystemPrompt(cwd, config) });
  }
  input.push({
    role: "user",
    content: inputContent.length === 1 ? prompt : inputContent,
  });

  let turn = 0;
  let currentResponseId = previousResponseId || undefined;

  while (turn < options.maxTurns) {
    turn++;
    emitTurnStarted(turn);
    if (options.verbose && turn > 1 && !jsonMode) {
      console.error(chalk.dim(`\n--- turn ${turn} ---`));
    }

    try {
      const reqParams: any = {
        model: config.model,
        input: turn === 1 ? input : input,
        tools: tools.length > 0 ? tools : undefined,
        store: true,
      };
      const responseIncludes = collectResponseIncludes(config.serverTools, config.includeToolOutputs);
      if (responseIncludes.length > 0) reqParams.include = responseIncludes;
      if (currentResponseId) reqParams.previous_response_id = currentResponseId;
      if (config.jsonSchema) {
        try {
          reqParams.text = {
            format: {
              type: "json_schema",
              name: "output",
              schema: JSON.parse(config.jsonSchema),
              strict: true,
            },
          };
        } catch { /* ignore invalid schema */ }
      }

      const response: any = await (client as any).responses.create(reqParams);
      currentResponseId = response.id;
      if (response?.system_fingerprint) lastFingerprint = response.system_fingerprint;
      logServerToolUsage(config, response);

      // Track usage
      const turnUsage = createUsageStats();
      extractUsageFromResponse(response, turnUsage);
      accumulateUsage(totalUsage, turnUsage);
      emitTurnCompleted(turn, turnUsage);

      if (session) {
        session.manager.updateMeta(session.id, {
          lastResponseId: currentResponseId || null,
          turns: turn,
        });
      }

      // Process output
      const functionCalls: any[] = [];
      let textContent = "";
      const citations: Citation[] = [];

      for (const item of response.output) {
        if (item.type === "message") {
          for (const part of item.content) {
            if (part.type === "output_text" || part.type === "text") {
              const cleanedText = sanitizeResponseText(part.text || "");
              if (!cleanedText) continue;
              textContent += cleanedText;
              if (showOutput) process.stdout.write(cleanedText);
            }
          }
          citations.push(...extractCitationsFromContent(item.content || []));
        } else if (item.type === "function_call") {
          functionCalls.push(item);
        } else if (getServerToolEvent(item)) {
          logServerToolCall(config, item);
        }
      }

      // Display citations
      if (config.showCitations && citations.length > 0) {
        if (jsonMode) {
          emitCitations(citations.slice(0, 10));
        } else {
          console.error(chalk.dim("\n\nSources:"));
          for (const c of citations.slice(0, 10)) {
            console.error(chalk.dim(`  ${c.title || c.url}`));
            if (c.title) console.error(chalk.dim(`    ${c.url}`));
          }
        }
      }

      if (functionCalls.length === 0) {
        if (showOutput && textContent) process.stdout.write("\n");
        emitMessage(textContent);
        if (session) session.manager.appendMessage(session.id, "assistant", textContent);
        if (config.showUsage && !jsonMode) console.error(formatUsage(config.model, totalUsage));
        if (lastFingerprint && options.verbose && !jsonMode) console.error(chalk.dim(`Fingerprint: ${lastFingerprint}`));
        return textContent;
      }

      // Execute client-side tools
      if (session) {
        session.manager.appendMessage(session.id, "assistant", textContent || null, {
          toolCalls: functionCalls.map((fc: any) => ({
            id: fc.call_id, name: fc.name, arguments: fc.arguments,
          })),
        });
      }

      if (showOutput && textContent) process.stdout.write("\n");

      const executed = await runLocalToolCalls(
        functionCalls.map((fc: any) => ({
          id: fc.call_id,
          name: fc.name,
          arguments: fc.arguments,
        })),
        {
          config,
          cwd,
          verbose: options.verbose,
          showToolCalls: config.showToolCalls && !jsonMode,
          session,
          sessionId: toolSessionId,
        },
      );

      const toolOutputs: any[] = [];
      for (const item of executed) {
        toolOutputs.push({
          type: "function_call_output",
          call_id: item.call.id,
          output: item.result.output,
        });
      }

      input.length = 0;
      input.push(...toolOutputs);

    } catch (err: any) {
      if (err?.status === 429) {
        if (!jsonMode) console.error(chalk.yellow("\nRate limited. Waiting 5s..."));
        await sleep(5000);
        turn--;
        continue;
      }
      if (err?.status === 401) {
        emitError("Authentication failed");
        if (!jsonMode) console.error(chalk.red("\nAuth failed. Check XAI_API_KEY."));
        process.exit(1);
      }
      // Fallback to chat.completions if Responses API unavailable
      if (err?.status === 404 || err?.message?.includes("responses")) {
        if (!jsonMode) {
          console.error(chalk.yellow("\nResponses API unavailable, falling back to chat.completions..."));
        }
        const msgs: ChatMessage[] = [
          { role: "system", content: buildSystemPrompt(cwd, config) },
          { role: "user", content: prompt },
        ];
        return runChatLoop(config, msgs, options, session, toolSessionId);
      }
      throw err;
    }
  }

  if (!jsonMode) console.error(chalk.yellow(`\nMax turns (${options.maxTurns}) reached.`));
  if (config.showUsage && !jsonMode) console.error(formatUsage(config.model, totalUsage));
  if (lastFingerprint && options.verbose && !jsonMode) console.error(chalk.dim(`Fingerprint: ${lastFingerprint}`));
  return "";
}

// ─── File Upload Helper ──────────────────────────────────────────────────────

async function uploadFiles(config: GrokConfig, cwd: string): Promise<string[]> {
  if (config.fileAttachments.length === 0) return [];

  const client = createClient(config);
  const fileIds: string[] = [];
  const jsonMode = isJsonMode();

  for (const filePath of config.fileAttachments) {
    const resolved = path.resolve(cwd, filePath);
    if (!fs.existsSync(resolved)) {
      if (!jsonMode) console.error(chalk.yellow(`File not found, skipping: ${filePath}`));
      continue;
    }
    try {
      if (!jsonMode) console.error(chalk.dim(`  Uploading ${filePath}...`));
      const file = await (client as any).files.create({
        file: fs.createReadStream(resolved),
        purpose: "assistants",
      });
      fileIds.push(file.id);
      if (!jsonMode) console.error(chalk.dim(`  Uploaded: ${file.id}`));
    } catch (err: any) {
      if (!jsonMode) console.error(chalk.yellow(`Failed to upload ${filePath}: ${err.message}`));
    }
  }
  return fileIds;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function runAgent(
  config: GrokConfig,
  prompt: string,
  options: AgentOptions,
): Promise<string> {
  const rawPrompt = prompt;
  const sessionMgr = config.ephemeral ? null : new SessionManager(config.sessionDir);
  let sessionCtx: { manager: SessionManager; id: string } | null = null;
  let runtimeSessionId = `ephemeral-${Date.now().toString(36)}`;

  if (sessionMgr) {
    // Create or resume session
    if (options.sessionId && sessionMgr.sessionExists(options.sessionId)) {
      sessionCtx = { manager: sessionMgr, id: options.sessionId };
    } else {
      const meta = sessionMgr.createSession({
        model: config.model,
        cwd: options.cwd,
        name: options.sessionName || sessionMgr.autoName(rawPrompt),
      });
      sessionCtx = { manager: sessionMgr, id: meta.id };
      if (!isJsonMode()) console.error(chalk.dim(`Session: ${meta.id}`));
    }
    runtimeSessionId = sessionCtx.id;
    sessionMgr.appendMessage(sessionCtx.id, "user", rawPrompt);
  } else {
    if (options.sessionId && !isJsonMode()) {
      console.error(chalk.dim("(ephemeral mode ignores --resume/--fork state)"));
    }
    if (!isJsonMode()) console.error(chalk.dim("(ephemeral — no session saved)"));
  }

  runHooks(config.hooks, { type: "session-start", sessionId: runtimeSessionId });
  emitSessionStarted(runtimeSessionId, config.model);

  try {
    const requestPrompt = await preparePromptForTurn(config, options.cwd, rawPrompt, options.verbose);

    // Resolve image inputs
    const imageUrls: string[] = [];
    for (const img of config.imageInputs) {
      try {
        imageUrls.push(getImageDataUrl(img, options.cwd));
      } catch (err: any) {
        console.error(chalk.yellow(`Image error: ${err.message}`));
      }
    }

    // Upload files if any
    const fileIds = await uploadFiles(config, options.cwd);

    // Determine API mode
    const useResponses = config.useResponsesApi ||
      config.mcpServers.length > 0 ||
      config.serverTools.length > 0 ||
      fileIds.length > 0;

    if (useResponses) {
      let prevResponseId: string | null = null;
      if (sessionMgr && options.sessionId) {
        const loaded = sessionMgr.loadSession(options.sessionId);
        if (loaded?.meta.lastResponseId) prevResponseId = loaded.meta.lastResponseId;
      }
      return await runResponsesLoop(
        config,
        requestPrompt,
        options,
        sessionCtx,
        runtimeSessionId,
        prevResponseId,
        imageUrls,
        fileIds,
      );
    }

    // Default: chat.completions
    let messages: ChatMessage[];

    if (sessionMgr && options.sessionId) {
      const loaded = sessionMgr.loadSession(options.sessionId);
      if (loaded) {
        messages = loaded.messages;
        console.error(chalk.dim(`Resumed session with ${loaded.messages.length} messages`));
      } else {
        messages = [{ role: "system", content: buildSystemPrompt(options.cwd, config) }];
      }
    } else {
      messages = [{ role: "system", content: buildSystemPrompt(options.cwd, config) }];
      if (sessionCtx) {
        sessionCtx.manager.appendMessage(sessionCtx.id, "system", buildSystemPrompt(options.cwd, config));
      }
    }

    // Add image to user message if present
    if (imageUrls.length > 0) {
      const content = buildImageMessageContent(imageUrls[0], requestPrompt);
      messages.push({ role: "user", content } as any);
    } else {
      messages.push({ role: "user", content: requestPrompt });
    }

    return await runChatLoop(config, messages, options, sessionCtx, runtimeSessionId);
  } finally {
    runHooks(config.hooks, { type: "session-end", sessionId: runtimeSessionId });
    emitSessionCompleted(runtimeSessionId);
  }
}

export async function runInteractive(config: GrokConfig, options: AgentOptions): Promise<void> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: chalk.bold.blue("grok> "),
  });

  const sessionMgr = config.ephemeral ? null : new SessionManager(config.sessionDir);
  let sessionId: string | null = null;
  let conversationMessages: ChatMessage[];
  const showOutput = !isJsonMode();
  let activeModel = config.model;
  const runtimeSessionId = config.ephemeral
    ? `ephemeral-${Date.now().toString(36)}`
    : undefined;

  if (config.ephemeral) {
    if (options.sessionId && !isJsonMode()) {
      console.error(chalk.dim("(ephemeral mode ignores --resume)"));
    }
    conversationMessages = [{ role: "system", content: buildSystemPrompt(options.cwd, config) }];
    console.error(chalk.bold("Grok CLI") + chalk.dim(` (${activeModel}) — ephemeral`));
  } else if (sessionMgr && options.sessionId && sessionMgr.sessionExists(options.sessionId)) {
    const loaded = sessionMgr.loadSession(options.sessionId);
    if (loaded) {
      sessionId = loaded.meta.id;
      activeModel = loaded.meta.model || activeModel;
      conversationMessages = loaded.messages;
      console.error(
        chalk.bold("Grok CLI") + chalk.dim(` (${activeModel})`) +
        chalk.green(` — resumed ${sessionId}`)
      );
      console.error(chalk.dim(`Loaded ${loaded.messages.length} messages`));
    } else {
      const meta = sessionMgr.createSession({ model: config.model, cwd: options.cwd });
      sessionId = meta.id;
      conversationMessages = [{ role: "system", content: buildSystemPrompt(options.cwd, config) }];
      sessionMgr.appendMessage(sessionId, "system", buildSystemPrompt(options.cwd, config));
    }
  } else {
    if (!sessionMgr) {
      throw new Error("Interactive session storage is unavailable.");
    }
    const meta = sessionMgr.createSession({
      model: activeModel, cwd: options.cwd,
      name: options.sessionName || "Interactive session",
    });
    sessionId = meta.id;
    conversationMessages = [{ role: "system", content: buildSystemPrompt(options.cwd, config) }];
    sessionMgr.appendMessage(sessionId, "system", buildSystemPrompt(options.cwd, config));
    console.error(chalk.bold("Grok CLI") + chalk.dim(` (${activeModel}) — ${sessionId}`));
  }

  console.error(chalk.dim("Commands: /session /sessions /tasks /usage /name /model /archive /compact /rollback /files exit\n"));

  const totalUsage = createUsageStats();
  const hookSessionId = sessionId || runtimeSessionId || `ephemeral-${Date.now().toString(36)}`;

  runHooks(config.hooks, { type: "session-start", sessionId: hookSessionId });
  emitSessionStarted(hookSessionId, activeModel);

  try {
    rl.prompt();

    for await (const line of rl) {
      const input = line.trim();
      if (!input) { rl.prompt(); continue; }
      if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
        if (sessionId) console.error(chalk.dim(`Session saved: ${sessionId}`));
        else console.error(chalk.dim("Session ended (ephemeral)"));
        if (config.showUsage && totalUsage.totalTokens > 0) {
          console.error(formatUsage(activeModel, totalUsage));
        }
        break;
      }
      if (input === "/session") {
        if (sessionId) console.error(chalk.dim(`ID: ${sessionId} | Messages: ${conversationMessages.length}`));
        else console.error(chalk.dim(`Ephemeral | Messages: ${conversationMessages.length}`));
        rl.prompt(); continue;
      }
      if (input === "/sessions") {
        if (!sessionId) {
          console.error(chalk.dim("Ephemeral mode has no saved sessions."));
        } else {
          const sessions = sessionMgr!.listSessions();
          for (const s of sessions.slice(0, 10)) {
            const cur = s.id === sessionId ? chalk.green(" ←") : "";
            console.error(chalk.cyan(s.id) + chalk.dim(` ${s.name}`) + cur);
          }
        }
        rl.prompt(); continue;
      }
      if (input === "/usage") {
        console.error(formatUsage(activeModel, totalUsage));
        rl.prompt(); continue;
      }
      if (input === "/tasks") {
        const taskSessionId = sessionId || hookSessionId;
        const tasks = listTasks(config.sessionDir, taskSessionId);
        if (tasks.length === 0) {
          console.error(chalk.dim("No tasks."));
        } else {
          for (const task of tasks) {
            console.error(formatTask(task));
          }
        }
        rl.prompt(); continue;
      }
      if (input.startsWith("/name ")) {
        const nextName = input.slice("/name ".length).trim();
        if (!nextName) {
          console.error(chalk.yellow("Usage: /name <new session name>"));
        } else if (!sessionId || !sessionMgr) {
          console.error(chalk.dim("Ephemeral mode has no saved session to rename."));
        } else {
          sessionMgr.renameSession(sessionId, nextName);
          console.error(chalk.green(`Renamed session: ${nextName}`));
        }
        rl.prompt(); continue;
      }
      if (input === "/model") {
        console.error(chalk.dim(`Current model: ${activeModel}`));
        rl.prompt(); continue;
      }
      if (input.startsWith("/model ")) {
        activeModel = input.slice("/model ".length).trim() || activeModel;
        if (sessionId && sessionMgr) {
          sessionMgr.updateMeta(sessionId, { model: activeModel });
        }
        console.error(chalk.green(`Switched model: ${activeModel}`));
        rl.prompt(); continue;
      }
      if (input === "/archive") {
        if (!sessionId || !sessionMgr) {
          console.error(chalk.dim("Ephemeral mode has no saved session to archive."));
        } else if (sessionMgr.archiveSession(sessionId)) {
          console.error(chalk.green(`Archived session: ${sessionId}`));
        } else {
          console.error(chalk.red(`Unable to archive session: ${sessionId}`));
        }
        rl.prompt(); continue;
      }
      if (input === "/compact") {
        conversationMessages = await compactConversation(config, conversationMessages);
        if (sessionId && sessionMgr) {
          const loaded = sessionMgr.loadSession(sessionId);
          if (loaded) {
            loaded.meta.turns = countTurns(conversationMessages);
            loaded.meta.updated = new Date().toISOString();
            loaded.meta.model = activeModel;
            sessionMgr.rewriteSession(sessionId, sessionEventsFromMessages(loaded.meta, conversationMessages));
          }
        }
        console.error(chalk.green("Compacted conversation history."));
        rl.prompt(); continue;
      }
      if (input.startsWith("/rollback")) {
        const turnsToRollback = parseInt(input.split(/\s+/)[1] || "1", 10);
        if (Number.isNaN(turnsToRollback) || turnsToRollback < 1) {
          console.error(chalk.yellow("Usage: /rollback <num-turns>"));
        } else if (sessionId && sessionMgr) {
          if (sessionMgr.rollbackTurns(sessionId, turnsToRollback)) {
            const reloaded = sessionMgr.loadSession(sessionId);
            if (reloaded) conversationMessages = reloaded.messages;
            console.error(chalk.green(`Rolled back ${turnsToRollback} turn(s).`));
          } else {
            console.error(chalk.red("Rollback failed."));
          }
        } else {
          conversationMessages = rollbackConversationMessages(conversationMessages, turnsToRollback);
          console.error(chalk.green(`Rolled back ${turnsToRollback} turn(s) in ephemeral memory.`));
        }
        rl.prompt(); continue;
      }
      if (input.startsWith("/files ")) {
        const query = input.slice("/files ".length).trim();
        const result = await executeTool(
          "glob",
          JSON.stringify({ pattern: `**/*${query}*` }),
          options.cwd,
          { sandboxMode: config.sandboxMode },
        );
        console.error(result.output);
        rl.prompt(); continue;
      }

      // Auto-name
      const meta = sessionId && sessionMgr ? sessionMgr.loadSession(sessionId) : null;
      if (meta && sessionMgr && meta.meta.name === "Interactive session" && meta.meta.turns === 0) {
        sessionMgr.updateMeta(meta.meta.id, { name: sessionMgr.autoName(input) });
      }

      const requestInput = await preparePromptForTurn(config, options.cwd, input, options.verbose);
      conversationMessages.push({ role: "user", content: requestInput });
      if (sessionId && sessionMgr) sessionMgr.appendMessage(sessionId, "user", input);

      try {
        let turn = 0;
        while (turn < options.maxTurns) {
          turn++;
          emitTurnStarted(turn);

          if (turn > 1 && needsCompaction(conversationMessages)) {
            conversationMessages = await compactConversation(config, conversationMessages);
          }

          const acc = createAccumulator();
          const turnUsage = createUsageStats();
          const client = createClient(config);

          const stream = await client.chat.completions.create({
            model: activeModel,
            messages: conversationMessages,
            tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
            stream: true,
            max_tokens: config.maxTokens,
            temperature: 0,
          } as any);

          for await (const chunk of stream as any) {
            processChunk(acc, chunk, {
              showReasoning: options.showReasoning,
              showOutput,
            });
            extractUsageFromChatChunk(chunk, turnUsage);
          }

          accumulateUsage(totalUsage, turnUsage);
          emitTurnCompleted(turn, turnUsage);

          if (acc.toolCalls.length === 0) {
            if (showOutput && acc.content) {
              process.stdout.write("\n");
            }
            emitMessage(acc.content);
            if (acc.content) {
              conversationMessages.push({ role: "assistant", content: acc.content });
              if (sessionId && sessionMgr) {
                sessionMgr.appendMessage(sessionId, "assistant", acc.content);
                sessionMgr.updateMeta(sessionId, { turns: meta ? meta.meta.turns + turn : turn });
              }
            }
            if (config.showUsage) console.error(formatUsage(activeModel, turnUsage));
            break;
          }

          const serialized: SerializedToolCall[] = acc.toolCalls
            .filter(tc => tc.id && tc.function.name)
            .map(tc => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }));

          const aMsg: ChatMessage = {
            role: "assistant", content: acc.content || null,
            tool_calls: serialized.map(tc => ({
              id: tc.id, type: "function" as const,
              function: { name: tc.name, arguments: tc.arguments },
            })),
          };
          conversationMessages.push(aMsg);
          if (sessionId && sessionMgr) {
            sessionMgr.appendMessage(sessionId, "assistant", acc.content || null, { toolCalls: serialized });
          }

          if (showOutput && acc.content) process.stdout.write("\n");

          const executed = await runLocalToolCalls(serialized, {
            config,
            cwd: options.cwd,
            verbose: options.verbose,
            showToolCalls: config.showToolCalls,
            session: sessionId && sessionMgr ? { manager: sessionMgr, id: sessionId } : null,
            sessionId: sessionId || hookSessionId,
          });

          for (const item of executed) {
            conversationMessages.push({
              role: "tool",
              tool_call_id: item.call.id,
              content: item.result.output,
            });
          }
        }
      } catch (err: any) {
        const message = formatApiError("Request failed", err);
        emitError(message);
        if (!isJsonMode()) {
          console.error(chalk.red(`Error: ${message}`));
        }
      }

      console.error("");
      rl.prompt();
    }
  } finally {
    runHooks(config.hooks, { type: "session-end", sessionId: hookSessionId });
    emitSessionCompleted(hookSessionId, totalUsage.totalTokens > 0 ? totalUsage : undefined);
    rl.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
