import { listMcpResources } from "../mcp-http.js";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

export async function executeMcpListResources(args: {
  server: string;
  cursor?: string;
}, _projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  try {
    const result = await listMcpResources(
      args.server,
      options.config?.mcpServers || [],
      args.cursor,
    );
    if (result.resources.length === 0) {
      return { output: `No MCP resources found on ${result.server}.` };
    }

    return {
      output: result.resources.map((resource) =>
        `${resource.uri} ${resource.name ? `- ${resource.name}` : ""}`.trim()
      ).join("\n"),
    };
  } catch (err: any) {
    return { output: err.message, error: true };
  }
}
