import type { McpServer } from "./types.js";

const DEFAULT_PROTOCOL_VERSION = "2025-11-25";

type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

type ResolvedMcpServer = {
  label: string;
  url: string;
  authToken?: string;
};

type McpSession = {
  server: ResolvedMcpServer;
  sessionId?: string;
  protocolVersion: string;
};

function resolveAuthToken(server: McpServer): string | undefined {
  if (server.authToken) return server.authToken;
  if (server.authTokenEnv && process.env[server.authTokenEnv]) {
    return process.env[server.authTokenEnv];
  }
  const envSuffix = server.label.replace(/[^a-z0-9]+/gi, "_").toUpperCase();
  return process.env[`GROK_MCP_AUTH_${envSuffix}`] || process.env[`MCP_AUTH_${envSuffix}`];
}

export function resolveMcpServer(serverRef: string, servers: McpServer[]): ResolvedMcpServer {
  const match = servers.find((server) => server.label === serverRef || server.url === serverRef);
  if (match) {
    return {
      label: match.label,
      url: match.url,
      authToken: resolveAuthToken(match),
    };
  }

  const isUrl = /^https?:\/\//i.test(serverRef);
  if (!isUrl) {
    throw new Error(`Unknown MCP server: ${serverRef}`);
  }

  const label = new URL(serverRef).hostname.split(".")[0] || "mcp";
  return { label, url: serverRef };
}

function buildHeaders(
  session: McpSession | ResolvedMcpServer,
  includeBodyHeaders: boolean,
): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
  };

  if (includeBodyHeaders) headers["Content-Type"] = "application/json";

  const authToken = "server" in session ? session.server.authToken : session.authToken;
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  if ("protocolVersion" in session) {
    headers["MCP-Protocol-Version"] = session.protocolVersion;
    if (session.sessionId) headers["MCP-Session-Id"] = session.sessionId;
  }

  return headers;
}

async function parseRpcResponse<T>(response: Response): Promise<JsonRpcResponse<T>> {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (contentType.includes("application/json")) {
    return JSON.parse(text) as JsonRpcResponse<T>;
  }

  if (contentType.includes("text/event-stream")) {
    const dataLines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .filter(Boolean);

    for (let i = dataLines.length - 1; i >= 0; i--) {
      const payload = dataLines[i];
      if (payload === "[DONE]") continue;
      try {
        return JSON.parse(payload) as JsonRpcResponse<T>;
      } catch {
        continue;
      }
    }
  }

  throw new Error(`Unable to parse MCP response (${response.status}): ${text.slice(0, 500)}`);
}

async function postRpc<T>(
  url: string,
  headers: HeadersInit,
  body: Record<string, unknown>,
): Promise<{ response: JsonRpcResponse<T>; sessionId?: string }> {
  const httpResponse = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!httpResponse.ok) {
    const text = await httpResponse.text();
    throw new Error(`MCP request failed (${httpResponse.status}): ${text.slice(0, 500)}`);
  }
  return {
    response: await parseRpcResponse<T>(httpResponse),
    sessionId: httpResponse.headers.get("MCP-Session-Id") || undefined,
  };
}

async function initialize(server: ResolvedMcpServer): Promise<McpSession> {
  const { response, sessionId } = await postRpc<{ protocolVersion?: string }>(
    server.url,
    buildHeaders(server, true),
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "grok-agent",
          version: "0.6.0",
        },
      },
    },
  );

  if (response.error) {
    throw new Error(`MCP initialize failed: ${response.error.message}`);
  }

  const session: McpSession = {
    server,
    sessionId,
    protocolVersion: response.result?.protocolVersion || DEFAULT_PROTOCOL_VERSION,
  };

  await fetch(server.url, {
    method: "POST",
    headers: buildHeaders(session, true),
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    }),
  }).catch(() => {});

  return session;
}

async function closeSession(session: McpSession): Promise<void> {
  if (!session.sessionId) return;
  await fetch(session.server.url, {
    method: "DELETE",
    headers: buildHeaders(session, false),
  }).catch(() => {});
}

async function callRpc<T>(
  session: McpSession,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const { response } = await postRpc<T>(
    session.server.url,
    buildHeaders(session, true),
    {
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    },
  );

  if (response.error) {
    throw new Error(`MCP ${method} failed: ${response.error.message}`);
  }

  return (response.result || {}) as T;
}

export async function listMcpResources(
  serverRef: string,
  servers: McpServer[],
  cursor?: string,
): Promise<{ resources: any[]; nextCursor?: string; server: string }> {
  const server = resolveMcpServer(serverRef, servers);
  const session = await initialize(server);
  try {
    const result = await callRpc<{ resources?: any[]; nextCursor?: string }>(
      session,
      "resources/list",
      cursor ? { cursor } : {},
    );
    return {
      resources: result.resources || [],
      nextCursor: result.nextCursor,
      server: server.label,
    };
  } finally {
    await closeSession(session);
  }
}

export async function readMcpResource(
  serverRef: string,
  uri: string,
  servers: McpServer[],
): Promise<{ server: string; uri: string; contents: any[] }> {
  const server = resolveMcpServer(serverRef, servers);
  const session = await initialize(server);
  try {
    const result = await callRpc<{ contents?: any[] }>(
      session,
      "resources/read",
      { uri },
    );
    return {
      server: server.label,
      uri,
      contents: result.contents || [],
    };
  } finally {
    await closeSession(session);
  }
}
