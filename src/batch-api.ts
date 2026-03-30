import fs from "node:fs";
import { getResponseErrorMessage } from "./cli-errors.js";
import type { GrokConfig } from "./types.js";

function authHeaders(config: GrokConfig, json = false): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
  };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

export async function createBatch(config: GrokConfig, name: string): Promise<any> {
  const response = await fetch(`${config.baseUrl}/batches`, {
    method: "POST",
    headers: authHeaders(config, true),
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(await getResponseErrorMessage("Failed to create batch", response));
  return response.json();
}

export async function listBatches(config: GrokConfig, pageSize = 20): Promise<any> {
  const url = new URL(`${config.baseUrl}/batches`);
  url.searchParams.set("page_size", String(pageSize));
  const response = await fetch(url, { headers: authHeaders(config) });
  if (!response.ok) throw new Error(await getResponseErrorMessage("Failed to list batches", response));
  return response.json();
}

export async function getBatch(config: GrokConfig, batchId: string): Promise<any> {
  const response = await fetch(`${config.baseUrl}/batches/${batchId}`, {
    headers: authHeaders(config),
  });
  if (!response.ok) throw new Error(await getResponseErrorMessage(`Failed to load batch ${batchId}`, response));
  return response.json();
}

export async function cancelBatch(config: GrokConfig, batchId: string): Promise<any> {
  const response = await fetch(`${config.baseUrl}/batches/${batchId}:cancel`, {
    method: "POST",
    headers: authHeaders(config),
  });
  if (!response.ok) throw new Error(await getResponseErrorMessage(`Failed to cancel batch ${batchId}`, response));
  return response.json();
}

export async function listBatchRequests(config: GrokConfig, batchId: string, pageSize = 50): Promise<any> {
  const url = new URL(`${config.baseUrl}/batches/${batchId}/requests`);
  url.searchParams.set("page_size", String(pageSize));
  const response = await fetch(url, { headers: authHeaders(config) });
  if (!response.ok) throw new Error(await getResponseErrorMessage(`Failed to list requests for ${batchId}`, response));
  return response.json();
}

export async function listBatchResults(config: GrokConfig, batchId: string, pageSize = 100): Promise<any> {
  const url = new URL(`${config.baseUrl}/batches/${batchId}/results`);
  url.searchParams.set("page_size", String(pageSize));
  const response = await fetch(url, { headers: authHeaders(config) });
  if (!response.ok) throw new Error(await getResponseErrorMessage(`Failed to list results for ${batchId}`, response));
  return response.json();
}

export async function addBatchRequests(config: GrokConfig, batchId: string, requests: any[]): Promise<any> {
  const response = await fetch(`${config.baseUrl}/batches/${batchId}/requests`, {
    method: "POST",
    headers: authHeaders(config, true),
    body: JSON.stringify({ batch_requests: requests }),
  });
  if (!response.ok) throw new Error(await getResponseErrorMessage(`Failed to add requests to ${batchId}`, response));
  return response.json();
}

export function loadBatchRequestsFromJsonl(filePath: string): any[] {
  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  return lines.map((line, index) => {
    const item = JSON.parse(line) as any;
    if (!item.custom_id || !item.body) {
      throw new Error(`Invalid JSONL line ${index + 1}: expected custom_id and body`);
    }
    return {
      batch_request_id: item.custom_id,
      batch_request: item.body,
    };
  });
}

export function buildBatchChatRequest(
  model: string,
  prompt: string,
  batchRequestId: string,
  systemPrompt?: string,
): any {
  const input = [];
  if (systemPrompt) {
    input.push({ role: "system", content: systemPrompt });
  }
  input.push({ role: "user", content: prompt });

  return {
    batch_request_id: batchRequestId,
    batch_request: {
      responses: {
        model,
        input,
      },
    },
  };
}
