/**
 * Token estimation and output truncation.
 * Prevents massive tool outputs from blowing the context window.
 */

import type { TruncatedToolOutput } from "./types.js";

// Rough approximation: ~4 chars per token for English text
const CHARS_PER_TOKEN = 4;

export function approxTokenCountFromChars(charCount: number): number {
  return Math.ceil(Math.max(0, charCount) / CHARS_PER_TOKEN);
}

export function approxTokenCount(text: string): number {
  return approxTokenCountFromChars(text.length);
}

export function approxBytesForTokens(tokens: number): number {
  return tokens * CHARS_PER_TOKEN;
}

/**
 * Truncate output to fit within a token budget.
 * Preserves the beginning and end, inserting a truncation notice in the middle.
 */
export function truncateOutput(
  output: string,
  maxTokens: number = 8000,
): string {
  return truncateOutputDetailed(output, maxTokens).output;
}

export function truncateOutputDetailed(
  output: string,
  maxTokens: number = 8000,
): { output: string; metadata?: TruncatedToolOutput } {
  const estimatedTokens = approxTokenCount(output);
  if (estimatedTokens <= maxTokens) return { output };

  const metadata: TruncatedToolOutput = {
    estimatedTokens,
    maxTokens,
    originalChars: output.length,
  };

  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const keepStart = Math.floor(maxChars * 0.6); // 60% from start
  const keepEnd = Math.floor(maxChars * 0.3);   // 30% from end
  const lines = output.split("\n");
  const totalLines = lines.length;

  // Find line boundaries
  let startChars = 0;
  let startLineEnd = 0;
  for (let i = 0; i < lines.length; i++) {
    if (startChars + lines[i].length + 1 > keepStart) break;
    startChars += lines[i].length + 1;
    startLineEnd = i + 1;
  }

  let endChars = 0;
  let endLineStart = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (endChars + lines[i].length + 1 > keepEnd) break;
    endChars += lines[i].length + 1;
    endLineStart = i;
  }

  if (startLineEnd >= endLineStart) {
    // Overlap — just hard truncate
    return {
      output:
        output.slice(0, maxChars) +
        `\n\n[... truncated, ${totalLines} total lines, ~${estimatedTokens} tokens]`,
      metadata,
    };
  }

  const omitted = endLineStart - startLineEnd;
  const head = lines.slice(0, startLineEnd).join("\n");
  const tail = lines.slice(endLineStart).join("\n");

  return {
    output:
      `${head}\n\n[... ${omitted} lines omitted, ${totalLines} total lines, ~${estimatedTokens} tokens ...]\n\n${tail}`,
    metadata,
  };
}
