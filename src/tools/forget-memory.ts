import { forgetMemory } from "../memory.js";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

export async function executeForgetMemory(
  args: any,
  cwd: string,
  options: ToolExecutionOptions,
): Promise<ToolResult> {
  if (options.memorySettings?.enabled === false) {
    return { output: "Persistent memory is disabled in config.", error: true };
  }
  if (!options.sessionDir) {
    return { output: "Memory storage is unavailable for this tool call.", error: true };
  }
  if (options.sandboxMode === "read-only") {
    return { output: "Sandbox policy (read-only) blocks memory writes.", error: true };
  }

  const id = String(args.id || "").trim();
  if (!id) {
    return { output: "id is required", error: true };
  }

  const scope = args.scope === "user" || args.scope === "project" || args.scope === "all"
    ? args.scope
    : "all";
  const entry = forgetMemory(options.sessionDir, cwd, id, scope);
  if (!entry) {
    return { output: `Memory not found: ${id}`, error: true };
  }

  return {
    output: `Deleted memory ${entry.id}\n  file: ${entry.filePath}`,
  };
}
