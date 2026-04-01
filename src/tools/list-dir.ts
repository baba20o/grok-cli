import fs from "node:fs";
import path from "node:path";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";
import { ensurePathAllowed } from "./policy.js";

const MAX_ENTRIES = 500;

export async function executeListDir(args: {
  path?: string;
  recursive?: boolean;
}, projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  const dirPath = args.path ? path.resolve(projectCwd, args.path) : projectCwd;
  const sandboxError = ensurePathAllowed(
    dirPath,
    projectCwd,
    options.sandboxMode || "danger-full-access",
    "read",
    options.allowedReadRoots,
  );
  if (sandboxError) return sandboxError;

  try {
    if (!fs.existsSync(dirPath)) {
      return { output: `Directory not found: ${dirPath}`, error: true };
    }

    if (!fs.statSync(dirPath).isDirectory()) {
      return { output: `Not a directory: ${dirPath}`, error: true };
    }

    const entries: string[] = [];
    listRecursive(dirPath, "", entries, args.recursive ? 3 : 0, 0);

    if (entries.length === 0) {
      return { output: `Empty directory: ${args.path || "."}` };
    }

    let output = entries.join("\n");
    if (entries.length >= MAX_ENTRIES) {
      output += "\n... (truncated)";
    }

    return { output };
  } catch (err: any) {
    return { output: `Error listing directory: ${err.message}`, error: true };
  }
}

function listRecursive(
  basePath: string,
  relativePath: string,
  entries: string[],
  maxDepth: number,
  currentDepth: number,
): void {
  if (entries.length >= MAX_ENTRIES) return;

  const fullPath = path.join(basePath, relativePath);
  const items = fs.readdirSync(fullPath, { withFileTypes: true });

  // Sort: directories first, then files
  const sorted = items.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const skipDirs = new Set([
    "node_modules", ".git", "dist", "build", ".next",
    "coverage", "__pycache__", ".venv", "target", ".cache",
  ]);

  for (const item of sorted) {
    if (entries.length >= MAX_ENTRIES) return;

    const itemRelative = relativePath ? `${relativePath}/${item.name}` : item.name;

    if (item.isDirectory()) {
      if (skipDirs.has(item.name)) continue;
      const indent = "  ".repeat(currentDepth);
      entries.push(`${indent}${item.name}/`);
      if (currentDepth < maxDepth) {
        listRecursive(basePath, itemRelative, entries, maxDepth, currentDepth + 1);
      }
    } else {
      const indent = "  ".repeat(currentDepth);
      entries.push(`${indent}${item.name}`);
    }
  }
}
