import { formatTask, replaceTasks } from "../tasks.js";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

export async function executeTodoWrite(args: {
  items: Array<{
    id?: string;
    content: string;
    status?: "pending" | "in_progress" | "completed" | "cancelled";
    owner?: string;
    priority?: "low" | "medium" | "high";
    notes?: string;
  }>;
}, _projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  if (!options.sessionDir || !options.sessionId) {
    return { output: "todo_write requires an active session context.", error: true };
  }
  if (!Array.isArray(args.items) || args.items.length === 0) {
    return { output: "todo_write requires a non-empty items array.", error: true };
  }

  const tasks = replaceTasks(options.sessionDir, options.sessionId, args.items);
  return {
    output: [
      `Saved ${tasks.length} task${tasks.length === 1 ? "" : "s"}:`,
      ...tasks.map((task) => `- ${formatTask(task)}`),
    ].join("\n"),
  };
}
