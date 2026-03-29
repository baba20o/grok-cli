import { execSync } from "node:child_process";
import chalk from "chalk";
import type { HooksConfig } from "./types.js";

export interface HookEvent {
  type: "pre-tool" | "post-tool" | "session-start" | "session-end";
  tool?: string;
  args?: string;
  output?: string;
  error?: boolean;
  sessionId?: string;
}

export function runHooks(hooks: HooksConfig, event: HookEvent): void {
  const hookList = hooks[event.type];
  if (!hookList || hookList.length === 0) return;

  for (const hookCmd of hookList) {
    try {
      const env = {
        ...process.env,
        GROK_HOOK_TYPE: event.type,
        GROK_TOOL_NAME: event.tool || "",
        GROK_TOOL_ARGS: event.args || "",
        GROK_TOOL_OUTPUT: (event.output || "").slice(0, 4096),
        GROK_TOOL_ERROR: String(event.error || false),
        GROK_SESSION_ID: event.sessionId || "",
      };

      execSync(hookCmd, {
        env,
        stdio: "pipe",
        timeout: 10_000,
        encoding: "utf-8",
      });
    } catch (err: any) {
      console.error(chalk.dim(`  Hook failed (${event.type}): ${err.message}`));
    }
  }
}
