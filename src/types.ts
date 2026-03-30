import type OpenAI from "openai";

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;
export type ToolDef = OpenAI.Chat.Completions.ChatCompletionTool;
export type StreamChunk = OpenAI.Chat.Completions.ChatCompletionChunk;

export interface GrokConfig {
  apiKey: string;
  managementApiKey: string;
  baseUrl: string;
  managementBaseUrl: string;
  model: string;
  maxTokens: number;
  timeout: number;
  reasoningEffort: "low" | "high";
  showReasoning: boolean;
  showToolCalls: boolean;
  showUsage: boolean;
  showCitations: boolean;
  showDiffs: boolean;
  showServerToolUsage: boolean;
  maxToolRounds: number;
  serverTools: ServerToolConfig[];
  useResponsesApi: boolean;
  sessionDir: string;
  mcpServers: McpServer[];
  imageInputs: string[];
  fileAttachments: string[];
  jsonSchema: string | null;
  approvalPolicy: ApprovalPolicy;
  sandboxMode: SandboxMode;
  toolApprovals: ToolApprovalSettings;
  includeToolOutputs: boolean;
  notify: boolean;
  hooks: HooksConfig;
  convId: string | null;
  jsonOutput: boolean;
  ephemeral: boolean;
  outputFile: string | null;
  color: "auto" | "always" | "never";
  maxOutputTokens: number;
}

export type ApprovalPolicy = "always-approve" | "ask" | "deny-writes";
export type SandboxMode = "danger-full-access" | "workspace-write" | "read-only";
export type ToolApprovalMode = "allow" | "ask" | "deny";
export type ServerToolKind = "web_search" | "x_search" | "code_execution" | "file_search";

export interface WebSearchToolConfig {
  type: "web_search";
  filters?: {
    allowedDomains?: string[];
    excludedDomains?: string[];
  };
  enableImageUnderstanding?: boolean;
  includeSources?: boolean;
}

export interface XSearchToolConfig {
  type: "x_search";
  allowedXHandles?: string[];
  excludedXHandles?: string[];
  fromDate?: string;
  toDate?: string;
  enableImageUnderstanding?: boolean;
  enableVideoUnderstanding?: boolean;
}

export interface CodeExecutionToolConfig {
  type: "code_execution";
  includeOutputs?: boolean;
}

export interface FileSearchToolConfig {
  type: "file_search";
  collectionIds: string[];
  retrievalMode?: "keyword" | "semantic" | "hybrid";
  maxNumResults?: number;
  includeResults?: boolean;
}

export type ServerToolConfig =
  | WebSearchToolConfig
  | XSearchToolConfig
  | CodeExecutionToolConfig
  | FileSearchToolConfig;

export interface McpServer {
  url: string;
  label: string;
  description?: string;
  allowedTools?: string[];
}

export interface ToolApprovalSettings {
  defaultMode?: ToolApprovalMode;
  tools?: Record<string, ToolApprovalMode>;
}

export interface HooksConfig {
  "pre-tool"?: string[];
  "post-tool"?: string[];
  "session-start"?: string[];
  "session-end"?: string[];
  [key: string]: string[] | undefined;
}

export interface ToolResult {
  output: string;
  error?: boolean;
}

// --- Session Types ---

export interface SessionMeta {
  id: string;
  name: string;
  model: string;
  cwd: string;
  archived?: boolean;
  created: string;
  updated: string;
  turns: number;
  lastResponseId: string | null;
}

export interface SessionEvent {
  ts: string;
  type: "meta" | "msg" | "tool_exec";
  meta?: SessionMeta;
  role?: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  toolCalls?: SerializedToolCall[];
  toolCallId?: string;
  toolName?: string;
  toolArgs?: string;
  toolOutput?: string;
  toolError?: boolean;
  turn?: number;
}

export interface SerializedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AgentOptions {
  verbose: boolean;
  showReasoning: boolean;
  maxTurns: number;
  cwd: string;
  sessionId?: string;
  sessionName?: string;
  planMode?: boolean;
}

export interface Citation {
  url: string;
  title?: string;
}

// --- Config File Types ---

export interface ConfigFile {
  model?: string;
  approval_policy?: ApprovalPolicy;
  sandbox_mode?: SandboxMode;
  show_reasoning?: boolean;
  show_usage?: boolean;
  show_diffs?: boolean;
  show_citations?: boolean;
  show_server_tool_usage?: boolean;
  notify?: boolean;
  max_turns?: number;
  management_api_key?: string;
  management_base_url?: string;
  mcp_servers?: Record<string, string> | McpServer[];
  hooks?: HooksConfig;
  tool_approvals?: ToolApprovalSettings;
  include_tool_outputs?: boolean;
  server_tools?: Array<ServerToolKind | ServerToolConfig>;
}
