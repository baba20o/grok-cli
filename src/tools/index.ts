import type { ToolResult } from "../types.js";
import { toolCapabilities, toolDefinitions } from "./definitions.js";
import { executeBash } from "./bash.js";
import { executeAskUserQuestion } from "./ask-user-question.js";
import { executeLsp } from "./lsp.js";
import { executeToolSearch } from "./tool-search.js";
import { executeMemorySearch } from "./memory-search.js";
import { executeRememberMemory } from "./remember-memory.js";
import { executeForgetMemory } from "./forget-memory.js";
import { executeTodoWrite } from "./todo-write.js";
import { executeTaskCreate } from "./task-create.js";
import { executeTaskList } from "./task-list.js";
import { executeTaskGet } from "./task-get.js";
import { executeTaskUpdate } from "./task-update.js";
import { executeScheduleCreate } from "./schedule-create.js";
import { executeScheduleList } from "./schedule-list.js";
import { executeScheduleDelete } from "./schedule-delete.js";
import { executeWebFetch } from "./web-fetch.js";
import { executeNotebookEdit } from "./notebook-edit.js";
import { executeMcpListResources } from "./mcp-list-resources.js";
import { executeMcpReadResource } from "./mcp-read-resource.js";
import { executeSpawnSubagent } from "./spawn-subagent.js";
import { executeReadFile } from "./read-file.js";
import { executeWriteFile } from "./write-file.js";
import { executeEditFile } from "./edit-file.js";
import { executeGlob } from "./glob.js";
import { executeGrep } from "./grep.js";
import { executeListDir } from "./list-dir.js";
import { finalizeToolResult } from "../tool-result-storage.js";
import type { GrokConfig, MemorySettings, SandboxMode } from "../types.js";

export { toolDefinitions };

export interface ToolExecutionOptions {
  sandboxMode?: SandboxMode;
  allowedReadRoots?: string[];
  resultStoreDir?: string;
  toolCallId?: string;
  maxOutputTokens?: number;
  sessionDir?: string;
  sessionId?: string;
  memorySettings?: MemorySettings;
  config?: GrokConfig;
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
  todo_write: {
    executor: executeTodoWrite,
    ...toolCapabilities.todo_write,
  },
  task_create: {
    executor: executeTaskCreate,
    ...toolCapabilities.task_create,
  },
  task_list: {
    executor: executeTaskList,
    ...toolCapabilities.task_list,
  },
  task_get: {
    executor: executeTaskGet,
    ...toolCapabilities.task_get,
  },
  task_update: {
    executor: executeTaskUpdate,
    ...toolCapabilities.task_update,
  },
  schedule_create: {
    executor: executeScheduleCreate,
    ...toolCapabilities.schedule_create,
  },
  schedule_list: {
    executor: executeScheduleList,
    ...toolCapabilities.schedule_list,
  },
  schedule_delete: {
    executor: executeScheduleDelete,
    ...toolCapabilities.schedule_delete,
  },
  web_fetch: {
    executor: executeWebFetch,
    ...toolCapabilities.web_fetch,
  },
  notebook_edit: {
    executor: executeNotebookEdit,
    ...toolCapabilities.notebook_edit,
  },
  mcp_list_resources: {
    executor: executeMcpListResources,
    ...toolCapabilities.mcp_list_resources,
  },
  mcp_read_resource: {
    executor: executeMcpReadResource,
    ...toolCapabilities.mcp_read_resource,
  },
  spawn_subagent: {
    executor: executeSpawnSubagent,
    ...toolCapabilities.spawn_subagent,
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
