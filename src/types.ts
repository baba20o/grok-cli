import type OpenAI from "openai";

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;
export type ToolDef = OpenAI.Chat.Completions.ChatCompletionTool;
export type StreamChunk = OpenAI.Chat.Completions.ChatCompletionChunk;

export interface GrokConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  timeout: number;
  reasoningEffort: "low" | "high";
  showReasoning: boolean;
  showToolCalls: boolean;
  showUsage: boolean;
  showCitations: boolean;
  showDiffs: boolean;
  maxToolRounds: number;
  serverTools: ServerTool[];
  useResponsesApi: boolean;
  sessionDir: string;
  mcpServers: McpServer[];
  imageInputs: string[];
  fileAttachments: string[];
  jsonSchema: string | null;
  approvalPolicy: ApprovalPolicy;
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
export type ServerTool = "web_search" | "x_search" | "code_execution";

export interface McpServer {
  url: string;
  label: string;
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
  show_reasoning?: boolean;
  show_usage?: boolean;
  show_diffs?: boolean;
  show_citations?: boolean;
  notify?: boolean;
  max_turns?: number;
  mcp_servers?: Record<string, string>; // label -> url
  hooks?: HooksConfig;
  server_tools?: ServerTool[];
}
