import { config as loadEnv } from "dotenv";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { normalizeServerTools } from "./server-tools.js";
import type {
  ConfigFile,
  GrokConfig,
  McpServer,
  SandboxMode,
  ServerToolConfig,
  ServerToolKind,
} from "./types.js";

const envPaths = [
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), "..", ".env"),
  path.join(os.homedir(), ".grok-cli", ".env"),
];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    loadEnv({ path: p });
    break;
  }
}

const MODELS = {
  default: "grok-4-1-fast-reasoning",
  fast: "grok-4-1-fast-reasoning",
  reasoning: "grok-4.20-0309-reasoning",
  nonReasoning: "grok-4.20-0309-non-reasoning",
  multiAgent: "grok-4.20-multi-agent-0309",
  code: "grok-code-fast-1",
} as const;

function getBaseDir(): string {
  return process.env.GROK_SESSION_DIR || path.join(os.homedir(), ".grok-cli");
}

function getManagementBaseUrl(): string {
  return process.env.XAI_MANAGEMENT_BASE_URL || "https://management-api.x.ai/v1";
}

function loadConfigFile(): ConfigFile {
  const configPath = path.join(getBaseDir(), "config.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

function normalizeMcpServers(value: ConfigFile["mcp_servers"] | undefined): McpServer[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((server) => ({
      label: server.label,
      url: server.url,
      description: server.description,
      allowedTools: server.allowedTools || [],
    }));
  }
  return Object.entries(value).map(([label, url]) => ({ label, url }));
}

function mergeMcpServers(primary: McpServer[], secondary: McpServer[]): McpServer[] {
  const merged = [...primary];
  for (const server of secondary) {
    const existing = merged.find((entry) => entry.label === server.label || entry.url === server.url);
    if (!existing) {
      merged.push({ ...server, allowedTools: server.allowedTools || [] });
      continue;
    }
    existing.description = existing.description || server.description;
    existing.allowedTools = [
      ...new Set([...(existing.allowedTools || []), ...(server.allowedTools || [])]),
    ];
  }
  return merged;
}

export function getConfig(overrides: Partial<GrokConfig> = {}): GrokConfig {
  const fileConfig = loadConfigFile();
  const apiKey = overrides.apiKey || process.env.XAI_API_KEY || process.env.xAI_API_KEY || "";
  const managementApiKey =
    overrides.managementApiKey ||
    fileConfig.management_api_key ||
    process.env.XAI_MANAGEMENT_API_KEY ||
    process.env.GROK_MANAGEMENT_API_KEY ||
    "";

  if (!apiKey) {
    console.error(
      "Error: XAI_API_KEY not set.\n" +
      "Get one at https://console.x.ai/team/default/api-keys\n" +
      "Then: export XAI_API_KEY=your_key_here",
    );
    process.exit(1);
  }

  const fileMcpServers = normalizeMcpServers(fileConfig.mcp_servers);
  const mcpServers = mergeMcpServers(fileMcpServers, overrides.mcpServers || []);

  const fileServerTools = normalizeServerTools(fileConfig.server_tools);
  const overrideServerTools = normalizeServerTools(
    overrides.serverTools as Array<ServerToolKind | ServerToolConfig> | undefined,
  );
  const serverTools = normalizeServerTools([...fileServerTools, ...overrideServerTools]);

  const needsResponsesApi =
    overrides.useResponsesApi ||
    serverTools.length > 0 ||
    mcpServers.length > 0 ||
    (overrides.fileAttachments && overrides.fileAttachments.length > 0);

  const sandboxMode =
    overrides.sandboxMode ||
    fileConfig.sandbox_mode ||
    (process.env.GROK_SANDBOX_MODE as SandboxMode | undefined) ||
    "danger-full-access";

  return {
    apiKey,
    managementApiKey,
    baseUrl: overrides.baseUrl || process.env.XAI_BASE_URL || "https://api.x.ai/v1",
    managementBaseUrl:
      overrides.managementBaseUrl || fileConfig.management_base_url || getManagementBaseUrl(),
    model: overrides.model || fileConfig.model || process.env.GROK_MODEL || MODELS.default,
    maxTokens: overrides.maxTokens || 16384,
    timeout: overrides.timeout || 600_000,
    reasoningEffort: overrides.reasoningEffort || "high",
    showReasoning: overrides.showReasoning ?? fileConfig.show_reasoning ?? false,
    showToolCalls: overrides.showToolCalls ?? true,
    showUsage: overrides.showUsage ?? fileConfig.show_usage ?? false,
    showCitations: overrides.showCitations ?? fileConfig.show_citations ?? true,
    showDiffs: overrides.showDiffs ?? fileConfig.show_diffs ?? true,
    showServerToolUsage:
      overrides.showServerToolUsage ?? fileConfig.show_server_tool_usage ?? false,
    maxToolRounds: overrides.maxToolRounds || fileConfig.max_turns || 50,
    serverTools,
    useResponsesApi: !!needsResponsesApi,
    sessionDir: getBaseDir(),
    mcpServers,
    imageInputs: overrides.imageInputs || [],
    fileAttachments: overrides.fileAttachments || [],
    jsonSchema: overrides.jsonSchema || null,
    approvalPolicy: overrides.approvalPolicy || fileConfig.approval_policy || "always-approve",
    sandboxMode,
    toolApprovals: {
      defaultMode: overrides.toolApprovals?.defaultMode || fileConfig.tool_approvals?.defaultMode,
      tools: {
        ...(fileConfig.tool_approvals?.tools || {}),
        ...(overrides.toolApprovals?.tools || {}),
      },
    },
    includeToolOutputs:
      overrides.includeToolOutputs ?? fileConfig.include_tool_outputs ?? false,
    notify: overrides.notify ?? fileConfig.notify ?? false,
    hooks: overrides.hooks || fileConfig.hooks || {},
    convId: overrides.convId || null,
    jsonOutput: overrides.jsonOutput ?? false,
    ephemeral: overrides.ephemeral ?? false,
    outputFile: overrides.outputFile || null,
    color: overrides.color || "auto",
    maxOutputTokens: overrides.maxOutputTokens || 8000,
  };
}

export { MODELS };
