import { rememberMemory } from "../memory.js";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

export async function executeRememberMemory(
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

  const title = String(args.title || "").trim();
  const content = String(args.content || "").trim();
  if (!title) return { output: "title is required", error: true };
  if (!content) return { output: "content is required", error: true };

  try {
    const entry = rememberMemory(options.sessionDir, cwd, {
      id: args.id ? String(args.id) : undefined,
      title,
      description: args.description ? String(args.description) : undefined,
      content,
      type: args.type,
      scope: args.scope || options.memorySettings?.defaultScope || "project",
    });
    return {
      output:
        `Saved memory ${entry.id}\n` +
        `  file: ${entry.filePath}\n` +
        `  description: ${entry.description}`,
    };
  } catch (err: any) {
    return { output: `Failed to save memory: ${err.message}`, error: true };
  }
}
