import OpenAI from "openai";
import type { GrokConfig } from "./types.js";

let clientInstance: OpenAI | null = null;

export function createClient(config: GrokConfig): OpenAI {
  if (clientInstance) return clientInstance;

  clientInstance = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.timeout,
    defaultHeaders: {
      "X-Grok-Client": "grok-cli/0.1.0",
    },
  });

  return clientInstance;
}
