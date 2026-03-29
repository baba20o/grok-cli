import { execSync } from "node:child_process";
import type { ToolResult } from "../types.js";

const MAX_TIMEOUT = 300_000; // 5 minutes
const DEFAULT_TIMEOUT = 30_000; // 30 seconds
const MAX_OUTPUT = 100_000; // 100KB output limit

export async function executeBash(args: {
  command: string;
  timeout?: number;
  cwd?: string;
}, projectCwd: string): Promise<ToolResult> {
  const timeout = Math.min(args.timeout || DEFAULT_TIMEOUT, MAX_TIMEOUT);
  const cwd = args.cwd || projectCwd;

  try {
    const output = execSync(args.command, {
      cwd,
      timeout,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
    });

    const trimmed = output.length > MAX_OUTPUT
      ? output.slice(0, MAX_OUTPUT) + `\n... (output truncated, ${output.length} bytes total)`
      : output;

    return { output: trimmed || "(no output)" };
  } catch (err: any) {
    const stderr = err.stderr?.toString() || "";
    const stdout = err.stdout?.toString() || "";
    const exitCode = err.status ?? "unknown";

    // Some constrained environments report shell execution as EPERM even when
    // the command itself succeeded and returned exit code 0.
    if (exitCode === 0) {
      const successOutput = [stdout, stderr].filter(Boolean).join("\n");
      const trimmed = successOutput.length > MAX_OUTPUT
        ? successOutput.slice(0, MAX_OUTPUT) + `\n... (output truncated, ${successOutput.length} bytes total)`
        : successOutput;
      return { output: trimmed || "(no output)" };
    }

    const combined = [stdout, stderr].filter(Boolean).join("\n");

    const msg = combined.length > MAX_OUTPUT
      ? combined.slice(0, MAX_OUTPUT) + `\n... (output truncated)`
      : combined;

    return {
      output: `Command failed (exit code ${exitCode}):\n${msg || err.message}`,
      error: true,
    };
  }
}
