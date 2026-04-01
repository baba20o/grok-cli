import { formatTask, listTasks } from "../tasks.js";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

export async function executeTaskList(args: {
  status?: "pending" | "in_progress" | "completed" | "cancelled";
}, _projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  if (!options.sessionDir || !options.sessionId) {
    return { output: "task_list requires an active session context.", error: true };
  }

  const tasks = listTasks(options.sessionDir, options.sessionId)
    .filter((task) => !args.status || task.status === args.status);

  if (tasks.length === 0) {
    return { output: "No tasks." };
  }

  return { output: tasks.map((task) => formatTask(task)).join("\n") };
}
