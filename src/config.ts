import { config as loadEnv } from "dotenv";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { GrokConfig, ServerTool, McpServer, HooksConfig, ConfigFile, ApprovalPolicy } from "./types.js";

// Load .env
const envPaths = [
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), "..", ".env"),
  path.join(os.homedir(), ".grok-cli", ".env"),
];
for (const p of envPaths) {
  if (fs.existsSync(p)) { loadEnv({ path: p }); break; }
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

/** Load config file from ~/.grok-cli/config.json */
function loadConfigFile(): ConfigFile {
  const configPath = path.join(getBaseDir(), "config.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

export function getConfig(overrides: Partial<GrokConfig> = {}): GrokConfig {
  const fileConfig = loadConfigFile();
  const apiKey = overrides.apiKey || process.env.XAI_API_KEY || process.env.xAI_API_KEY || "";

  if (!apiKey) {
    console.error(
      "Error: XAI_API_KEY not set.\n" +
      "Get one at https://console.x.ai/team/default/api-keys\n" +
      "Then: export XAI_API_KEY=your_key_here"
    );
    process.exit(1);
  }

  // Merge MCP servers from config file
  const mcpServers: McpServer[] = overrides.mcpServers || [];
  if (fileConfig.mcp_servers) {
    for (const [label, url] of Object.entries(fileConfig.mcp_servers)) {
      if (!mcpServers.some(m => m.url === url)) {
        mcpServers.push({ label, url });
      }
    }
  }

  // Merge server tools from config file
  const serverTools: ServerTool[] = overrides.serverTools || [];
  if (fileConfig.server_tools) {
    for (const st of fileConfig.server_tools) {
      if (!serverTools.includes(st)) serverTools.push(st);
    }
  }

  const needsResponsesApi =
    overrides.useResponsesApi ||
    serverTools.length > 0 ||
    mcpServers.length > 0 ||
    (overrides.fileAttachments && overrides.fileAttachments.length > 0);

  return {
    apiKey,
    baseUrl: overrides.baseUrl || process.env.XAI_BASE_URL || "https://api.x.ai/v1",
    model: overrides.model || fileConfig.model || process.env.GROK_MODEL || MODELS.default,
    maxTokens: overrides.maxTokens || 16384,
    timeout: overrides.timeout || 600_000,
    reasoningEffort: overrides.reasoningEffort || "high",
    showReasoning: overrides.showReasoning ?? fileConfig.show_reasoning ?? false,
    showToolCalls: overrides.showToolCalls ?? true,
    showUsage: overrides.showUsage ?? fileConfig.show_usage ?? false,
    showCitations: overrides.showCitations ?? fileConfig.show_citations ?? true,
    showDiffs: overrides.showDiffs ?? fileConfig.show_diffs ?? true,
    maxToolRounds: overrides.maxToolRounds || fileConfig.max_turns || 50,
    serverTools,
    useResponsesApi: !!needsResponsesApi,
    sessionDir: getBaseDir(),
    mcpServers,
    imageInputs: overrides.imageInputs || [],
    fileAttachments: overrides.fileAttachments || [],
    jsonSchema: overrides.jsonSchema || null,
    approvalPolicy: overrides.approvalPolicy || fileConfig.approval_policy || "always-approve",
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
