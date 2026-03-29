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
  maxToolRounds: number;
  serverTools: ServerTool[];
  useResponsesApi: boolean;
  sessionDir: string;
  mcpServers: McpServer[];
  imageInputs: string[];
  fileAttachments: string[];
  jsonSchema: string | null;
}

export type ServerTool = "web_search" | "x_search" | "code_execution";

export interface McpServer {
  url: string;
  label: string;
}

export interface ToolResult {
  output: string;
  error?: boolean;
}

export interface ExecOptions {
  prompt: string;
  model?: string;
  fast?: boolean;
  verbose?: boolean;
  showReasoning?: boolean;
  maxTurns?: number;
  webSearch?: boolean;
  xSearch?: boolean;
  codeExecution?: boolean;
  cwd?: string;
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
}

export interface Citation {
  url: string;
  title?: string;
}
