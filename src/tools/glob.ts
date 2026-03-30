import fg from "fast-glob";
import path from "node:path";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";
import { ensurePathAllowed } from "./policy.js";

const MAX_RESULTS = 500;

export async function executeGlob(args: {
  pattern: string;
  cwd?: string;
}, projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  const cwd = args.cwd ? path.resolve(projectCwd, args.cwd) : projectCwd;
  const sandboxError = ensurePathAllowed(cwd, projectCwd, options.sandboxMode || "danger-full-access", "read");
  if (sandboxError) return sandboxError;

  try {
    const files = await fg(args.pattern, {
      cwd,
      dot: false,
      ignore: [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/build/**",
        "**/.next/**",
        "**/coverage/**",
        "**/__pycache__/**",
        "**/.venv/**",
        "**/target/**",
      ],
      onlyFiles: false,
      markDirectories: true,
    });

    if (files.length === 0) {
      return { output: `No files matching pattern: ${args.pattern}` };
    }

    const sorted = files.sort();
    const limited = sorted.slice(0, MAX_RESULTS);
    let output = limited.join("\n");

    if (sorted.length > MAX_RESULTS) {
      output += `\n... and ${sorted.length - MAX_RESULTS} more files`;
    }

    output = `Found ${sorted.length} match(es) for "${args.pattern}":\n${output}`;
    return { output };
  } catch (err: any) {
    return { output: `Glob error: ${err.message}`, error: true };
  }
}
