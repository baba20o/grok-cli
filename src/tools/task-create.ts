import { createTask, formatTask } from "../tasks.js";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

export async function executeTaskCreate(args: {
  content: string;
  status?: "pending" | "in_progress" | "completed" | "cancelled";
  owner?: string;
  priority?: "low" | "medium" | "high";
  notes?: string;
}, _projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  if (!options.sessionDir || !options.sessionId) {
    return { output: "task_create requires an active session context.", error: true };
  }
  if (!args.content?.trim()) {
    return { output: "task_create requires content.", error: true };
  }

  const task = createTask(options.sessionDir, options.sessionId, args);
  return { output: `Created ${formatTask(task)}` };
}
