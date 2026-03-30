#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { getConfig, MODELS } from "./config.js";
import { runAgent, runInteractive } from "./agent.js";
import { SessionManager } from "./session.js";
import { createClient } from "./client.js";
import {
  formatApiError,
  formatSessionDirError,
  getResponseErrorMessage,
  isNetworkError,
} from "./cli-errors.js";
import { emitError, isJsonMode, setJsonMode } from "./json-output.js";
import { setShowDiffs } from "./tools/edit-file.js";
import { approxTokenCount } from "./truncation.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { compactConversation } from "./compaction.js";
import {
  createCollection,
  deleteCollection,
  getCollection,
  listCollectionDocuments,
  listCollections,
  removeCollectionDocument,
  searchCollectionDocuments,
  updateCollection,
  uploadCollectionDocument,
} from "./collections-api.js";
import {
  addBatchRequests,
  buildBatchChatRequest,
  cancelBatch,
  createBatch,
  listBatchRequests,
  listBatchResults,
  listBatches,
  loadBatchRequestsFromJsonl,
  getBatch,
} from "./batch-api.js";
import {
  createRealtimeClientSecret,
  listVoices,
  streamTtsToFile,
} from "./voice-api.js";
import type {
  AgentOptions,
  GrokConfig,
  McpServer,
  ServerToolConfig,
  SessionEvent,
  SessionMeta,
  ToolApprovalMode,
} from "./types.js";

const VERSION = readVersion();

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8").trim();
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
      version?: string;
    };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command()
  .name("grok-agent")
  .description("A coding assistant CLI powered by xAI's Grok models")
  .version(VERSION);

program
  .option("-m, --model <model>", "Model to use")
  .option("--fast", "grok-4-1-fast-reasoning")
  .option("--reasoning", "grok-4.20-reasoning (flagship)")
  .option("--non-reasoning", "grok-4.20-non-reasoning")
  .option("--code", "grok-code-fast-1 (4x faster coding model)")
  .option("--research", "Multi-agent deep research (4-16 agents)")
  .option("-v, --verbose", "Detailed tool call output", false)
  .option("--show-reasoning", "Show thinking tokens", false)
  .option("--show-usage", "Show token usage and cost", false)
  .option("--show-diffs", "Show diffs on file edits (default: true)")
  .option("--no-diffs", "Hide file edit diffs")
  .option("--show-server-tool-usage", "Show server-side tool usage summary")
  .option("--no-tools", "Chat only")
  .option("--no-citations", "Hide sources")
  .option("--max-turns <n>", "Max agent turns")
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("-r, --resume <id>", "Resume session")
  .option("--fork <id>", "Fork a session (copy history, new session)")
  .option("-n, --name <name>", "Name this session")
  .option("--plan", "Plan mode: create a plan first, then execute")
  .option("--approve", "Ask before writes/exec (default: always-approve)")
  .option("--deny-writes", "Block all file writes and shell commands")
  .option("--yolo", "Skip all approvals (dangerous)")
  .option("--sandbox <mode>", "Sandbox mode: read-only, workspace-write, danger-full-access")
  .option("--ephemeral", "Don't save session to disk")
  .option("-o, --output <file>", "Write final message to file")
  .option("--json", "JSONL output mode (machine-readable, events on stdout)")
  .option("--color <mode>", "Color mode: auto, always, never", "auto")
  .option("--notify", "Desktop notification on completion")
  .option("--responses-api", "Force Responses API")
  .option("--web-search", "Enable web search")
  .option("--x-search", "Enable X/Twitter search")
  .option("--code-execution", "Enable Python sandbox")
  .option("--allow-domain <domains...>", "Restrict web search to these domains")
  .option("--exclude-domain <domains...>", "Exclude these domains from web search")
  .option("--search-images", "Enable image understanding during web search")
  .option("--x-allow <handles...>", "Restrict X search to these handles")
  .option("--x-exclude <handles...>", "Exclude these handles from X search")
  .option("--x-from <date>", "Start date for X search (YYYY-MM-DD)")
  .option("--x-to <date>", "End date for X search (YYYY-MM-DD)")
  .option("--x-images", "Enable image understanding during X search")
  .option("--x-videos", "Enable video understanding during X search")
  .option("--collection <ids...>", "Enable file search over collection id(s)")
  .option("--file-search-mode <mode>", "file search mode: keyword, semantic, hybrid")
  .option("--include-tool-outputs", "Request server-side tool outputs when supported")
  .option("--mcp <urls...>", "Connect to MCP server(s)")
  .option("--mcp-allow <entries...>", "Restrict MCP tools per server label: label=tool1,tool2")
  .option("--mcp-desc <entries...>", "Set MCP server descriptions: label=description")
  .option("--image <paths...>", "Attach image(s)")
  .option("--attach <files...>", "Upload file(s)")
  .option("--json-schema <schema>", "Force structured JSON output")
  .option("--defer", "Use deferred completion (fire-and-forget)")
  .argument("[prompt...]", "Prompt (non-interactive)")
  .action(async (promptArgs: string[], opts: any) => {
    const hasCliValue = (name: string): boolean => {
      const source = program.getOptionValueSource(name);
      return source !== undefined && source !== "default";
    };

    let model: string | undefined = hasCliValue("model") ? opts.model : undefined;
    if (opts.fast) model = MODELS.fast;
    if (opts.reasoning) model = MODELS.reasoning;
    if (opts.nonReasoning) model = MODELS.nonReasoning;
    if (opts.code) model = MODELS.code;
    if (opts.research) model = MODELS.multiAgent;

    const maxTurns = hasCliValue("maxTurns") ? parseInt(opts.maxTurns, 10) : undefined;
    const serverTools = buildServerToolsFromOptions(opts);
    const mcpServers = parseMcpServers(opts);

    let approvalPolicy: GrokConfig["approvalPolicy"] | undefined;
    if (opts.yolo) approvalPolicy = "always-approve";
    else if (opts.denyWrites) approvalPolicy = "deny-writes";
    else if (opts.approve) approvalPolicy = "ask";

    if (hasCliValue("color") && opts.color === "never") process.env.NO_COLOR = "1";
    else if (hasCliValue("color") && opts.color === "always") process.env.FORCE_COLOR = "3";

    if (opts.json) setJsonMode(true);

    const config = getConfig({
      model,
      showReasoning: hasCliValue("showReasoning") ? opts.showReasoning : undefined,
      showToolCalls: opts.tools !== false,
      showUsage: hasCliValue("showUsage") ? opts.showUsage : undefined,
      showCitations: hasCliValue("citations") ? opts.citations !== false : undefined,
      showDiffs: hasCliValue("diffs")
        ? opts.diffs !== false
        : hasCliValue("showDiffs")
          ? true
          : undefined,
      showServerToolUsage:
        hasCliValue("showServerToolUsage") ? opts.showServerToolUsage : undefined,
      maxToolRounds: maxTurns,
      serverTools,
      mcpServers,
      useResponsesApi:
        opts.responsesApi ||
        serverTools.length > 0 ||
        mcpServers.length > 0,
      imageInputs: opts.image || [],
      fileAttachments: opts.attach || [],
      jsonSchema: hasCliValue("jsonSchema") ? opts.jsonSchema || null : undefined,
      approvalPolicy,
      sandboxMode: hasCliValue("sandbox") ? opts.sandbox : undefined,
      includeToolOutputs:
        hasCliValue("includeToolOutputs") ? opts.includeToolOutputs || false : undefined,
      notify: hasCliValue("notify") ? opts.notify || false : undefined,
      jsonOutput: !!opts.json,
      ephemeral: hasCliValue("ephemeral") ? opts.ephemeral || false : undefined,
      outputFile: hasCliValue("output") ? opts.output || null : undefined,
      color: hasCliValue("color") ? opts.color || "auto" : undefined,
    });

    setShowDiffs(config.showDiffs);

    let sessionId = config.ephemeral ? undefined : opts.resume || undefined;
    if (config.ephemeral && (opts.resume || opts.fork) && !config.jsonOutput) {
      console.error(chalk.dim("(ephemeral mode ignores --resume and --fork)"));
    }
    if (!config.ephemeral && opts.fork) {
      const mgr = new SessionManager(config.sessionDir);
      const source = mgr.loadSession(opts.fork);
      if (source) {
        const newMeta = mgr.createSession({
          model: config.model,
          cwd: opts.cwd,
          name: `Fork of ${source.meta.name}`,
        });
        for (const msg of source.messages) {
          const role = (msg as any).role;
          const content = (msg as any).content;
          mgr.appendMessage(newMeta.id, role, typeof content === "string" ? content : JSON.stringify(content));
        }
        sessionId = newMeta.id;
        console.error(chalk.dim(`Forked session ${opts.fork} → ${newMeta.id}`));
      } else {
        console.error(chalk.red(`Session not found: ${opts.fork}`));
        process.exit(1);
      }
    }

    const agentOpts: AgentOptions = {
      verbose: opts.verbose,
      showReasoning: config.showReasoning,
      maxTurns: config.maxToolRounds,
      cwd: opts.cwd,
      sessionId,
      sessionName: opts.name,
      planMode: opts.plan || false,
    };

    let prompt = promptArgs.join(" ");
    if (!prompt && !process.stdin.isTTY) {
      const piped = await readStdin();
      if (piped) {
        prompt = piped;
        console.error(chalk.dim(`(piped ${piped.length} chars)`));
      }
    }

    if (opts.defer && prompt) {
      try {
        const client = createClient(config);
        const response = await (client as any).chat.completions.create({
          model: config.model,
          messages: [
            { role: "system", content: buildSystemPrompt(opts.cwd, config) },
            { role: "user", content: prompt },
          ],
          deferred: true,
        });
        console.log(chalk.cyan(`Deferred request ID: ${response.request_id}`));
        console.log(
          chalk.dim(
            `Poll: curl -H "Authorization: Bearer $XAI_API_KEY" https://api.x.ai/v1/chat/deferred-completion/${response.request_id}`,
          ),
        );
        return;
      } catch (err: any) {
        console.error(chalk.red(`Deferred error: ${err.message}`));
        process.exit(1);
      }
    }

    if (opts.plan && prompt) {
      prompt = `PLAN MODE: First, create a detailed step-by-step plan for the following task. List each step with what you'll do and why. After presenting the plan, proceed to execute it step by step.\n\nTask: ${prompt}`;
    }

    if (prompt) {
      const startTime = Date.now();
      let result = "";
      try {
        result = await runAgent(config, prompt, agentOpts);
      } catch (err: any) {
        await fatalExit("Request failed", err, opts.verbose);
      }
      if (config.outputFile && result) {
        const dir = path.dirname(config.outputFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(config.outputFile, result, "utf-8");
        console.error(chalk.dim(`Output saved: ${config.outputFile}`));
      }
      if (opts.verbose) {
        console.error(chalk.dim(`\n${((Date.now() - startTime) / 1000).toFixed(1)}s`));
      }
      if (config.notify) {
        const { notify } = await import("./notifications.js");
        notify("grok-agent", "Task completed");
      }
    } else {
      if (config.jsonOutput) {
        await fatalExit(
          "JSON mode requires a non-interactive prompt",
          new Error("interactive_json_unsupported"),
          false,
        );
      }
      try {
        await runInteractive(config, agentOpts);
      } catch (err: any) {
        await fatalExit("Interactive session failed", err, opts.verbose);
      }
    }
  });

const modelsCmd = program.command("models").description("List and inspect available models");

modelsCmd.command("list").alias("ls").description("List all available models")
  .action(async () => {
    const config = getConfig();
    const client = createClient(config);
    try {
      const response = await client.models.list();
      const models: any[] = [];
      for await (const model of response) models.push(model);
      models.sort((a, b) => a.id.localeCompare(b.id));
      console.log(chalk.bold(`Available models (${models.length}):\n`));
      for (const m of models) {
        console.log(chalk.cyan(m.id) + chalk.dim(`  owner=${m.owned_by || "xai"}`));
      }
    } catch (err: any) {
      console.error(chalk.red(formatApiError("Failed to list models", err)));
      process.exit(1);
    }
  });

modelsCmd.command("info <model>").description("Show details about a model")
  .action(async (modelId: string) => {
    const config = getConfig();
    const client = createClient(config);
    try {
      const model = await client.models.retrieve(modelId);
      console.log(chalk.bold("Model: ") + chalk.cyan(model.id));
      console.log(chalk.bold("Owner: ") + (model.owned_by || "xai"));
      console.log(chalk.bold("Created: ") + new Date((model.created || 0) * 1000).toISOString());
      console.log(chalk.bold("Object: ") + model.object);
    } catch (err: any) {
      if (err?.status === 404) {
        console.error(chalk.red(`Model not found: ${modelId}`));
      } else {
        console.error(chalk.red(formatApiError(`Failed to load model ${modelId}`, err)));
      }
      process.exit(1);
    }
  });

modelsCmd.action(async () => {
  const config = getConfig();
  const client = createClient(config);
  try {
    const response = await client.models.list();
    const models: any[] = [];
    for await (const model of response) models.push(model);
    models.sort((a, b) => a.id.localeCompare(b.id));
    console.log(chalk.bold(`Available models (${models.length}):\n`));
    for (const m of models) {
      console.log(chalk.cyan(m.id) + chalk.dim(`  owner=${m.owned_by || "xai"}`));
    }
  } catch (err: any) {
    console.error(chalk.red(formatApiError("Failed to list models", err)));
    process.exit(1);
  }
});

const sessionsCmd = program.command("sessions").description("Manage sessions");

sessionsCmd.command("list").alias("ls").description("List sessions")
  .option("--limit <n>", "Max to show", "20")
  .option("--archived", "Show archived sessions only")
  .option("--all", "Include archived sessions")
  .action((opts: any) => {
    const config = getConfig();
    const mgr = createSessionManagerOrExit(config.sessionDir);
    const sessions = mgr.listSessions({
      archived: !!opts.archived,
      includeArchived: !!opts.all,
    });
    if (sessions.length === 0) {
      console.log(chalk.dim("No sessions."));
      return;
    }
    const limit = parseInt(opts.limit, 10);
    console.log(chalk.bold(`Sessions (${sessions.length}):\n`));
    for (const s of sessions.slice(0, limit)) {
      const archived = s.archived ? chalk.yellow(" archived") : "";
      console.log(
        chalk.cyan(s.id) +
        "  " +
        chalk.white(s.name) +
        chalk.dim(`  ${s.turns}t  ${s.model}  ${fmtAge(s.updated)}`) +
        archived,
      );
    }
    if (sessions.length > limit) console.log(chalk.dim(`\n+${sessions.length - limit} more`));
  });

sessionsCmd.command("show <id>").description("Show session")
  .action((id: string) => {
    const config = getConfig();
    const mgr = createSessionManagerOrExit(config.sessionDir);
    const s = mgr.loadSession(id);
    if (!s) {
      console.error(chalk.red(`Not found: ${id}`));
      process.exit(1);
    }
    console.log(chalk.bold("ID:      ") + chalk.cyan(s.meta.id));
    console.log(chalk.bold("Name:    ") + s.meta.name);
    console.log(chalk.bold("Model:   ") + s.meta.model);
    console.log(chalk.bold("Turns:   ") + s.meta.turns);
    console.log(chalk.bold("Archived: ") + (s.meta.archived ? "yes" : "no"));
    console.log(chalk.bold("Updated: ") + s.meta.updated);
    console.log("");
    for (const msg of s.messages) {
      const role = (msg as any).role;
      const content = (msg as any).content;
      const toolCalls = (msg as any).tool_calls;
      if (role === "system") console.log(chalk.dim("  [sys] ") + chalk.dim(trunc(content || "", 80)));
      else if (role === "user") console.log(chalk.blue("  [user] ") + trunc(content || "", 120));
      else if (role === "assistant" && toolCalls?.length) {
        console.log(chalk.green("  [grok] ") + chalk.dim(`calls: ${toolCalls.map((t: any) => t.function?.name).join(", ")}`));
      } else if (role === "assistant") {
        console.log(chalk.green("  [grok] ") + trunc(content || "", 120));
      } else if (role === "tool") {
        console.log(chalk.yellow("  [tool] ") + chalk.dim(trunc(content || "", 80)));
      }
    }
  });

sessionsCmd.command("delete <id>").alias("rm").description("Delete session")
  .action((id: string) => {
    const config = getConfig();
    const mgr = createSessionManagerOrExit(config.sessionDir);
    if (mgr.deleteSession(id)) console.log(chalk.green(`Deleted: ${id}`));
    else {
      console.error(chalk.red(`Not found: ${id}`));
      process.exit(1);
    }
  });

sessionsCmd.command("clear").description("Delete all sessions")
  .option("--archived", "Only clear archived sessions")
  .action((opts: any) => {
    const config = getConfig();
    const cleared = createSessionManagerOrExit(config.sessionDir).clearSessions({
      archived: !!opts.archived,
    });
    console.log(chalk.green(`Cleared ${cleared} session(s).`));
  });

sessionsCmd.command("archive <id>").description("Archive a session")
  .action((id: string) => {
    const config = getConfig();
    const mgr = createSessionManagerOrExit(config.sessionDir);
    if (!mgr.archiveSession(id)) {
      console.error(chalk.red(`Unable to archive: ${id}`));
      process.exit(1);
    }
    console.log(chalk.green(`Archived: ${id}`));
  });

sessionsCmd.command("unarchive <id>").description("Restore an archived session")
  .action((id: string) => {
    const config = getConfig();
    const mgr = createSessionManagerOrExit(config.sessionDir);
    if (!mgr.unarchiveSession(id)) {
      console.error(chalk.red(`Unable to unarchive: ${id}`));
      process.exit(1);
    }
    console.log(chalk.green(`Restored: ${id}`));
  });

sessionsCmd.command("rename <id> <name...>").description("Rename a session")
  .action((id: string, nameParts: string[]) => {
    const config = getConfig();
    const mgr = createSessionManagerOrExit(config.sessionDir);
    const name = nameParts.join(" ").trim();
    if (!mgr.renameSession(id, name)) {
      console.error(chalk.red(`Unable to rename: ${id}`));
      process.exit(1);
    }
    console.log(chalk.green(`Renamed ${id} -> ${name}`));
  });

sessionsCmd.command("rollback <id>").description("Remove the last N turns from a session")
  .option("-n, --turns <n>", "Number of turns", "1")
  .action((id: string, opts: any) => {
    const config = getConfig();
    const mgr = createSessionManagerOrExit(config.sessionDir);
    const turns = parseInt(opts.turns, 10);
    if (!mgr.rollbackTurns(id, turns)) {
      console.error(chalk.red(`Unable to rollback: ${id}`));
      process.exit(1);
    }
    console.log(chalk.green(`Rolled back ${turns} turn(s) from ${id}`));
  });

sessionsCmd.command("compact <id>").description("Compact a session's history with a handoff summary")
  .action(async (id: string) => {
    const config = getConfig();
    const mgr = createSessionManagerOrExit(config.sessionDir);
    const loaded = mgr.loadSession(id);
    if (!loaded) {
      console.error(chalk.red(`Not found: ${id}`));
      process.exit(1);
    }
    const compacted = await compactConversation(config, loaded.messages);
    loaded.meta.turns = countTurns(compacted);
    loaded.meta.updated = new Date().toISOString();
    mgr.rewriteSession(id, sessionEventsFromMessages(loaded.meta, compacted));
    console.log(chalk.green(`Compacted session: ${id}`));
  });

const reviewCmd = program.command("review").description("Run Grok in code review mode")
  .option("--base <branch>", "Review diff against a base branch")
  .option("--commit <sha>", "Review a specific commit")
  .option("--instructions <text>", "Additional review instructions")
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("-m, --model <model>", "Model to use")
  .option("--ephemeral", "Don't save the review session")
  .action(async () => {
    const opts = reviewCmd.optsWithGlobals();
    const config = getConfig({
      model: opts.model,
      ephemeral: !!opts.ephemeral,
    });
    const prompt = buildReviewPrompt(opts);
    await runAgent(config, prompt, {
      verbose: true,
      showReasoning: false,
      maxTurns: config.maxToolRounds,
      cwd: opts.cwd,
      planMode: false,
    });
  });

program.command("generate-image").alias("imagine")
  .description("Generate an image")
  .argument("<prompt...>", "Description")
  .option("--pro", "High quality ($0.07)")
  .option("-n, --count <n>", "Number of images", "1")
  .option("-o, --output <dir>", "Output directory", "generated/images")
  .option("--no-download", "Print URL only, don't download")
  .action(async (args: string[], opts: any) => {
    const config = getConfig();
    const client = createClient(config);
    const model = opts.pro ? "grok-imagine-image-pro" : "grok-imagine-image";
    const n = parseInt(opts.count, 10);
    console.error(chalk.dim(`Generating ${n} image(s) with ${model}...`));
    try {
      const res = await client.images.generate({ model, prompt: args.join(" "), n });
      const outDir = path.resolve(opts.output);
      if (opts.download !== false && !fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      for (let i = 0; i < (res.data || []).length; i++) {
        const img = res.data![i];
        const url = img.url;
        if (!url) continue;
        if (opts.download === false) {
          console.log(url);
          continue;
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const ext = url.includes(".png") ? "png" : "jpg";
        const filename = `grok-${timestamp}${n > 1 ? `-${i + 1}` : ""}.${ext}`;
        const filePath = path.join(outDir, filename);
        const imgRes = await fetch(url);
        if (!imgRes.ok) {
          console.error(chalk.yellow(`Failed to download image ${i + 1}`));
          continue;
        }
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        fs.writeFileSync(filePath, buffer);
        console.log(chalk.green(`Saved: ${filePath}`) + chalk.dim(` (${(buffer.length / 1024).toFixed(0)}KB)`));
      }
      console.error(chalk.dim(`Cost: ~$${(opts.pro ? 0.07 * n : 0.02 * n).toFixed(2)}`));
    } catch (err: any) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

program.command("generate-video").alias("video")
  .description("Generate a video")
  .argument("<prompt...>", "Description")
  .option("-d, --duration <s>", "Duration in seconds (1-15)", "8")
  .option("--aspect <ratio>", "Aspect ratio (16:9, 9:16, 1:1, 4:3)", "16:9")
  .option("-o, --output <dir>", "Output directory", "generated/video")
  .action(async (args: string[], opts: any) => {
    const config = getConfig();
    console.error(chalk.dim("Generating video (this may take a while)..."));
    try {
      const response = await fetch(`${config.baseUrl}/videos/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: "grok-imagine-video",
          prompt: args.join(" "),
          duration: parseInt(opts.duration, 10),
          aspect_ratio: opts.aspect,
        }),
      });
      const data = await response.json() as any;
      if (data.url) {
        const outDir = path.resolve(opts.output);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const filePath = path.join(outDir, `grok-video-${timestamp}.mp4`);
        const vidRes = await fetch(data.url);
        if (vidRes.ok) {
          const buffer = Buffer.from(await vidRes.arrayBuffer());
          fs.writeFileSync(filePath, buffer);
          console.log(chalk.green(`Saved: ${filePath}`) + chalk.dim(` (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`));
        } else {
          console.log(data.url);
        }
      } else if (data.request_id) {
        console.log(chalk.cyan(`Video request ID: ${data.request_id}`));
        console.log(chalk.dim("Video is generating async. Poll for results or check xAI Console."));
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
      console.error(chalk.dim(`Est. cost: ~$${(parseInt(opts.duration, 10) * 0.05).toFixed(2)}`));
    } catch (err: any) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

program.command("speak").alias("tts")
  .description("Convert text to speech")
  .argument("<text...>", "Text to speak")
  .option("--voice <name>", "Voice id (see grok-agent tts-voices)", "eve")
  .option("--lang <code>", "Language code (BCP-47)", "en")
  .option("--codec <codec>", "Audio codec: mp3, wav, pcm, mulaw, alaw", "mp3")
  .option("--sample-rate <hz>", "Audio sample rate")
  .option("--bit-rate <bps>", "Audio bit rate for mp3")
  .option("--stream", "Use streaming TTS over WebSocket")
  .option("-o, --output <file>", "Output file (auto-generated if omitted)")
  .option("--dir <dir>", "Output directory", "generated/audio")
  .action(async (args: string[], opts: any) => {
    const config = getConfig();
    console.error(chalk.dim(`Generating speech (voice: ${opts.voice}, lang: ${opts.lang})...`));
    try {
      let outPath = opts.output;
      if (!outPath) {
        const outDir = path.resolve(opts.dir);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const ext = opts.codec === "wav" ? "wav" : opts.codec === "mp3" ? "mp3" : "raw";
        outPath = path.join(outDir, `grok-tts-${opts.voice}-${timestamp}.${ext}`);
      }

      if (opts.stream) {
        const streamed = await streamTtsToFile(config, {
          text: args.join(" "),
          voice: opts.voice,
          language: opts.lang,
          codec: opts.codec,
          sampleRate: opts.sampleRate ? parseInt(opts.sampleRate, 10) : undefined,
          bitRate: opts.bitRate ? parseInt(opts.bitRate, 10) : undefined,
          output: outPath,
        });
        console.log(chalk.green(`Saved: ${streamed.output}`) + chalk.dim(` (${(streamed.bytes / 1024).toFixed(1)}KB)`));
        return;
      }

      const body: any = {
        text: args.join(" "),
        voice_id: opts.voice,
        language: opts.lang,
      };
      if (opts.codec || opts.sampleRate || opts.bitRate) {
        body.output_format = {
          codec: opts.codec,
          ...(opts.sampleRate ? { sample_rate: parseInt(opts.sampleRate, 10) } : {}),
          ...(opts.bitRate ? { bit_rate: parseInt(opts.bitRate, 10) } : {}),
        };
      }

      const response = await fetch(`${config.baseUrl}/tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = await response.text();
        console.error(chalk.red(`TTS error: ${err}`));
        process.exit(1);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, buffer);
      console.log(chalk.green(`Saved: ${outPath}`) + chalk.dim(` (${(buffer.length / 1024).toFixed(1)}KB)`));
    } catch (err: any) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

program.command("tts-voices").description("List available TTS voices")
  .action(async () => {
    const config = getConfig();
    try {
      const voices = await listVoices(config);
      for (const voice of voices) {
        console.log(`${voice.voice_id}  ${voice.name || ""}`.trim());
      }
    } catch (err: any) {
      console.error(chalk.red(formatApiError("Failed to list voices", err)));
      process.exit(1);
    }
  });

const collectionsCmd = program.command("collections").description("Manage document collections");

collectionsCmd.command("list").alias("ls").description("List collections")
  .action(async () => {
    const config = getConfig();
    try {
      const collections = await listCollections(config);
      if (collections.length === 0) {
        console.log(chalk.dim("No collections."));
        return;
      }
      for (const collection of collections) {
        console.log(chalk.cyan(collection.collection_id || collection.id) + "  " + chalk.white(collection.collection_name || collection.name || "unnamed"));
      }
    } catch (err: any) {
      console.error(chalk.red(formatApiError("Failed to list collections", err)));
      process.exit(1);
    }
  });

collectionsCmd.command("get <id>").description("Show collection details")
  .action(async (id: string) => {
    const config = getConfig();
    try {
      const collection = await getCollection(config, id);
      console.log(JSON.stringify(collection, null, 2));
    } catch (err: any) {
      console.error(chalk.red(formatApiError(`Failed to load collection ${id}`, err)));
      process.exit(1);
    }
  });

collectionsCmd.command("create <name...>").description("Create a collection")
  .action(async (nameParts: string[]) => {
    const config = getConfig();
    try {
      const data = await createCollection(config, nameParts.join(" "));
      console.log(chalk.green(`Created: ${data.collection_id || data.id}`));
    } catch (err: any) {
      console.error(chalk.red(formatApiError("Failed to create collection", err)));
      process.exit(1);
    }
  });

collectionsCmd.command("update <id> <name...>").description("Rename a collection")
  .action(async (id: string, nameParts: string[]) => {
    const config = getConfig();
    try {
      const data = await updateCollection(config, id, nameParts.join(" "));
      console.log(chalk.green(`Updated: ${data.collection_id || data.id || id}`));
    } catch (err: any) {
      console.error(chalk.red(formatApiError(`Failed to update collection ${id}`, err)));
      process.exit(1);
    }
  });

collectionsCmd.command("delete <id>").description("Delete a collection")
  .action(async (id: string) => {
    const config = getConfig();
    try {
      await deleteCollection(config, id);
      console.log(chalk.green(`Deleted: ${id}`));
    } catch (err: any) {
      console.error(chalk.red(formatApiError(`Failed to delete collection ${id}`, err)));
      process.exit(1);
    }
  });

collectionsCmd.command("docs <id>").description("List documents in a collection")
  .action(async (id: string) => {
    const config = getConfig();
    try {
      const documents = await listCollectionDocuments(config, id);
      if (documents.length === 0) {
        console.log(chalk.dim("No documents."));
        return;
      }
      for (const doc of documents) {
        const fileId = doc.file_id || doc.id || doc.file_metadata?.file_id;
        const name = doc.name || doc.file_name || doc.file_metadata?.name || "unnamed";
        const status = doc.status || doc.state || "";
        console.log(`${chalk.cyan(fileId)}  ${name}${status ? chalk.dim(`  ${status}`) : ""}`);
      }
    } catch (err: any) {
      console.error(chalk.red(formatApiError(`Failed to list documents for ${id}`, err)));
      process.exit(1);
    }
  });

collectionsCmd.command("upload <id> <file>").description("Upload a document into a collection")
  .option("--fields <json>", "Metadata fields as a JSON object")
  .action(async (id: string, file: string, opts: any) => {
    const config = getConfig();
    try {
      const fields = opts.fields ? JSON.parse(opts.fields) as Record<string, string> : undefined;
      const doc = await uploadCollectionDocument(config, id, file, fields);
      console.log(chalk.green(`Uploaded: ${doc.file_id || doc.id || path.basename(file)}`));
    } catch (err: any) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

collectionsCmd.command("rm-doc <id> <fileId>").description("Delete a document from a collection")
  .action(async (id: string, fileId: string) => {
    const config = getConfig();
    try {
      await removeCollectionDocument(config, id, fileId);
      console.log(chalk.green(`Deleted document ${fileId} from ${id}`));
    } catch (err: any) {
      console.error(chalk.red(formatApiError(`Failed to delete document ${fileId}`, err)));
      process.exit(1);
    }
  });

collectionsCmd.command("search <id> <query...>").description("Search documents in a collection")
  .option("--mode <mode>", "Search mode: keyword, semantic, hybrid", "hybrid")
  .action(async (id: string, queryParts: string[], opts: any) => {
    const config = getConfig();
    try {
      const results = await searchCollectionDocuments(config, queryParts.join(" "), [id], opts.mode);
      console.log(JSON.stringify(results, null, 2));
    } catch (err: any) {
      console.error(chalk.red(formatApiError(`Failed to search collection ${id}`, err)));
      process.exit(1);
    }
  });

const batchCmd = program.command("batch").description("Manage Batch API jobs");

batchCmd.command("create <name...>").description("Create a batch")
  .action(async (nameParts: string[]) => {
    const config = getConfig();
    try {
      const batch = await createBatch(config, nameParts.join(" "));
      console.log(chalk.green(`Created batch: ${batch.batch_id}`));
    } catch (err: any) {
      console.error(chalk.red(formatApiError("Failed to create batch", err)));
      process.exit(1);
    }
  });

batchCmd.command("list").description("List recent batches")
  .option("--limit <n>", "Page size", "20")
  .action(async (opts: any) => {
    const config = getConfig();
    try {
      const data = await listBatches(config, parseInt(opts.limit, 10));
      for (const batch of data.batches || []) {
        const state = batch.state || {};
        const status = state.num_pending === 0 ? "complete" : "processing";
        console.log(`${batch.name} (${batch.batch_id}): ${status}`);
      }
    } catch (err: any) {
      console.error(chalk.red(formatApiError("Failed to list batches", err)));
      process.exit(1);
    }
  });

batchCmd.command("status <id>").description("Show batch status")
  .action(async (id: string) => {
    const config = getConfig();
    try {
      console.log(JSON.stringify(await getBatch(config, id), null, 2));
    } catch (err: any) {
      console.error(chalk.red(formatApiError(`Failed to load batch ${id}`, err)));
      process.exit(1);
    }
  });

batchCmd.command("requests <id>").description("List individual request states for a batch")
  .option("--limit <n>", "Page size", "50")
  .action(async (id: string, opts: any) => {
    const config = getConfig();
    try {
      const data = await listBatchRequests(config, id, parseInt(opts.limit, 10));
      console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(chalk.red(formatApiError(`Failed to list requests for ${id}`, err)));
      process.exit(1);
    }
  });

batchCmd.command("results <id>").description("List batch results")
  .option("--limit <n>", "Page size", "100")
  .action(async (id: string, opts: any) => {
    const config = getConfig();
    try {
      const data = await listBatchResults(config, id, parseInt(opts.limit, 10));
      console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(chalk.red(formatApiError(`Failed to list results for ${id}`, err)));
      process.exit(1);
    }
  });

batchCmd.command("cancel <id>").description("Cancel a batch")
  .action(async (id: string) => {
    const config = getConfig();
    try {
      const data = await cancelBatch(config, id);
      console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(chalk.red(formatApiError(`Failed to cancel batch ${id}`, err)));
      process.exit(1);
    }
  });

batchCmd.command("add-chat <id> <prompt...>").description("Add a single chat request to a batch")
  .option("--request-id <id>", "Batch request id")
  .option("--system <text>", "Optional system prompt")
  .option("-m, --model <model>", "Model to use")
  .action(async (id: string, promptParts: string[], opts: any) => {
    const config = getConfig();
    try {
      const request = buildBatchChatRequest(
        opts.model || config.model,
        promptParts.join(" "),
        opts.requestId || `req_${Date.now().toString(36)}`,
        opts.system,
      );
      const data = await addBatchRequests(config, id, [request]);
      console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(chalk.red(formatApiError(`Failed to add chat request to ${id}`, err)));
      process.exit(1);
    }
  });

batchCmd.command("add-jsonl <id> <file>").description("Add batch requests from a JSONL file")
  .action(async (id: string, file: string) => {
    const config = getConfig();
    try {
      const requests = loadBatchRequestsFromJsonl(file);
      const data = await addBatchRequests(config, id, requests);
      console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

const realtimeCmd = program.command("realtime").description("Realtime API helpers");

realtimeCmd.command("secret").description("Create an ephemeral realtime client secret")
  .option("--seconds <n>", "Expiration in seconds", "600")
  .option("--session <json>", "Optional session JSON payload")
  .action(async (opts: any) => {
    const config = getConfig();
    try {
      const session = opts.session ? JSON.parse(opts.session) as Record<string, unknown> : undefined;
      const secret = await createRealtimeClientSecret(config, parseInt(opts.seconds, 10), session);
      console.log(JSON.stringify(secret, null, 2));
    } catch (err: any) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

program.command("doctor").description("Check setup and API key")
  .action(async () => {
    const config = getConfig();
    console.log(chalk.bold("grok-agent doctor\n"));
    console.log(chalk.bold("API Key: ") + chalk.green("set") + chalk.dim(` (${config.apiKey.slice(0, 8)}...)`));
    console.log(chalk.bold("Management Key: ") + (config.managementApiKey ? chalk.green("set") : chalk.dim("not set")));
    console.log(chalk.bold("Base URL: ") + config.baseUrl);
    console.log(chalk.bold("Management URL: ") + config.managementBaseUrl);
    console.log(chalk.bold("Model: ") + config.model);
    console.log(chalk.bold("Sandbox: ") + config.sandboxMode);
    console.log(chalk.bold("Session Dir: ") + config.sessionDir);

    const configPath = path.join(config.sessionDir, "config.json");
    console.log(chalk.bold("Config File: ") + (fs.existsSync(configPath) ? chalk.green(configPath) : chalk.dim("not found")));

    const { loadProjectContext } = await import("./project-context.js");
    const ctx = loadProjectContext(process.cwd());
    console.log(chalk.bold("Project Context: ") + (ctx ? chalk.green("found (GROK.md / .grokrc)") : chalk.dim("none")));

    console.log(chalk.dim("\nValidating API key..."));
    try {
      const client = createClient(config);
      const models = await client.models.list();
      let count = 0;
      for await (const _ of models) count++;
      console.log(chalk.green(`API key valid. ${count} models available.`));
    } catch (err: any) {
      console.log(chalk.red(formatApiError("API key validation failed", err)));
    }

    if (config.managementApiKey) {
      try {
        const collections = await listCollections(config);
        console.log(chalk.green(`Management key valid. ${collections.length} collections accessible.`));
      } catch (err: any) {
        console.log(chalk.yellow(formatApiError("Management key validation failed", err)));
      }
    }

    try {
      const res = await fetch(`${config.baseUrl}/api-key`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      if (res.ok) {
        const info = await res.json() as any;
        console.log(chalk.bold("\nAPI Key Details:"));
        if (info.name) console.log(chalk.dim(`  Name: ${info.name}`));
        if (info.acls) console.log(chalk.dim(`  ACLs: ${JSON.stringify(info.acls)}`));
      }
    } catch {
      // Endpoint may not exist.
    }

    try {
      const mgr = new SessionManager(config.sessionDir);
      const sessions = mgr.listSessions({ includeArchived: true });
      const archived = sessions.filter((session) => session.archived).length;
      console.log(chalk.bold("\nSessions: ") + `${sessions.length - archived} active, ${archived} archived`);
    } catch (err: any) {
      console.log(chalk.bold("\nSessions: ") + chalk.red("unavailable"));
      console.log(chalk.dim(`  ${formatSessionDirError(config.sessionDir, err)}`));
    }
  });

program.command("tokenize").description("Count tokens in text")
  .argument("<text...>", "Text to tokenize")
  .option("-m, --model <model>", "Model for tokenization")
  .action(async (args: string[], opts: any) => {
    const config = getConfig();
    const model = opts.model || config.model;
    const text = args.join(" ");
    try {
      const res = await fetch(`${config.baseUrl}/tokenize-text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model, text }),
      });
      if (!res.ok) {
        throw new Error(await getResponseErrorMessage("Tokenization failed", res));
      }
      const data = await res.json() as any;
      const tokens = data.token_ids || data.tokens || [];
      console.log(chalk.bold("Tokens: ") + tokens.length);
      if (data.token_ids) {
        const preview = data.token_ids.slice(0, 20).map((t: any) => t.string_token || t).join("");
        console.log(chalk.dim(`Preview: ${preview}${tokens.length > 20 ? "..." : ""}`));
      }
      console.log(chalk.dim("Tokenizer counts may differ from full inference token usage because agent turns add more context internally."));
    } catch (err: any) {
      if (isNetworkError(err)) {
        const estimatedTokens = approxTokenCount(text);
        console.error(chalk.yellow(formatApiError("Tokenization API unavailable", err)));
        console.log(chalk.bold("Tokens (estimated): ") + estimatedTokens);
        console.log(chalk.dim(`Preview: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`));
        return;
      }
      console.error(chalk.red(err instanceof Error ? err.message : formatApiError("Tokenization failed", err)));
      process.exit(1);
    }
  });

program.command("config").description("Show or edit configuration")
  .option("--init", "Create default config file")
  .action((opts: any) => {
    const config = getConfig();
    const configPath = path.join(config.sessionDir, "config.json");

    if (opts.init) {
      if (fs.existsSync(configPath)) {
        console.log(chalk.yellow(`Config already exists: ${configPath}`));
        return;
      }
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const defaultConfig = {
        model: MODELS.default,
        approval_policy: "always-approve",
        sandbox_mode: "danger-full-access",
        show_usage: false,
        show_diffs: true,
        show_citations: true,
        show_server_tool_usage: false,
        include_tool_outputs: false,
        notify: false,
        max_turns: 50,
        management_base_url: "https://management-api.x.ai/v1",
        mcp_servers: [],
        server_tools: [],
        tool_approvals: {
          tools: {},
        },
        hooks: {},
      };
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + "\n", "utf-8");
      console.log(chalk.green(`Created: ${configPath}`));
      return;
    }

    console.log(chalk.bold("Configuration:\n"));
    console.log(chalk.dim(`Config file: ${fs.existsSync(configPath) ? configPath : "not found (run: grok-agent config --init)"}`));
    console.log(chalk.dim(`Model: ${config.model}`));
    console.log(chalk.dim(`Approval: ${config.approvalPolicy}`));
    console.log(chalk.dim(`Sandbox: ${config.sandboxMode}`));
    console.log(chalk.dim(`Show usage: ${config.showUsage}`));
    console.log(chalk.dim(`Show diffs: ${config.showDiffs}`));
    console.log(chalk.dim(`Show server tool usage: ${config.showServerToolUsage}`));
    console.log(chalk.dim(`Include tool outputs: ${config.includeToolOutputs}`));
    console.log(chalk.dim(`Notify: ${config.notify}`));
    console.log(chalk.dim(`Max turns: ${config.maxToolRounds}`));
    if (config.serverTools.length > 0) {
      console.log(chalk.dim(`Server tools: ${JSON.stringify(config.serverTools)}`));
    }
    if (config.mcpServers.length > 0) {
      console.log(chalk.dim(`MCP servers: ${JSON.stringify(config.mcpServers)}`));
    }
    if (config.toolApprovals.tools && Object.keys(config.toolApprovals.tools).length > 0) {
      console.log(chalk.dim(`Tool approvals: ${JSON.stringify(config.toolApprovals.tools)}`));
    }
  });

program.parse();

function buildServerToolsFromOptions(opts: any): ServerToolConfig[] {
  const tools: ServerToolConfig[] = [];

  if (opts.webSearch || opts.allowDomain || opts.excludeDomain || opts.searchImages) {
    tools.push({
      type: "web_search",
      filters: {
        allowedDomains: opts.allowDomain || [],
        excludedDomains: opts.excludeDomain || [],
      },
      enableImageUnderstanding: !!opts.searchImages,
      includeSources: !!opts.includeToolOutputs,
    });
  }

  if (
    opts.xSearch ||
    opts.xAllow ||
    opts.xExclude ||
    opts.xFrom ||
    opts.xTo ||
    opts.xImages ||
    opts.xVideos
  ) {
    tools.push({
      type: "x_search",
      allowedXHandles: opts.xAllow || [],
      excludedXHandles: opts.xExclude || [],
      fromDate: opts.xFrom,
      toDate: opts.xTo,
      enableImageUnderstanding: !!opts.xImages || !!opts.searchImages,
      enableVideoUnderstanding: !!opts.xVideos,
    });
  }

  if (opts.codeExecution) {
    tools.push({
      type: "code_execution",
      includeOutputs: !!opts.includeToolOutputs,
    });
  }

  if (opts.collection) {
    tools.push({
      type: "file_search",
      collectionIds: opts.collection,
      retrievalMode: opts.fileSearchMode,
      includeResults: !!opts.includeToolOutputs,
    });
  }

  if (opts.research && tools.length === 0) {
    tools.push({ type: "web_search" }, { type: "x_search" });
  }

  return tools;
}

function parseMcpServers(opts: any): McpServer[] {
  const servers: McpServer[] = [];
  const allowByLabel = parseLabelList(opts.mcpAllow || []);
  const descByLabel = parseKeyValueEntries(opts.mcpDesc || []);

  for (const entry of opts.mcp || []) {
    let label = "mcp";
    let url = entry;
    if (entry.includes("=")) {
      const parts = entry.split("=", 2);
      label = parts[0];
      url = parts[1];
    } else {
      try {
        label = new URL(entry).hostname.split(".")[0];
      } catch {
        label = "mcp";
      }
    }

    servers.push({
      label,
      url,
      description: descByLabel[label],
      allowedTools: allowByLabel[label] || [],
    });
  }

  return servers;
}

function parseKeyValueEntries(entries: string[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (const entry of entries) {
    const [key, value] = entry.split("=", 2);
    if (key && value) output[key] = value;
  }
  return output;
}

function parseLabelList(entries: string[]): Record<string, string[]> {
  const output: Record<string, string[]> = {};
  for (const entry of entries) {
    const [label, values] = entry.split("=", 2);
    if (!label || !values) continue;
    output[label] = values.split(",").map((value) => value.trim()).filter(Boolean);
  }
  return output;
}

function buildReviewPrompt(opts: {
  base?: string;
  commit?: string;
  instructions?: string;
}): string {
  let target = "the current uncommitted changes in this repository";
  if (opts.base) {
    target = `the diff between the current branch and ${opts.base}`;
  }
  if (opts.commit) {
    target = `commit ${opts.commit}`;
  }

  const instructions = opts.instructions
    ? `\nAdditional review instructions: ${opts.instructions}`
    : "";

  return `Review ${target}. Focus on bugs, regressions, risky assumptions, missing tests, and behavior changes. Use tools to inspect the relevant diff and source files. Present findings first, ordered by severity, with file and line references when possible. Keep summaries brief.${instructions}`;
}

function trunc(s: string, n: number): string {
  const line = String(s || "").replace(/\n/g, " ").trim();
  return line.length <= n ? line : `${line.slice(0, n - 3)}...`;
}

async function fatalExit(context: string, err: any, verbose: boolean): Promise<never> {
  const message = getFatalMessage(context, err);
  emitError(message);
  if (!isJsonMode()) {
    console.error(chalk.red(`\nFatal: ${message}`));
    if (verbose && err?.stack) console.error(chalk.dim(err.stack));
  }
  process.exit(1);
}

function getFatalMessage(context: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("session storage")) return message;
  return formatApiError(context, err);
}

function createSessionManagerOrExit(baseDir: string): SessionManager {
  try {
    return new SessionManager(baseDir);
  } catch (err: any) {
    console.error(chalk.red(formatSessionDirError(baseDir, err)));
    process.exit(1);
  }
}

function fmtAge(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d` : `${Math.floor(days / 30)}mo`;
}

function countTurns(messages: any[]): number {
  return messages.filter((message) => message.role === "user").length;
}

function sessionEventsFromMessages(meta: SessionMeta, messages: any[]): SessionEvent[] {
  const events: SessionEvent[] = [{ ts: meta.updated, type: "meta", meta }];
  let turn = 0;
  for (const message of messages) {
    if (message.role === "user") turn++;
    const event: SessionEvent = {
      ts: new Date().toISOString(),
      type: "msg",
      role: message.role,
      turn: message.role === "system" ? undefined : turn,
      content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
    };
    if (message.tool_calls) {
      event.toolCalls = message.tool_calls.map((toolCall: any) => ({
        id: toolCall.id,
        name: toolCall.function?.name || "",
        arguments: toolCall.function?.arguments || "",
      }));
    }
    if (message.tool_call_id) event.toolCallId = message.tool_call_id;
    events.push(event);
  }
  return events;
}
