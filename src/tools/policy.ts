import path from "node:path";
import type { SandboxMode, ToolResult } from "../types.js";

function normalizePath(p: string): string {
  return path.resolve(p);
}

export function ensurePathAllowed(
  inputPath: string,
  projectCwd: string,
  sandboxMode: SandboxMode,
  access: "read" | "write",
  allowedRoots: string[] = [],
): ToolResult | null {
  if (sandboxMode === "danger-full-access") return null;

  const resolvedPath = normalizePath(inputPath);
  const roots = [normalizePath(projectCwd), ...allowedRoots.map(normalizePath)];
  const outsideWorkspace = roots.every((root) => {
    const relative = path.relative(root, resolvedPath);
    return relative.startsWith("..") || (path.isAbsolute(relative) && !resolvedPath.startsWith(root));
  });

  if (outsideWorkspace) {
    return {
      output: `Sandbox policy (${sandboxMode}) blocks ${access} access outside the workspace: ${resolvedPath}`,
      error: true,
    };
  }

  if (sandboxMode === "read-only" && access === "write") {
    return {
      output: `Sandbox policy (read-only) blocks write access: ${resolvedPath}`,
      error: true,
    };
  }

  return null;
}

export function ensureCommandAllowed(sandboxMode: SandboxMode): ToolResult | null {
  if (sandboxMode === "danger-full-access") return null;
  return {
    output:
      sandboxMode === "read-only"
        ? "Sandbox policy (read-only) blocks shell execution."
        : "Sandbox policy (workspace-write) blocks shell execution. Use structured file tools instead or switch to --sandbox danger-full-access.",
    error: true,
  };
}
