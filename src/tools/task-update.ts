import { formatTask, updateTask } from "../tasks.js";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

export async function executeTaskUpdate(args: {
  id: string;
  content?: string;
  status?: "pending" | "in_progress" | "completed" | "cancelled";
  owner?: string | null;
  priority?: "low" | "medium" | "high" | null;
  notes?: string | null;
}, _projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  if (!options.sessionDir || !options.sessionId) {
    return { output: "task_update requires an active session context.", error: true };
  }
  if (!args.id?.trim()) {
    return { output: "task_update requires id.", error: true };
  }

  const task = updateTask(options.sessionDir, options.sessionId, args.id, args);
  if (!task) {
    return { output: `Task not found: ${args.id}`, error: true };
  }

  return { output: `Updated ${formatTask(task)}` };
}
