import type {
  CodeExecutionToolConfig,
  FileSearchToolConfig,
  McpServer,
  ServerToolConfig,
  ServerToolKind,
  WebSearchToolConfig,
  XSearchToolConfig,
} from "./types.js";

export function normalizeServerTools(
  tools: Array<ServerToolKind | ServerToolConfig> | undefined,
): ServerToolConfig[] {
  if (!tools) return [];

  const normalized: ServerToolConfig[] = [];
  for (const tool of tools) {
    const candidate =
      typeof tool === "string"
        ? normalizeLegacyTool(tool)
        : tool;
    if (!candidate) continue;
    const merged = mergeServerTool(normalized, candidate);
    if (!merged) normalized.push(candidate);
  }
  return normalized;
}

function normalizeLegacyTool(tool: ServerToolKind): ServerToolConfig | null {
  if (tool === "file_search") return null;
  return { type: tool };
}

function mergeServerTool(
  tools: ServerToolConfig[],
  candidate: ServerToolConfig,
): boolean {
  const existing = tools.find((tool) => sameServerTool(tool, candidate));
  if (!existing) return false;

  if (existing.type === "web_search" && candidate.type === "web_search") {
    existing.filters = {
      allowedDomains: uniqueStrings([
        ...(existing.filters?.allowedDomains || []),
        ...(candidate.filters?.allowedDomains || []),
      ]),
      excludedDomains: uniqueStrings([
        ...(existing.filters?.excludedDomains || []),
        ...(candidate.filters?.excludedDomains || []),
      ]),
    };
    existing.enableImageUnderstanding =
      existing.enableImageUnderstanding || candidate.enableImageUnderstanding;
    existing.includeSources = existing.includeSources || candidate.includeSources;
    return true;
  }

  if (existing.type === "x_search" && candidate.type === "x_search") {
    existing.allowedXHandles = uniqueStrings([
      ...(existing.allowedXHandles || []),
      ...(candidate.allowedXHandles || []),
    ]);
    existing.excludedXHandles = uniqueStrings([
      ...(existing.excludedXHandles || []),
      ...(candidate.excludedXHandles || []),
    ]);
    existing.fromDate = existing.fromDate || candidate.fromDate;
    existing.toDate = existing.toDate || candidate.toDate;
    existing.enableImageUnderstanding =
      existing.enableImageUnderstanding || candidate.enableImageUnderstanding;
    existing.enableVideoUnderstanding =
      existing.enableVideoUnderstanding || candidate.enableVideoUnderstanding;
    return true;
  }

  if (existing.type === "code_execution" && candidate.type === "code_execution") {
    existing.includeOutputs = existing.includeOutputs || candidate.includeOutputs;
    return true;
  }

  if (existing.type === "file_search" && candidate.type === "file_search") {
    existing.collectionIds = uniqueStrings([
      ...existing.collectionIds,
      ...candidate.collectionIds,
    ]);
    existing.retrievalMode = candidate.retrievalMode || existing.retrievalMode;
    existing.maxNumResults = candidate.maxNumResults || existing.maxNumResults;
    existing.includeResults = existing.includeResults || candidate.includeResults;
    return true;
  }

  return false;
}

function sameServerTool(a: ServerToolConfig, b: ServerToolConfig): boolean {
  if (a.type !== b.type) return false;
  if (a.type !== "file_search" || b.type !== "file_search") return true;
  return true;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function hasServerTool(
  tools: ServerToolConfig[],
  kind: ServerToolKind,
): boolean {
  return tools.some((tool) => tool.type === kind);
}

export function describeServerTools(tools: ServerToolConfig[]): string[] {
  return tools.map((tool) => {
    switch (tool.type) {
      case "web_search":
        return "web search";
      case "x_search":
        return "X/Twitter search";
      case "code_execution":
        return "Python code execution (sandbox)";
      case "file_search":
        return `file search (${tool.collectionIds.length} collection${tool.collectionIds.length === 1 ? "" : "s"})`;
    }
  });
}

export function serializeServerTools(
  tools: ServerToolConfig[],
  mcpServers: McpServer[],
): any[] {
  const serialized: any[] = [];

  for (const tool of tools) {
    switch (tool.type) {
      case "web_search":
        serialized.push(serializeWebSearch(tool));
        break;
      case "x_search":
        serialized.push(serializeXSearch(tool));
        break;
      case "code_execution":
        serialized.push({ type: "code_interpreter" });
        break;
      case "file_search":
        serialized.push(serializeFileSearch(tool));
        break;
    }
  }

  for (const mcp of mcpServers) {
    const entry: any = {
      type: "mcp",
      server_url: mcp.url,
      server_label: mcp.label,
    };
    if (mcp.description) entry.server_description = mcp.description;
    if (mcp.allowedTools && mcp.allowedTools.length > 0) {
      entry.allowed_tools = mcp.allowedTools;
    }
    serialized.push(entry);
  }

  return serialized;
}

function serializeWebSearch(tool: WebSearchToolConfig): any {
  const entry: any = { type: "web_search" };
  const filters: Record<string, unknown> = {};
  if (tool.filters?.allowedDomains && tool.filters.allowedDomains.length > 0) {
    filters.allowed_domains = tool.filters.allowedDomains;
  }
  if (tool.filters?.excludedDomains && tool.filters.excludedDomains.length > 0) {
    filters.excluded_domains = tool.filters.excludedDomains;
  }
  if (Object.keys(filters).length > 0) entry.filters = filters;
  if (tool.enableImageUnderstanding) entry.enable_image_understanding = true;
  return entry;
}

function serializeXSearch(tool: XSearchToolConfig): any {
  const entry: any = { type: "x_search" };
  if (tool.allowedXHandles && tool.allowedXHandles.length > 0) {
    entry.allowed_x_handles = tool.allowedXHandles;
  }
  if (tool.excludedXHandles && tool.excludedXHandles.length > 0) {
    entry.excluded_x_handles = tool.excludedXHandles;
  }
  if (tool.fromDate) entry.from_date = tool.fromDate;
  if (tool.toDate) entry.to_date = tool.toDate;
  if (tool.enableImageUnderstanding) entry.enable_image_understanding = true;
  if (tool.enableVideoUnderstanding) entry.enable_video_understanding = true;
  return entry;
}

function serializeFileSearch(tool: FileSearchToolConfig): any {
  const entry: any = {
    type: "file_search",
    vector_store_ids: tool.collectionIds,
  };
  if (tool.maxNumResults) entry.max_num_results = tool.maxNumResults;
  if (tool.retrievalMode) {
    entry.retrieval_mode = { type: tool.retrievalMode };
  }
  return entry;
}

export function collectResponseIncludes(
  tools: ServerToolConfig[],
  includeToolOutputs: boolean,
): string[] {
  const includes: string[] = [];

  for (const tool of tools) {
    switch (tool.type) {
      case "web_search":
        if (includeToolOutputs || tool.includeSources) {
          includes.push("web_search_call.action.sources");
        }
        break;
      case "code_execution":
        if (includeToolOutputs || tool.includeOutputs) {
          includes.push("code_interpreter_call.outputs");
        }
        break;
      case "file_search":
        if (includeToolOutputs || tool.includeResults) {
          includes.push("file_search_call.results");
        }
        break;
      default:
        break;
    }
  }

  return uniqueStrings(includes);
}
