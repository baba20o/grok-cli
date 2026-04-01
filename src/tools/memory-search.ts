import { formatMemorySummary, searchMemories } from "../memory.js";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

export async function executeMemorySearch(
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

  const query = String(args.query || "").trim();
  if (!query) {
    return { output: "query is required", error: true };
  }

  const scope = args.scope === "user" || args.scope === "project" || args.scope === "all"
    ? args.scope
    : "all";
  const limit = typeof args.limit === "number" ? args.limit : 5;
  const includeContent = !!args.include_content;

  const matches = searchMemories(options.sessionDir, cwd, query, { scope, limit });
  if (matches.length === 0) {
    return { output: `No memories matched "${query}".` };
  }

  return {
    output: matches.map((entry) => formatMemorySummary(entry, includeContent)).join("\n\n"),
  };
}
