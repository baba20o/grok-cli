import { config as loadEnv } from "dotenv";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { isMultiAgentModel, normalizeReasoningEffort } from "./model-capabilities.js";
import { normalizeServerTools } from "./server-tools.js";
import type {
  ConfigFile,
  GrokConfig,
  McpServer,
  MemoryScope,
  ReasoningEffort,
  SandboxMode,
  ServerToolConfig,
  ServerToolKind,
} from "./types.js";

const DEFAULT_BASE_DIR = path.join(os.homedir(), ".grok");
const LEGACY_BASE_DIRS = [
  path.join(os.homedir(), ".grok-cli"),
  path.join(os.homedir(), ".grok-agent"),
];

const envPaths = [
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), "..", ".env"),
  path.join(DEFAULT_BASE_DIR, ".env"),
  ...LEGACY_BASE_DIRS.map((dir) => path.join(dir, ".env")),
];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    loadEnv({ path: p });
    break;
  }
}

const MODELS = {
  default: "grok-4.20-0309-reasoning",
  fast: "grok-4-1-fast-reasoning",
  reasoning: "grok-4.20-0309-reasoning",
  nonReasoning: "grok-4.20-0309-non-reasoning",
  multiAgent: "grok-4.20-multi-agent-0309",
  code: "grok-code-fast-1",
} as const;

function readEnvBoolean(name: string): boolean | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  return undefined;
}

function copyLegacyBaseDirIfNeeded(targetDir: string): void {
  if (process.env.GROK_SESSION_DIR) return;
  if (fs.existsSync(targetDir)) return;

  for (const legacyDir of LEGACY_BASE_DIRS) {
    if (!fs.existsSync(legacyDir)) continue;
    try {
      fs.mkdirSync(path.dirname(targetDir), { recursive: true });
      fs.cpSync(legacyDir, targetDir, { recursive: true, force: false, errorOnExist: false });
      return;
    } catch {
      return;
    }
  }
}

function getBaseDir(): string {
  if (process.env.GROK_SESSION_DIR) return process.env.GROK_SESSION_DIR;
  copyLegacyBaseDirIfNeeded(DEFAULT_BASE_DIR);
  return DEFAULT_BASE_DIR;
}

function getManagementBaseUrl(): string {
  return process.env.XAI_MANAGEMENT_BASE_URL || "https://management-api.x.ai/v1";
}

function loadConfigFile(): ConfigFile {
  const configPath = path.join(getBaseDir(), "config.json");
  if (!fs.existsSync(configPath)) {
    for (const legacyDir of LEGACY_BASE_DIRS) {
      const legacyPath = path.join(legacyDir, "config.json");
      if (!fs.existsSync(legacyPath)) continue;
      try {
        return JSON.parse(fs.readFileSync(legacyPath, "utf-8"));
      } catch {
        return {};
      }
    }
    return {};
  }
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
      authToken: server.authToken,
      authTokenEnv: server.authTokenEnv,
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
    existing.authToken = existing.authToken || server.authToken;
    existing.authTokenEnv = existing.authTokenEnv || server.authTokenEnv;
    existing.allowedTools = [
      ...new Set([...(existing.allowedTools || []), ...(server.allowedTools || [])]),
    ];
  }
  return merged;
}

function resolveMemoryScope(value: string | undefined): MemoryScope {
  return value === "user" ? "user" : "project";
}

export function getConfig(overrides: Partial<GrokConfig> = {}): GrokConfig {
  const fileConfig = loadConfigFile();
  const jsonOutput = overrides.jsonOutput ?? false;
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
  const model = overrides.model || fileConfig.model || process.env.GROK_MODEL || MODELS.default;
  const reasoningEffort = normalizeReasoningEffort(
    overrides.reasoningEffort ||
      fileConfig.reasoning_effort ||
      process.env.GROK_REASONING_EFFORT,
    "high",
  );

  const needsResponsesApi =
    overrides.useResponsesApi ||
    isMultiAgentModel(model) ||
    serverTools.length > 0 ||
    mcpServers.length > 0 ||
    (overrides.fileAttachments && overrides.fileAttachments.length > 0);

  const sandboxMode =
    overrides.sandboxMode ||
    fileConfig.sandbox_mode ||
    (process.env.GROK_SANDBOX_MODE as SandboxMode | undefined) ||
    "danger-full-access";

  const fileMemory = fileConfig.memory || {};
  const memory = {
    enabled: overrides.memory?.enabled ??
      fileMemory.enabled ??
      readEnvBoolean("GROK_MEMORY_ENABLED") ??
      true,
    autoRecall: overrides.memory?.autoRecall ??
      fileMemory.auto_recall ??
      readEnvBoolean("GROK_MEMORY_AUTO_RECALL") ??
      true,
    useSemanticRecall: overrides.memory?.useSemanticRecall ??
      fileMemory.use_semantic_recall ??
      readEnvBoolean("GROK_MEMORY_SEMANTIC_RECALL") ??
      true,
    recallLimit: overrides.memory?.recallLimit ??
      fileMemory.recall_limit ??
      (process.env.GROK_MEMORY_RECALL_LIMIT ? parseInt(process.env.GROK_MEMORY_RECALL_LIMIT, 10) : undefined) ??
      3,
    selectorModel: overrides.memory?.selectorModel ??
      fileMemory.selector_model ??
      process.env.GROK_MEMORY_SELECTOR_MODEL ??
      MODELS.fast,
    defaultScope: resolveMemoryScope(
      overrides.memory?.defaultScope ||
      fileMemory.default_scope ||
      process.env.GROK_MEMORY_DEFAULT_SCOPE,
    ),
  };

  return {
    apiKey,
    managementApiKey,
    baseUrl: overrides.baseUrl || process.env.XAI_BASE_URL || "https://api.x.ai/v1",
    managementBaseUrl:
      overrides.managementBaseUrl || fileConfig.management_base_url || getManagementBaseUrl(),
    model,
    maxTokens: overrides.maxTokens || 16384,
    timeout: overrides.timeout || 600_000,
    reasoningEffort,
    showReasoning: overrides.showReasoning ?? fileConfig.show_reasoning ?? false,
    showToolCalls: jsonOutput ? false : (overrides.showToolCalls ?? true),
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
    jsonOutput,
    ephemeral: overrides.ephemeral ?? false,
    outputFile: overrides.outputFile || null,
    color: overrides.color || "auto",
    maxOutputTokens: overrides.maxOutputTokens || 8000,
    researchVerboseStreaming:
      overrides.researchVerboseStreaming ??
      fileConfig.research_verbose_streaming ??
      readEnvBoolean("GROK_RESEARCH_VERBOSE_STREAMING") ??
      false,
    useEncryptedContent:
      overrides.useEncryptedContent ??
      fileConfig.use_encrypted_content ??
      readEnvBoolean("GROK_USE_ENCRYPTED_CONTENT") ??
      false,
    memory,
  };
}

export { MODELS };
