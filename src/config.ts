import { config as loadEnv } from "dotenv";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { GrokConfig, ServerTool, McpServer } from "./types.js";

// Load .env from project root or home directory
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

function getSessionDir(): string {
  return process.env.GROK_SESSION_DIR || path.join(os.homedir(), ".grok-cli");
}

export function getConfig(overrides: Partial<GrokConfig> = {}): GrokConfig {
  const apiKey = overrides.apiKey || process.env.XAI_API_KEY || process.env.xAI_API_KEY || "";

  if (!apiKey) {
    console.error(
      "Error: XAI_API_KEY not set.\n" +
      "Get an API key at https://console.x.ai/team/default/api-keys\n" +
      "Then set it: export XAI_API_KEY=your_key_here"
    );
    process.exit(1);
  }

  const serverTools = overrides.serverTools || [];
  const mcpServers = overrides.mcpServers || [];

  // Auto-enable Responses API when advanced features are used
  const needsResponsesApi =
    overrides.useResponsesApi ||
    serverTools.length > 0 ||
    mcpServers.length > 0 ||
    (overrides.fileAttachments && overrides.fileAttachments.length > 0);

  return {
    apiKey,
    baseUrl: overrides.baseUrl || process.env.XAI_BASE_URL || "https://api.x.ai/v1",
    model: overrides.model || process.env.GROK_MODEL || MODELS.default,
    maxTokens: overrides.maxTokens || 16384,
    timeout: overrides.timeout || 600_000,
    reasoningEffort: overrides.reasoningEffort || "high",
    showReasoning: overrides.showReasoning ?? false,
    showToolCalls: overrides.showToolCalls ?? true,
    showUsage: overrides.showUsage ?? false,
    showCitations: overrides.showCitations ?? true,
    maxToolRounds: overrides.maxToolRounds || 50,
    serverTools,
    useResponsesApi: !!needsResponsesApi,
    sessionDir: overrides.sessionDir || getSessionDir(),
    mcpServers,
    imageInputs: overrides.imageInputs || [],
    fileAttachments: overrides.fileAttachments || [],
    jsonSchema: overrides.jsonSchema || null,
  };
}

export { MODELS };
