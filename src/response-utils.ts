import type { Citation } from "./types.js";

const INTERNAL_MARKUP_PREFIX_PATTERNS = [
  /^\s*<parameter name="[^"]+">[\s\S]*?<\/parameter>\s*/i,
  /^\s*<\/?xai:function_call[^>]*>\s*/i,
];

function hasInternalMarkup(text: string): boolean {
  return /<parameter name=|<\/?xai:function_call/i.test(text);
}

export function stripInternalResponseMarkup(text: string): string {
  let cleaned = text;

  while (true) {
    let next = cleaned;
    for (const pattern of INTERNAL_MARKUP_PREFIX_PATTERNS) {
      next = next.replace(pattern, "");
    }
    if (next === cleaned) break;
    cleaned = next;
  }

  return cleaned;
}

export function sanitizeResponseText(text: string): string {
  const cleaned = stripInternalResponseMarkup(text);
  if (!cleaned.trim() && hasInternalMarkup(text)) return "";
  return cleaned;
}

function normalizeServerToolName(name: string): string {
  switch (name) {
    case "web_search_calls":
      return "web_search";
    case "x_search_calls":
      return "x_search";
    case "code_interpreter_calls":
      return "code_execution";
    case "file_search_calls":
    case "document_search_calls":
      return "file_search";
    case "mcp_calls":
      return "mcp";
    default:
      return name.replace(/_calls$/, "");
  }
}

function normalizeCustomToolName(name: string): string {
  if (name.startsWith("x_")) return "x_search";
  if (name.startsWith("web_")) return "web_search";
  if (name.startsWith("document_") || name.startsWith("file_")) return "file_search";
  if (name.startsWith("mcp_")) return "mcp";
  if (name.includes("interpreter") || name.startsWith("code_")) return "code_execution";
  return name;
}

export function extractServerToolUsage(response: any): Record<string, number> | null {
  const direct = response?.server_side_tool_usage;
  if (direct && typeof direct === "object") {
    return Object.fromEntries(
      Object.entries(direct).filter(([, count]) => typeof count === "number"),
    ) as Record<string, number>;
  }

  const details = response?.usage?.server_side_tool_usage_details;
  if (!details || typeof details !== "object") return null;

  const normalized: Record<string, number> = {};
  for (const [name, count] of Object.entries(details)) {
    if (typeof count !== "number" || count <= 0) continue;
    normalized[normalizeServerToolName(name)] = count;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function getServerToolEvent(
  item: any,
): { name: string; payload: Record<string, unknown> } | null {
  if (!item || typeof item !== "object") return null;

  if (item.type === "custom_tool_call") {
    const payload: Record<string, unknown> = {};
    if (item.id) payload.id = item.id;
    if (item.call_id) payload.call_id = item.call_id;
    if (item.name) payload.tool = item.name;
    if (item.input) payload.input = item.input;
    return {
      name: normalizeCustomToolName(String(item.name || "custom_tool")),
      payload,
    };
  }

  const rawType = typeof item.type === "string" ? item.type : "";
  if (!rawType.endsWith("_call")) return null;

  const payload: Record<string, unknown> = {};
  if (item.id) payload.id = item.id;
  if (item.call_id) payload.call_id = item.call_id;
  if (item.name) payload.tool = item.name;
  if (item.input) payload.input = item.input;
  if (item.arguments) payload.arguments = item.arguments;

  return {
    name: rawType.replace(/_call$/, ""),
    payload,
  };
}

export function extractCitationsFromContent(content: any[]): Citation[] {
  const citations: Citation[] = [];

  for (const part of content || []) {
    if (!part?.annotations) continue;
    for (const annotation of part.annotations) {
      if (annotation?.type === "url_citation" || annotation?.url) {
        citations.push({ url: annotation.url, title: annotation.title });
      }
    }
  }

  return citations;
}
