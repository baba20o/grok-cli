import fs from "node:fs";
import path from "node:path";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";
import { ensurePathAllowed } from "./policy.js";

const MAX_LINES = 5000;

export async function executeReadFile(args: {
  file_path: string;
  offset?: number;
  limit?: number;
}, projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  const filePath = path.resolve(projectCwd, args.file_path);
  const offset = Math.max((args.offset || 1) - 1, 0); // Convert 1-based to 0-based
  const limit = Math.min(args.limit || 2000, MAX_LINES);
  const sandboxError = ensurePathAllowed(
    filePath,
    projectCwd,
    options.sandboxMode || "danger-full-access",
    "read",
    options.allowedReadRoots,
  );
  if (sandboxError) return sandboxError;

  try {
    if (!fs.existsSync(filePath)) {
      return { output: `File not found: ${filePath}`, error: true };
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return { output: `Path is a directory, not a file: ${filePath}`, error: true };
    }

    // Warn on very large files
    if (stat.size > 5 * 1024 * 1024) {
      return {
        output: `File is very large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Use offset/limit to read specific portions.`,
        error: true,
      };
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const selected = lines.slice(offset, offset + limit);

    // Format with line numbers
    const numbered = selected
      .map((line, i) => `${offset + i + 1}\t${line}`)
      .join("\n");

    const total = lines.length;
    let header = `File: ${args.file_path} (${total} lines)`;
    if (offset > 0 || offset + limit < total) {
      header += ` — showing lines ${offset + 1}-${Math.min(offset + limit, total)}`;
    }

    return { output: `${header}\n${numbered}` };
  } catch (err: any) {
    return { output: `Error reading file: ${err.message}`, error: true };
  }
}
