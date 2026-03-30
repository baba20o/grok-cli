import type { ToolResult } from "../types.js";
import { toolDefinitions } from "./definitions.js";
import { executeBash } from "./bash.js";
import { executeReadFile } from "./read-file.js";
import { executeWriteFile } from "./write-file.js";
import { executeEditFile } from "./edit-file.js";
import { executeGlob } from "./glob.js";
import { executeGrep } from "./grep.js";
import { executeListDir } from "./list-dir.js";
import { truncateOutput } from "../truncation.js";
import type { SandboxMode } from "../types.js";

export { toolDefinitions };

export interface ToolExecutionOptions {
  sandboxMode?: SandboxMode;
}

type ToolExecutor = (args: any, cwd: string, options: ToolExecutionOptions) => Promise<ToolResult>;

const executors: Record<string, ToolExecutor> = {
  bash: executeBash,
  read_file: executeReadFile,
  write_file: executeWriteFile,
  edit_file: executeEditFile,
  glob: executeGlob,
  grep: executeGrep,
  list_directory: executeListDir,
};

let maxOutputTokens = 8000;
export function setMaxOutputTokens(n: number): void { maxOutputTokens = n; }

export async function executeTool(
  name: string,
  argsJson: string,
  cwd: string,
  options: ToolExecutionOptions = {},
): Promise<ToolResult> {
  const executor = executors[name];
  if (!executor) {
    return { output: `Unknown tool: ${name}`, error: true };
  }

  try {
    const args = JSON.parse(argsJson);
    const result = await executor(args, cwd, options);
    // Truncate large outputs to prevent context window blowup
    result.output = truncateOutput(result.output, maxOutputTokens);
    return result;
  } catch (err: any) {
    if (err instanceof SyntaxError) {
      return { output: `Invalid tool arguments JSON: ${err.message}`, error: true };
    }
    return { output: `Tool execution error: ${err.message}`, error: true };
  }
}
