import { createClient } from "../client.js";
import { emitEvent } from "../json-output.js";
import { finalizeToolResult } from "../tool-result-storage.js";
import { getTaskFilePath, updateTask } from "../tasks.js";
import type { ToolDef, ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";
import { toolDefinitions } from "./definitions.js";
import { executeGrep } from "./grep.js";
import { executeListDir } from "./list-dir.js";
import { executeLsp } from "./lsp.js";
import { executeMcpListResources } from "./mcp-list-resources.js";
import { executeMcpReadResource } from "./mcp-read-resource.js";
import { executeMemorySearch } from "./memory-search.js";
import { executeReadFile } from "./read-file.js";
import { executeToolSearch } from "./tool-search.js";
import { executeWebFetch } from "./web-fetch.js";
import { executeGlob } from "./glob.js";

type ReadOnlyExecutor = (args: any, cwd: string, options: ToolExecutionOptions) => Promise<ToolResult>;

const SUBAGENT_TOOL_NAMES = new Set([
  "tool_search",
  "memory_search",
  "lsp",
  "read_file",
  "glob",
  "grep",
  "list_directory",
  "web_fetch",
  "mcp_list_resources",
  "mcp_read_resource",
]);

const SUBAGENT_TOOLS: Record<string, ReadOnlyExecutor> = {
  tool_search: executeToolSearch,
  memory_search: executeMemorySearch,
  lsp: executeLsp,
  read_file: executeReadFile,
  glob: executeGlob,
  grep: executeGrep,
  list_directory: executeListDir,
  web_fetch: executeWebFetch,
  mcp_list_resources: executeMcpListResources,
  mcp_read_resource: executeMcpReadResource,
};

const SUBAGENT_DEFINITIONS: ToolDef[] = toolDefinitions.filter((tool) =>
  SUBAGENT_TOOL_NAMES.has(String((tool as any).function?.name || "")),
);

function buildSystemPrompt(name: string): string {
  return [
    `You are ${name}, a focused read-only subagent working inside grok-agent.`,
    "Your job is to investigate a bounded task and report back concise findings to the parent agent.",
    "You may inspect files, search code, use semantic navigation, fetch exact web pages, and inspect MCP resources.",
    "Do not edit files, run shell commands, save memory, ask the user questions, or spawn more subagents.",
    "Prefer precise findings with file references when possible.",
  ].join(" ");
}

async function executeSubagentTool(
  name: string,
  argsJson: string,
  cwd: string,
  options: ToolExecutionOptions,
  callId: string,
): Promise<ToolResult> {
  const executor = SUBAGENT_TOOLS[name];
  if (!executor) {
    return { output: `Subagent tool not allowed: ${name}`, error: true };
  }

  try {
    const args = JSON.parse(argsJson);
    const result = await executor(args, cwd, {
      ...options,
      sandboxMode: "read-only",
    });
    return finalizeToolResult(result, name, {
      maxOutputTokens: Math.min(options.maxOutputTokens || 4000, 4000),
      resultStoreDir: options.sessionDir && options.sessionId
        ? getTaskFilePath(options.sessionDir, options.sessionId).replace(/\.json$/, "-outputs")
        : undefined,
      toolCallId: callId,
    });
  } catch (err: any) {
    return { output: `Subagent tool error: ${err.message}`, error: true };
  }
}

export async function executeSpawnSubagent(args: {
  task: string;
  context?: string;
  name?: string;
  model?: string;
  max_turns?: number;
  task_id?: string;
  owner?: string;
}, projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  if (!options.config) {
    return { output: "spawn_subagent requires the active runtime config.", error: true };
  }
  if (!args.task?.trim()) {
    return { output: "spawn_subagent requires task.", error: true };
  }

  const subagentName = args.name?.trim() || "Subagent";
  const model = args.model || options.config.model;
  const maxTurns = Math.min(Math.max(args.max_turns || 15, 1), 30);

  if (options.sessionDir && options.sessionId && args.task_id) {
    updateTask(options.sessionDir, options.sessionId, args.task_id, {
      status: "in_progress",
      owner: args.owner || subagentName,
      notes: "Running subagent investigation.",
    });
  }

  emitEvent({
    type: "subagent.started",
    name: subagentName,
    task: args.task,
    task_id: args.task_id,
  });

  const client = createClient(
    options.config.convId
      ? { ...options.config, convId: `${options.config.convId}:subagent:${subagentName}` }
      : options.config,
  );

  const messages: any[] = [
    { role: "system", content: buildSystemPrompt(subagentName) },
    {
      role: "user",
      content: [
        `Primary task: ${args.task.trim()}`,
        args.context ? `Context:\n${args.context.trim()}` : "",
        `Working directory: ${projectCwd}`,
      ].filter(Boolean).join("\n\n"),
    },
  ];

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await client.chat.completions.create({
        model,
        messages,
        tools: SUBAGENT_DEFINITIONS.length > 0 ? SUBAGENT_DEFINITIONS : undefined,
        max_tokens: Math.min(options.config.maxTokens, 8192),
        temperature: 0,
      } as any);

      const message = response.choices?.[0]?.message;
      if (!message) {
        return { output: `${subagentName} returned no message.`, error: true };
      }

      const toolCalls = (message.tool_calls || []).filter((call: any) => call.id && call.function?.name);
      if (toolCalls.length === 0) {
        const summary = typeof message.content === "string" ? message.content : "(no output)";
        if (options.sessionDir && options.sessionId && args.task_id) {
          updateTask(options.sessionDir, options.sessionId, args.task_id, {
            status: "completed",
            owner: args.owner || subagentName,
            notes: summary.slice(0, 2000),
          });
        }
        emitEvent({
          type: "subagent.completed",
          name: subagentName,
          task_id: args.task_id,
        });
        return {
          output: [
            `${subagentName} completed.`,
            "",
            summary,
          ].join("\n"),
        };
      }

      messages.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: toolCalls.map((call: any) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.function.name,
            arguments: call.function.arguments,
          },
        })),
      });

      for (const call of toolCalls) {
        const result = await executeSubagentTool(
          call.function.name,
          call.function.arguments,
          projectCwd,
          options,
          call.id,
        );
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result.output,
        });
      }
    }

    const partial = `${subagentName} reached its max turn limit (${maxTurns}).`;
    if (options.sessionDir && options.sessionId && args.task_id) {
      updateTask(options.sessionDir, options.sessionId, args.task_id, {
        status: "pending",
        owner: args.owner || subagentName,
        notes: partial,
      });
    }
    emitEvent({
      type: "subagent.completed",
      name: subagentName,
      task_id: args.task_id,
      truncated: true,
    });
    return { output: partial };
  } catch (err: any) {
    if (options.sessionDir && options.sessionId && args.task_id) {
      updateTask(options.sessionDir, options.sessionId, args.task_id, {
        status: "pending",
        owner: args.owner || subagentName,
        notes: `Subagent failed: ${err.message}`,
      });
    }
    return { output: `Subagent failed: ${err.message}`, error: true };
  }
}
