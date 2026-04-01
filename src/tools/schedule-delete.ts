import { deleteSchedule } from "../schedules.js";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

export async function executeScheduleDelete(args: {
  id: string;
}, _projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  if (!options.sessionDir) {
    return { output: "schedule_delete requires session storage.", error: true };
  }
  if (!args.id?.trim()) {
    return { output: "schedule_delete requires id.", error: true };
  }

  const removed = deleteSchedule(options.sessionDir, args.id);
  if (!removed) {
    return { output: `Schedule not found: ${args.id}`, error: true };
  }

  return { output: `Deleted schedule ${removed.id}` };
}
