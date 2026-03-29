import OpenAI from "openai";
import type { GrokConfig } from "./types.js";

let clientInstance: OpenAI | null = null;
let lastConvId: string | null = null;

export function createClient(config: GrokConfig): OpenAI {
  // Rebuild if conv ID changed (for cache routing)
  const convId = config.convId || null;
  if (clientInstance && convId === lastConvId) return clientInstance;

  const headers: Record<string, string> = {
    "X-Grok-Client": "grok-cli/0.3.0",
  };

  // Prompt cache sticky routing
  if (convId) {
    headers["x-grok-conv-id"] = convId;
  }

  clientInstance = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.timeout,
    defaultHeaders: headers,
  });

  lastConvId = convId;
  return clientInstance;
}

/** Reset client (e.g., when config changes) */
export function resetClient(): void {
  clientInstance = null;
  lastConvId = null;
}
