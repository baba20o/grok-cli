import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

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

  const response = await fetch(url, {
    headers: {
      Accept: "text/html, text/plain;q=0.9, application/json;q=0.8, */*;q=0.5",
      "User-Agent": "grok-agent/0.6.0",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    return {
      output: `Failed to fetch ${url.toString()} (${response.status} ${response.statusText})`,
      error: true,
    };
  }

  const contentType = response.headers.get("content-type") || "unknown";
  const rawText = await response.text();
  const limit = Math.min(Math.max(args.max_chars || 12000, 500), 50000);

  if (args.raw || !contentType.includes("text/html")) {
    const body = rawText.slice(0, limit);
    return {
      output: [
        `URL: ${response.url}`,
        `Content-Type: ${contentType}`,
        "",
        body,
      ].join("\n"),
    };
  }

  const { title, text } = stripHtml(rawText);
  return {
    output: [
      `URL: ${response.url}`,
      title ? `Title: ${title}` : null,
      `Content-Type: ${contentType}`,
      "",
      text.slice(0, limit),
    ].filter(Boolean).join("\n"),
  };
}
