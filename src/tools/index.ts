import type { ToolResult } from "../types.js";
import { toolDefinitions } from "./definitions.js";
import { executeBash } from "./bash.js";
import { executeReadFile } from "./read-file.js";
import { executeWriteFile } from "./write-file.js";
import { executeEditFile } from "./edit-file.js";
import { executeGlob } from "./glob.js";
import { executeGrep } from "./grep.js";
import { executeListDir } from "./list-dir.js";

export { toolDefinitions };

type ToolExecutor = (args: any, cwd: string) => Promise<ToolResult>;

const executors: Record<string, ToolExecutor> = {
  bash: executeBash,
  read_file: executeReadFile,
  write_file: executeWriteFile,
  edit_file: executeEditFile,
  glob: executeGlob,
  grep: executeGrep,
  list_directory: executeListDir,
};

export async function executeTool(
  name: string,
  argsJson: string,
  cwd: string,
): Promise<ToolResult> {
  const executor = executors[name];
  if (!executor) {
    return { output: `Unknown tool: ${name}`, error: true };
  }

  try {
    const args = JSON.parse(argsJson);
    return await executor(args, cwd);
  } catch (err: any) {
    if (err instanceof SyntaxError) {
      return { output: `Invalid tool arguments JSON: ${err.message}`, error: true };
    }
    return { output: `Tool execution error: ${err.message}`, error: true };
  }
}
