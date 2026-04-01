import type { ToolResult } from "../types.js";
import { toolCapabilities, toolDefinitions } from "./definitions.js";
import { executeBash } from "./bash.js";
import { executeAskUserQuestion } from "./ask-user-question.js";
import { executeLsp } from "./lsp.js";
import { executeToolSearch } from "./tool-search.js";
import { executeMemorySearch } from "./memory-search.js";
import { executeRememberMemory } from "./remember-memory.js";
import { executeForgetMemory } from "./forget-memory.js";
import { executeReadFile } from "./read-file.js";
import { executeWriteFile } from "./write-file.js";
import { executeEditFile } from "./edit-file.js";
import { executeGlob } from "./glob.js";
import { executeGrep } from "./grep.js";
import { executeListDir } from "./list-dir.js";
import { finalizeToolResult } from "../tool-result-storage.js";
import type { MemorySettings, SandboxMode } from "../types.js";

export { toolDefinitions };

export interface ToolExecutionOptions {
  sandboxMode?: SandboxMode;
  allowedReadRoots?: string[];
  resultStoreDir?: string;
  toolCallId?: string;
  maxOutputTokens?: number;
  sessionDir?: string;
  memorySettings?: MemorySettings;
}

type ToolExecutor = (args: any, cwd: string, options: ToolExecutionOptions) => Promise<ToolResult>;

interface RegisteredTool {
  executor: ToolExecutor;
  readOnly: boolean;
  concurrencySafe: boolean;
}

const registry: Record<string, RegisteredTool> = {
  bash: {
    executor: executeBash,
    ...toolCapabilities.bash,
  },
  ask_user_question: {
    executor: executeAskUserQuestion,
    ...toolCapabilities.ask_user_question,
  },
  lsp: {
    executor: executeLsp,
    ...toolCapabilities.lsp,
  },
  tool_search: {
    executor: executeToolSearch,
    ...toolCapabilities.tool_search,
  },
  memory_search: {
    executor: executeMemorySearch,
    ...toolCapabilities.memory_search,
  },
  remember_memory: {
    executor: executeRememberMemory,
    ...toolCapabilities.remember_memory,
  },
  forget_memory: {
    executor: executeForgetMemory,
    ...toolCapabilities.forget_memory,
  },
  read_file: {
    executor: executeReadFile,
    ...toolCapabilities.read_file,
  },
  write_file: {
    executor: executeWriteFile,
    ...toolCapabilities.write_file,
  },
  edit_file: {
    executor: executeEditFile,
    ...toolCapabilities.edit_file,
  },
  glob: {
    executor: executeGlob,
    ...toolCapabilities.glob,
  },
  grep: {
    executor: executeGrep,
    ...toolCapabilities.grep,
  },
  list_directory: {
    executor: executeListDir,
    ...toolCapabilities.list_directory,
  },
};

let maxOutputTokens = 8000;
export function setMaxOutputTokens(n: number): void { maxOutputTokens = n; }

export function getToolMetadata(name: string): Pick<RegisteredTool, "readOnly" | "concurrencySafe"> | null {
  const tool = registry[name];
  if (!tool) return null;
  return {
    readOnly: tool.readOnly,
    concurrencySafe: tool.concurrencySafe,
  };
}

export async function executeTool(
  name: string,
  argsJson: string,
  cwd: string,
  options: ToolExecutionOptions = {},
): Promise<ToolResult> {
  const tool = registry[name];
  if (!tool) {
    return { output: `Unknown tool: ${name}`, error: true };
  }

  try {
    const args = JSON.parse(argsJson);
    const result = await tool.executor(args, cwd, options);
    return finalizeToolResult(result, name, {
      maxOutputTokens: options.maxOutputTokens || maxOutputTokens,
      resultStoreDir: options.resultStoreDir,
      toolCallId: options.toolCallId,
    });
  } catch (err: any) {
    if (err instanceof SyntaxError) {
      return { output: `Invalid tool arguments JSON: ${err.message}`, error: true };
    }
    return { output: `Tool execution error: ${err.message}`, error: true };
  }
}
