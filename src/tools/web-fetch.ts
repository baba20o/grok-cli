import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

const execFileAsync = promisify(execFile);
const FETCH_TIMEOUT_MS = 20_000;
const CURL_META_MARKER = "__GROK_WEB_FETCH_META__";

function stripHtml(html: string): { title?: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/?(main|article|section|p|div|li|h\d|br|tr|td|th|pre|code)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return { title, text };
}

type WebFetchPayload = {
  body: string;
  contentType: string;
  finalUrl: string;
};

function formatFetchError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function fetchWithNode(url: URL): Promise<WebFetchPayload> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html, text/plain;q=0.9, application/json;q=0.8, */*;q=0.5",
      "User-Agent": "grok-agent/0.6.0",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return {
    body: await response.text(),
    contentType: response.headers.get("content-type") || "unknown",
    finalUrl: response.url,
  };
}

function parseCurlTrailer(output: string): { body: string; status: number; contentType: string; finalUrl: string } {
  const markerIndex = output.lastIndexOf(`${CURL_META_MARKER}\n`);
  if (markerIndex === -1) {
    throw new Error("curl output missing metadata");
  }

  const body = output.slice(0, markerIndex);
  const trailer = output.slice(markerIndex + CURL_META_MARKER.length + 1).trim();
  const metadata = new Map<string, string>();

  for (const line of trailer.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    metadata.set(line.slice(0, separator), line.slice(separator + 1));
  }

  const status = Number(metadata.get("status") || "0");
  if (!Number.isFinite(status)) {
    throw new Error("curl output missing status");
  }

  return {
    body,
    status,
    contentType: metadata.get("content_type") || "unknown",
    finalUrl: metadata.get("url") || "",
  };
}

async function fetchWithCurl(url: URL): Promise<WebFetchPayload> {
  const { stdout } = await execFileAsync("curl", [
    "--silent",
    "--show-error",
    "--location",
    "--compressed",
    "--connect-timeout",
    "10",
    "--max-time",
    "20",
    "--user-agent",
    "grok-agent/0.6.0",
    "--header",
    "Accept: text/html, text/plain;q=0.9, application/json;q=0.8, */*;q=0.5",
    "--write-out",
    `${CURL_META_MARKER}\nstatus:%{http_code}\ncontent_type:%{content_type}\nurl:%{url_effective}\n`,
    url.toString(),
  ], {
    encoding: "utf-8",
    maxBuffer: 2 * 1024 * 1024,
  });

  const parsed = parseCurlTrailer(stdout);
  if (parsed.status < 200 || parsed.status >= 400) {
    throw new Error(`HTTP ${parsed.status}`);
  }

  return {
    body: parsed.body,
    contentType: parsed.contentType,
    finalUrl: parsed.finalUrl || url.toString(),
  };
}

export async function executeWebFetch(args: {
  url: string;
  raw?: boolean;
  max_chars?: number;
}, _projectCwd: string, _options: ToolExecutionOptions): Promise<ToolResult> {
  let url: URL;
  try {
    url = new URL(args.url);
  } catch {
    return { output: `Invalid URL: ${args.url}`, error: true };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { output: `Unsupported URL protocol: ${url.protocol}`, error: true };
  }

  let payload: WebFetchPayload;
  try {
    payload = await fetchWithNode(url);
  } catch (primaryError) {
    try {
      payload = await fetchWithCurl(url);
    } catch (fallbackError) {
      return {
        output: [
          `Failed to fetch ${url.toString()}.`,
          `Primary error: ${formatFetchError(primaryError)}`,
          `Fallback error: ${formatFetchError(fallbackError)}`,
        ].join("\n"),
        error: true,
      };
    }
  }

  const contentType = payload.contentType || "unknown";
  const rawText = payload.body;
  const limit = Math.min(Math.max(args.max_chars || 12000, 500), 50000);

  if (args.raw || !contentType.includes("text/html")) {
    const body = rawText.slice(0, limit);
    return {
      output: [
        `URL: ${payload.finalUrl}`,
        `Content-Type: ${contentType}`,
        "",
        body,
      ].join("\n"),
    };
  }

  const { title, text } = stripHtml(rawText);
  return {
    output: [
      `URL: ${payload.finalUrl}`,
      title ? `Title: ${title}` : null,
      `Content-Type: ${contentType}`,
      "",
      text.slice(0, limit),
    ].filter(Boolean).join("\n"),
  };
}
