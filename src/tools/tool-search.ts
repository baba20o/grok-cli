import { searchToolDefinitions } from "./definitions.js";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

export async function executeToolSearch(args: {
  query: string;
  max_results?: number;
}, _projectCwd: string, _options: ToolExecutionOptions): Promise<ToolResult> {
  const maxResults = Math.min(Math.max(args.max_results || 5, 1), 10);
  const matches = searchToolDefinitions(args.query || "", maxResults);

  if (matches.length === 0) {
    return {
      output: `No matching tools found for "${args.query}".`,
    };
  }

  return {
    output: matches
      .map((match) => `- ${match.name}: ${match.description}`)
      .join("\n"),
  };
}
