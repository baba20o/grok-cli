import OpenAI from "openai";
import fs from "node:fs";
import type { GrokConfig } from "./types.js";

let clientInstance: OpenAI | null = null;
let lastConvId: string | null = null;
const CLIENT_VERSION = readClientVersion();

function readClientVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
      version?: string;
    };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function createClient(config: GrokConfig): OpenAI {
  // Rebuild if conv ID changed (for cache routing)
  const convId = config.convId || null;
  if (clientInstance && convId === lastConvId) return clientInstance;

  const headers: Record<string, string> = {
    "X-Grok-Client": `grok-cli/${CLIENT_VERSION}`,
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
