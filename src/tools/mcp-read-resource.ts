import { readMcpResource } from "../mcp-http.js";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

export async function executeMcpReadResource(args: {
  server: string;
  uri: string;
}, _projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  try {
    const result = await readMcpResource(
      args.server,
      args.uri,
      options.config?.mcpServers || [],
    );

    if (result.contents.length === 0) {
      return { output: `MCP resource returned no content: ${result.uri}` };
    }

    const body = result.contents.map((item) => {
      if (typeof item?.text === "string") return item.text;
      if (typeof item?.uri === "string") return JSON.stringify(item, null, 2);
      if (typeof item === "string") return item;
      return JSON.stringify(item, null, 2);
    }).join("\n\n");

    return {
      output: [
        `Server: ${result.server}`,
        `URI: ${result.uri}`,
        "",
        body,
      ].join("\n"),
    };
  } catch (err: any) {
    return { output: err.message, error: true };
  }
}
