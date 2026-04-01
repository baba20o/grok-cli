import fs from "node:fs";
import path from "node:path";
import {
  approxBytesForTokens,
  approxTokenCount,
  truncateOutputDetailed,
} from "./truncation.js";
import type { PersistedToolOutput, ToolResult, ToolResultMetadata } from "./types.js";

const DEFAULT_PERSIST_THRESHOLD_TOKENS = 4000;
const PREVIEW_TOKENS = 500;

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "tool";
}

function buildPersistedOutputMessage(persisted: PersistedToolOutput, preview: string): string {
  return [
    "<persisted-output>",
    `Output too large (${persisted.originalBytes} bytes). Full output saved to: ${persisted.path}`,
    "",
    `Preview (first ${persisted.previewBytes} bytes):`,
    preview,
    "</persisted-output>",
  ].join("\n");
}

export function getToolResultsDir(baseDir: string, sessionId: string): string {
  return path.join(baseDir, "tool-results", sessionId);
}

export function finalizeToolResult(
  result: ToolResult,
  toolName: string,
  options: {
    maxOutputTokens: number;
    resultStoreDir?: string;
    toolCallId?: string;
  },
): ToolResult {
  const estimatedTokens = approxTokenCount(result.output);
  const persistThresholdTokens = Math.min(
    options.maxOutputTokens,
    DEFAULT_PERSIST_THRESHOLD_TOKENS,
  );

  if (
    options.resultStoreDir &&
    options.toolCallId &&
    estimatedTokens > persistThresholdTokens
  ) {
    try {
      fs.mkdirSync(options.resultStoreDir, { recursive: true });
      const filename = `${options.toolCallId}-${sanitizeName(toolName)}.txt`;
      const outputPath = path.join(options.resultStoreDir, filename);
      fs.writeFileSync(outputPath, result.output, "utf-8");

      const previewBytes = approxBytesForTokens(PREVIEW_TOKENS);
      const preview = result.output.slice(0, previewBytes);
      const persisted: PersistedToolOutput = {
        path: outputPath,
        originalBytes: Buffer.byteLength(result.output, "utf-8"),
        previewBytes: Buffer.byteLength(preview, "utf-8"),
      };

      const metadata: ToolResultMetadata = {
        ...(result.metadata || {}),
        persisted,
      };

      return {
        ...result,
        output: buildPersistedOutputMessage(persisted, preview),
        metadata,
      };
    } catch {
      // Fall through to truncation if persistence fails.
    }
  }

  const truncated = truncateOutputDetailed(result.output, options.maxOutputTokens);
  if (!truncated.metadata) {
    return result;
  }

  return {
    ...result,
    output: truncated.output,
    metadata: {
      ...(result.metadata || {}),
      truncated: truncated.metadata,
    },
  };
}
