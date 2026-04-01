import { getTask } from "../tasks.js";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

export async function executeTaskGet(args: {
  id: string;
}, _projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  if (!options.sessionDir || !options.sessionId) {
    return { output: "task_get requires an active session context.", error: true };
  }
  if (!args.id?.trim()) {
    return { output: "task_get requires id.", error: true };
  }

  const task = getTask(options.sessionDir, options.sessionId, args.id);
  if (!task) {
    return { output: `Task not found: ${args.id}`, error: true };
  }

  return {
    output: [
      `ID: ${task.id}`,
      `Status: ${task.status}`,
      `Content: ${task.content}`,
      task.owner ? `Owner: ${task.owner}` : null,
      task.priority ? `Priority: ${task.priority}` : null,
      task.notes ? `Notes: ${task.notes}` : null,
    ].filter(Boolean).join("\n"),
  };
}
