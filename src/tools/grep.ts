import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";
import { ensurePathAllowed } from "./policy.js";

const MAX_RESULTS = 100;
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

export async function executeGrep(args: {
  pattern: string;
  path?: string;
  include?: string;
  ignore_case?: boolean;
  max_results?: number;
}, projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  const searchPath = args.path ? path.resolve(projectCwd, args.path) : projectCwd;
  const maxResults = Math.min(args.max_results || MAX_RESULTS, 500);
  const sandboxError = ensurePathAllowed(
    searchPath,
    projectCwd,
    options.sandboxMode || "danger-full-access",
    "read",
    options.allowedReadRoots,
  );
  if (sandboxError) return sandboxError;

  try {
    const regex = new RegExp(args.pattern, args.ignore_case ? "gi" : "g");

    // If searchPath is a file, search just that file
    if (fs.existsSync(searchPath) && fs.statSync(searchPath).isFile()) {
      return searchFile(searchPath, regex, maxResults, projectCwd);
    }

    // Otherwise, search directory
    const globPattern = args.include || "**/*";
    const files = await fg(globPattern, {
      cwd: searchPath,
      dot: false,
      onlyFiles: true,
      ignore: [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/build/**",
        "**/__pycache__/**",
        "**/.venv/**",
        "**/target/**",
        "**/*.min.js",
        "**/*.map",
        "**/package-lock.json",
        "**/pnpm-lock.yaml",
        "**/yarn.lock",
      ],
    });

    const matches: string[] = [];

    for (const file of files) {
      if (matches.length >= maxResults) break;

      const fullPath = path.join(searchPath, file);

      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > MAX_FILE_SIZE) continue;

        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= maxResults) break;
          if (regex.test(lines[i])) {
            const relativePath = path.relative(projectCwd, fullPath);
            matches.push(`${relativePath}:${i + 1}: ${lines[i].trimEnd()}`);
          }
          regex.lastIndex = 0; // Reset regex state
        }
      } catch {
        // Skip files we can't read (binary, permissions, etc)
      }
    }

    if (matches.length === 0) {
      return { output: `No matches for pattern: ${args.pattern}` };
    }

    let output = matches.join("\n");
    if (matches.length >= maxResults) {
      output += `\n... (limited to ${maxResults} results)`;
    }

    return { output: `${matches.length} match(es) for /${args.pattern}/:\n${output}` };
  } catch (err: any) {
    if (err instanceof SyntaxError) {
      return { output: `Invalid regex pattern: ${err.message}`, error: true };
    }
    return { output: `Grep error: ${err.message}`, error: true };
  }
}

function searchFile(
  filePath: string,
  regex: RegExp,
  maxResults: number,
  projectCwd: string,
): ToolResult {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const matches: string[] = [];
    const relativePath = path.relative(projectCwd, filePath);

    for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
      if (regex.test(lines[i])) {
        matches.push(`${relativePath}:${i + 1}: ${lines[i].trimEnd()}`);
      }
      regex.lastIndex = 0;
    }

    if (matches.length === 0) {
      return { output: `No matches in ${relativePath}` };
    }

    return { output: `${matches.length} match(es):\n${matches.join("\n")}` };
  } catch (err: any) {
    return { output: `Error searching file: ${err.message}`, error: true };
  }
}
