import fs from "node:fs";
import path from "node:path";
import type { TaskItem, TaskPriority, TaskStatus } from "./types.js";

type CreateTaskInput = {
  content: string;
  status?: TaskStatus;
  owner?: string;
  priority?: TaskPriority;
  notes?: string;
};

type UpdateTaskInput = {
  content?: string;
  status?: TaskStatus;
  owner?: string | null;
  priority?: TaskPriority | null;
  notes?: string | null;
};

const TASK_DIR_NAME = "tasks";

function ensureTaskDir(baseDir: string): string {
  const dir = path.join(baseDir, TASK_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeTaskId(input: string): string {
  return input.trim().toLowerCase();
}

function nextTaskId(tasks: TaskItem[]): string {
  let max = 0;
  for (const task of tasks) {
    const match = /^task-(\d+)$/.exec(task.id);
    if (!match) continue;
    max = Math.max(max, parseInt(match[1], 10));
  }
  return `task-${max + 1}`;
}

function serializeTasks(tasks: TaskItem[]): string {
  return JSON.stringify(tasks, null, 2) + "\n";
}

function parseTasks(raw: string): TaskItem[] {
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((value): value is TaskItem => !!value && typeof value === "object" && typeof (value as TaskItem).id === "string")
    .map((task) => ({
      id: task.id,
      content: task.content,
      status: task.status,
      owner: task.owner,
      priority: task.priority,
      notes: task.notes,
      created: task.created,
      updated: task.updated,
    }));
}

export function getTaskFilePath(baseDir: string, sessionId: string): string {
  return path.join(ensureTaskDir(baseDir), `${sessionId}.json`);
}

export function listTasks(baseDir: string, sessionId: string): TaskItem[] {
  const filePath = getTaskFilePath(baseDir, sessionId);
  if (!fs.existsSync(filePath)) return [];
  try {
    return parseTasks(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

export function saveTasks(baseDir: string, sessionId: string, tasks: TaskItem[]): TaskItem[] {
  const filePath = getTaskFilePath(baseDir, sessionId);
  fs.writeFileSync(filePath, serializeTasks(tasks), "utf-8");
  return tasks;
}

export function replaceTasks(
  baseDir: string,
  sessionId: string,
  items: Array<{
    id?: string;
    content: string;
    status?: TaskStatus;
    owner?: string;
    priority?: TaskPriority;
    notes?: string;
  }>,
): TaskItem[] {
  const existing = listTasks(baseDir, sessionId);
  const byId = new Map(existing.map((task) => [normalizeTaskId(task.id), task]));
  const now = new Date().toISOString();
  const next: TaskItem[] = [];

  for (const item of items) {
    const existingTask = item.id ? byId.get(normalizeTaskId(item.id)) : null;
    const id = existingTask?.id || nextTaskId([...existing, ...next]);
    next.push({
      id,
      content: item.content.trim(),
      status: item.status || existingTask?.status || "pending",
      owner: item.owner ?? existingTask?.owner,
      priority: item.priority ?? existingTask?.priority,
      notes: item.notes ?? existingTask?.notes,
      created: existingTask?.created || now,
      updated: now,
    });
  }

  return saveTasks(baseDir, sessionId, next);
}

export function createTask(baseDir: string, sessionId: string, input: CreateTaskInput): TaskItem {
  const tasks = listTasks(baseDir, sessionId);
  const now = new Date().toISOString();
  const task: TaskItem = {
    id: nextTaskId(tasks),
    content: input.content.trim(),
    status: input.status || "pending",
    owner: input.owner,
    priority: input.priority,
    notes: input.notes,
    created: now,
    updated: now,
  };
  tasks.push(task);
  saveTasks(baseDir, sessionId, tasks);
  return task;
}

export function getTask(baseDir: string, sessionId: string, ref: string): TaskItem | null {
  const normalized = normalizeTaskId(ref);
  return listTasks(baseDir, sessionId).find((task) =>
    normalizeTaskId(task.id) === normalized ||
    task.content.trim().toLowerCase() === ref.trim().toLowerCase(),
  ) || null;
}

export function updateTask(
  baseDir: string,
  sessionId: string,
  ref: string,
  updates: UpdateTaskInput,
): TaskItem | null {
  const tasks = listTasks(baseDir, sessionId);
  const normalized = normalizeTaskId(ref);
  const index = tasks.findIndex((task) =>
    normalizeTaskId(task.id) === normalized ||
    task.content.trim().toLowerCase() === ref.trim().toLowerCase(),
  );
  if (index === -1) return null;

  const current = tasks[index];
  const next: TaskItem = {
    ...current,
    content: updates.content?.trim() || current.content,
    status: updates.status || current.status,
    updated: new Date().toISOString(),
  };

  if (updates.owner === null) delete next.owner;
  else if (updates.owner !== undefined) next.owner = updates.owner;

  if (updates.priority === null) delete next.priority;
  else if (updates.priority !== undefined) next.priority = updates.priority;

  if (updates.notes === null) delete next.notes;
  else if (updates.notes !== undefined) next.notes = updates.notes;

  tasks[index] = next;
  saveTasks(baseDir, sessionId, tasks);
  return next;
}

export function clearTasks(baseDir: string, sessionId: string): void {
  const filePath = getTaskFilePath(baseDir, sessionId);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function formatTask(task: TaskItem): string {
  const parts = [`${task.id}`, `[${task.status}]`, task.content];
  if (task.owner) parts.push(`owner=${task.owner}`);
  if (task.priority) parts.push(`priority=${task.priority}`);
  return parts.join(" ");
}
