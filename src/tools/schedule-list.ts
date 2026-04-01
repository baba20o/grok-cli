import { listSchedules } from "../schedules.js";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

export async function executeScheduleList(
  _args: Record<string, never>,
  _projectCwd: string,
  options: ToolExecutionOptions,
): Promise<ToolResult> {
  if (!options.sessionDir) {
    return { output: "schedule_list requires session storage.", error: true };
  }

  const schedules = listSchedules(options.sessionDir);
  if (schedules.length === 0) {
    return { output: "No schedules." };
  }

  return {
    output: schedules.map((entry) =>
      `${entry.id} ${entry.nextRunAt} ${entry.cron ? `[cron ${entry.cron}]` : "[one-shot]"} ${entry.prompt}`
    ).join("\n"),
  };
}
