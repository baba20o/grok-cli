import { createSchedule } from "../schedules.js";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

export async function executeScheduleCreate(args: {
  prompt: string;
  cron?: string;
  run_at?: string;
  cwd?: string;
  model?: string;
}, projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  if (!options.sessionDir) {
    return { output: "schedule_create requires session storage.", error: true };
  }
  try {
    const entry = createSchedule(options.sessionDir, {
      prompt: args.prompt,
      cwd: args.cwd || projectCwd,
      model: args.model || options.config?.model,
      cron: args.cron,
      runAt: args.run_at,
    });
    return {
      output: [
        `Created schedule ${entry.id}`,
        `Next run: ${entry.nextRunAt}`,
        entry.cron ? `Cron: ${entry.cron}` : `Run at: ${entry.runAt}`,
      ].join("\n"),
    };
  } catch (err: any) {
    return { output: err.message, error: true };
  }
}
