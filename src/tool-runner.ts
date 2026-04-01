import { checkApproval } from "./approvals.js";
import { runHooks } from "./hooks.js";
import { emitEvent, emitToolCall, emitToolResult } from "./json-output.js";
import { executeTool, getToolMetadata } from "./tools/index.js";
import { formatToolCall, formatToolResult } from "./stream.js";
import { getToolResultsDir } from "./tool-result-storage.js";
import { getMemoryReadRoots } from "./memory.js";
import type {
  GrokConfig,
  SerializedToolCall,
  ToolResult,
} from "./types.js";
import type { SessionManager } from "./session.js";

export interface ToolRunSession {
  manager: SessionManager;
  id: string;
}

export interface ToolRunContext {
  config: GrokConfig;
  cwd: string;
  verbose: boolean;
  showToolCalls: boolean;
  session: ToolRunSession | null;
  sessionId: string;
}

export interface ExecutedToolCall {
  call: SerializedToolCall;
  result: ToolResult;
}

type PreparedToolCall = {
  call: SerializedToolCall;
  skipped?: ToolResult;
};

function logToolCall(call: SerializedToolCall, ctx: ToolRunContext): void {
  emitToolCall(call.name, call.arguments, call.id);
  if (ctx.showToolCalls) {
    console.error(formatToolCall(call.name, call.arguments, ctx.verbose));
  }
}

function logToolResult(callId: string, result: ToolResult, ctx: ToolRunContext): void {
  if (ctx.showToolCalls) {
    console.error(formatToolResult(result.output, result.error || false));
  }
  emitToolResult(callId, result.output, result.error || false);
  if (result.metadata?.persisted) {
    emitEvent({
      type: "tool.persisted",
      call_id: callId,
      ...result.metadata.persisted,
    });
  }
}

async function prepareToolCall(
  call: SerializedToolCall,
  ctx: ToolRunContext,
): Promise<PreparedToolCall> {
  logToolCall(call, ctx);

  const approved = await checkApproval(ctx.config, call.name, call.arguments);
  if (!approved) {
    return {
      call,
      skipped: { output: "Tool execution denied by user.", error: true },
    };
  }

  runHooks(ctx.config.hooks, {
    type: "pre-tool",
    tool: call.name,
    args: call.arguments,
    sessionId: ctx.session?.id || ctx.sessionId,
  });

  return { call };
}

async function executePreparedToolCall(
  prepared: PreparedToolCall,
  ctx: ToolRunContext,
): Promise<ExecutedToolCall> {
  if (prepared.skipped) {
    return { call: prepared.call, result: prepared.skipped };
  }

  const result = await executeTool(prepared.call.name, prepared.call.arguments, ctx.cwd, {
    sandboxMode: ctx.config.sandboxMode,
    allowedReadRoots: [
      getToolResultsDir(ctx.config.sessionDir, ctx.sessionId),
      ...getMemoryReadRoots(ctx.config.sessionDir, ctx.cwd),
    ],
    resultStoreDir: getToolResultsDir(ctx.config.sessionDir, ctx.sessionId),
    toolCallId: prepared.call.id,
    maxOutputTokens: ctx.config.maxOutputTokens,
    sessionDir: ctx.config.sessionDir,
    sessionId: ctx.sessionId,
    memorySettings: ctx.config.memory,
    config: ctx.config,
  });

  return {
    call: prepared.call,
    result,
  };
}

function finalizeExecutedToolCall(
  executed: ExecutedToolCall,
  ctx: ToolRunContext,
): void {
  runHooks(ctx.config.hooks, {
    type: "post-tool",
    tool: executed.call.name,
    args: executed.call.arguments,
    output: executed.result.output,
    error: executed.result.error,
    sessionId: ctx.session?.id || ctx.sessionId,
  });

  logToolResult(executed.call.id, executed.result, ctx);

  if (ctx.session) {
    ctx.session.manager.appendToolExec(
      ctx.session.id,
      executed.call.name,
      executed.call.arguments,
      executed.result.output,
      executed.result.error || false,
    );
    ctx.session.manager.appendMessage(ctx.session.id, "tool", executed.result.output, {
      toolCallId: executed.call.id,
    });
  }
}

function partitionToolCalls(calls: SerializedToolCall[]): SerializedToolCall[][] {
  const batches: SerializedToolCall[][] = [];

  for (const call of calls) {
    const metadata = getToolMetadata(call.name);
    const isConcurrencySafe = !!metadata?.readOnly && !!metadata?.concurrencySafe;
    const previous = batches.at(-1);
    const previousSafe =
      previous &&
      previous.every((entry) => {
        const info = getToolMetadata(entry.name);
        return !!info?.readOnly && !!info?.concurrencySafe;
      });

    if (isConcurrencySafe && previous && previousSafe) {
      previous.push(call);
      continue;
    }

    batches.push([call]);
  }

  return batches;
}

async function runBatch(
  batch: SerializedToolCall[],
  ctx: ToolRunContext,
): Promise<ExecutedToolCall[]> {
  const prepared: PreparedToolCall[] = [];
  for (const call of batch) {
    prepared.push(await prepareToolCall(call, ctx));
  }

  const safeBatch = batch.length > 1 && batch.every((call) => {
    const metadata = getToolMetadata(call.name);
    return !!metadata?.readOnly && !!metadata?.concurrencySafe;
  });

  if (!safeBatch) {
    const results: ExecutedToolCall[] = [];
    for (const item of prepared) {
      const executed = await executePreparedToolCall(item, ctx);
      finalizeExecutedToolCall(executed, ctx);
      results.push(executed);
    }
    return results;
  }

  const executed = await Promise.all(
    prepared.map((item) => executePreparedToolCall(item, ctx)),
  );
  for (const item of executed) {
    finalizeExecutedToolCall(item, ctx);
  }
  return executed;
}

export async function runLocalToolCalls(
  calls: SerializedToolCall[],
  ctx: ToolRunContext,
): Promise<ExecutedToolCall[]> {
  const results: ExecutedToolCall[] = [];

  for (const batch of partitionToolCalls(calls)) {
    results.push(...await runBatch(batch, ctx));
  }

  return results;
}
