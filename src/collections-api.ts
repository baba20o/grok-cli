import fs from "node:fs";
import path from "node:path";
import { getResponseErrorMessage } from "./cli-errors.js";
import type { GrokConfig } from "./types.js";

function requireManagementApiKey(config: GrokConfig): string {
  if (!config.managementApiKey) {
    throw new Error(
      "XAI_MANAGEMENT_API_KEY not set. Collections management requires a management key.",
    );
  }
  return config.managementApiKey;
}

function inferHeaders(config: GrokConfig): HeadersInit {
  return { Authorization: `Bearer ${config.apiKey}` };
}

function managementHeaders(config: GrokConfig, json = false): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${requireManagementApiKey(config)}`,
  };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

export async function listCollections(config: GrokConfig): Promise<any[]> {
  const response = await fetch(`${config.managementBaseUrl}/collections`, {
    headers: managementHeaders(config),
  });
  if (!response.ok) throw new Error(await getResponseErrorMessage("Failed to list collections", response));
  const data = await response.json() as any;
  return data.collections || data.data || [];
}

export async function getCollection(config: GrokConfig, collectionId: string): Promise<any> {
  const response = await fetch(`${config.managementBaseUrl}/collections/${collectionId}`, {
    headers: managementHeaders(config),
  });
  if (!response.ok) throw new Error(await getResponseErrorMessage(`Failed to load collection ${collectionId}`, response));
  return response.json();
}

export async function createCollection(config: GrokConfig, name: string): Promise<any> {
  const response = await fetch(`${config.managementBaseUrl}/collections`, {
    method: "POST",
    headers: managementHeaders(config, true),
    body: JSON.stringify({ collection_name: name }),
  });
  if (!response.ok) throw new Error(await getResponseErrorMessage("Failed to create collection", response));
  return response.json();
}

export async function updateCollection(config: GrokConfig, collectionId: string, name: string): Promise<any> {
  const response = await fetch(`${config.managementBaseUrl}/collections/${collectionId}`, {
    method: "PUT",
    headers: managementHeaders(config, true),
    body: JSON.stringify({ collection_name: name }),
  });
  if (!response.ok) throw new Error(await getResponseErrorMessage(`Failed to update collection ${collectionId}`, response));
  return response.json();
}

export async function deleteCollection(config: GrokConfig, collectionId: string): Promise<void> {
  const response = await fetch(`${config.managementBaseUrl}/collections/${collectionId}`, {
    method: "DELETE",
    headers: managementHeaders(config),
  });
  if (!response.ok) throw new Error(await getResponseErrorMessage(`Failed to delete collection ${collectionId}`, response));
}

export async function listCollectionDocuments(config: GrokConfig, collectionId: string): Promise<any[]> {
  const response = await fetch(`${config.managementBaseUrl}/collections/${collectionId}/documents`, {
    headers: managementHeaders(config),
  });
  if (!response.ok) throw new Error(await getResponseErrorMessage(`Failed to list documents for ${collectionId}`, response));
  const data = await response.json() as any;
  return data.documents || data.data || [];
}

export async function uploadCollectionDocument(
  config: GrokConfig,
  collectionId: string,
  filePath: string,
  fields?: Record<string, string>,
): Promise<any> {
  const resolved = path.resolve(filePath);
  const buffer = fs.readFileSync(resolved);
  const fileName = path.basename(resolved);

  if (fields && Object.keys(fields).length > 0) {
    const form = new FormData();
    form.append("name", fileName);
    form.append("data", new Blob([buffer]), fileName);
    form.append("content_type", "application/octet-stream");
    form.append("fields", JSON.stringify(fields));
    const response = await fetch(`${config.managementBaseUrl}/collections/${collectionId}/documents`, {
      method: "POST",
      headers: managementHeaders(config),
      body: form,
    });
    if (!response.ok) {
      throw new Error(await getResponseErrorMessage(`Failed to upload document to ${collectionId}`, response));
    }
    return response.json();
  }

  const uploadForm = new FormData();
  uploadForm.append("file", new Blob([buffer]), fileName);
  uploadForm.append("purpose", "assistants");
  const uploadResponse = await fetch(`${config.baseUrl}/files`, {
    method: "POST",
    headers: inferHeaders(config),
    body: uploadForm,
  });
  if (!uploadResponse.ok) {
    throw new Error(await getResponseErrorMessage("Failed to upload file", uploadResponse));
  }
  const uploaded = await uploadResponse.json() as any;
  const fileId = uploaded.id || uploaded.file_id;
  const attachResponse = await fetch(`${config.managementBaseUrl}/collections/${collectionId}/documents/${fileId}`, {
    method: "POST",
    headers: managementHeaders(config),
  });
  if (!attachResponse.ok) {
    throw new Error(await getResponseErrorMessage(`Failed to attach uploaded file to ${collectionId}`, attachResponse));
  }
  return attachResponse.json().catch(() => ({ file_id: fileId }));
}

export async function removeCollectionDocument(
  config: GrokConfig,
  collectionId: string,
  fileId: string,
): Promise<void> {
  const response = await fetch(`${config.managementBaseUrl}/collections/${collectionId}/documents/${fileId}`, {
    method: "DELETE",
    headers: managementHeaders(config),
  });
  if (!response.ok) throw new Error(await getResponseErrorMessage(`Failed to delete document ${fileId}`, response));
}

export async function searchCollectionDocuments(
  config: GrokConfig,
  query: string,
  collectionIds: string[],
  retrievalMode?: "keyword" | "semantic" | "hybrid",
): Promise<any> {
  const body: any = {
    query,
    source: { collection_ids: collectionIds },
  };
  if (retrievalMode) body.retrieval_mode = { type: retrievalMode };

  const response = await fetch(`${config.baseUrl}/documents/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...inferHeaders(config),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await getResponseErrorMessage("Failed to search documents", response));
  return response.json();
}
