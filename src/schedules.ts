import fs from "node:fs";
import path from "node:path";

export interface ScheduleEntry {
  id: string;
  prompt: string;
  cwd: string;
  model?: string;
  cron?: string;
  runAt?: string;
  nextRunAt: string;
  lastRunAt?: string;
  created: string;
  updated: string;
}

type CreateScheduleInput = {
  prompt: string;
  cwd: string;
  model?: string;
  cron?: string;
  runAt?: string;
};

const SCHEDULES_FILE = "schedules.json";

function getSchedulesPath(baseDir: string): string {
  fs.mkdirSync(baseDir, { recursive: true });
  return path.join(baseDir, SCHEDULES_FILE);
}

function parseSchedules(raw: string): ScheduleEntry[] {
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((value): value is ScheduleEntry => !!value && typeof value === "object" && typeof (value as ScheduleEntry).id === "string")
    .map((entry) => ({
      id: entry.id,
      prompt: entry.prompt,
      cwd: entry.cwd,
      model: entry.model,
      cron: entry.cron,
      runAt: entry.runAt,
      nextRunAt: entry.nextRunAt,
      lastRunAt: entry.lastRunAt,
      created: entry.created,
      updated: entry.updated,
    }));
}

function saveSchedules(baseDir: string, schedules: ScheduleEntry[]): void {
  const filePath = getSchedulesPath(baseDir);
  fs.writeFileSync(filePath, JSON.stringify(schedules, null, 2) + "\n", "utf-8");
}

function nextScheduleId(schedules: ScheduleEntry[]): string {
  let max = 0;
  for (const entry of schedules) {
    const match = /^schedule-(\d+)$/.exec(entry.id);
    if (!match) continue;
    max = Math.max(max, parseInt(match[1], 10));
  }
  return `schedule-${max + 1}`;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    if (!part) continue;
    const [rangePart, stepPart] = part.split("/", 2);
    const step = stepPart ? Math.max(1, parseInt(stepPart, 10)) : 1;
    if (rangePart === "*") {
      for (let value = min; value <= max; value += step) values.add(value);
      continue;
    }

    const rangeMatch = /^(\d+)-(\d+)$/.exec(rangePart);
    if (rangeMatch) {
      const start = Math.max(min, parseInt(rangeMatch[1], 10));
      const end = Math.min(max, parseInt(rangeMatch[2], 10));
      for (let value = start; value <= end; value += step) values.add(value);
      continue;
    }

    const value = parseInt(rangePart, 10);
    if (Number.isNaN(value) || value < min || value > max) {
      throw new Error(`Invalid cron field: ${field}`);
    }
    values.add(value);
  }
  return values;
}

function matchesCron(date: Date, cron: string): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: ${cron}`);
  }

  const [minuteField, hourField, dayField, monthField, weekdayField] = fields;
  const minutes = parseField(minuteField, 0, 59);
  const hours = parseField(hourField, 0, 23);
  const days = parseField(dayField, 1, 31);
  const months = parseField(monthField, 1, 12);
  const weekdays = parseField(weekdayField, 0, 6);

  return minutes.has(date.getMinutes()) &&
    hours.has(date.getHours()) &&
    days.has(date.getDate()) &&
    months.has(date.getMonth() + 1) &&
    weekdays.has(date.getDay());
}

export function nextCronRun(cron: string, after = new Date()): string {
  const candidate = new Date(after.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let i = 0; i < 60 * 24 * 400; i++) {
    if (matchesCron(candidate, cron)) return candidate.toISOString();
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error(`Unable to find next run time for cron expression: ${cron}`);
}

export function listSchedules(baseDir: string): ScheduleEntry[] {
  const filePath = getSchedulesPath(baseDir);
  if (!fs.existsSync(filePath)) return [];
  try {
    return parseSchedules(fs.readFileSync(filePath, "utf-8"))
      .sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime());
  } catch {
    return [];
  }
}

export function createSchedule(baseDir: string, input: CreateScheduleInput): ScheduleEntry {
  if (!input.prompt.trim()) throw new Error("Schedule prompt is required.");
  if (!input.cron && !input.runAt) {
    throw new Error("A schedule requires either cron or runAt.");
  }
  if (input.cron && input.runAt) {
    throw new Error("Specify either cron or runAt, not both.");
  }

  const schedules = listSchedules(baseDir);
  const now = new Date().toISOString();
  const nextRunAt = input.cron
    ? nextCronRun(input.cron)
    : new Date(input.runAt as string).toISOString();

  const entry: ScheduleEntry = {
    id: nextScheduleId(schedules),
    prompt: input.prompt.trim(),
    cwd: path.resolve(input.cwd),
    model: input.model,
    cron: input.cron,
    runAt: input.runAt ? new Date(input.runAt).toISOString() : undefined,
    nextRunAt,
    created: now,
    updated: now,
  };

  schedules.push(entry);
  saveSchedules(baseDir, schedules);
  return entry;
}

export function deleteSchedule(baseDir: string, id: string): ScheduleEntry | null {
  const schedules = listSchedules(baseDir);
  const index = schedules.findIndex((entry) => entry.id === id);
  if (index === -1) return null;
  const [removed] = schedules.splice(index, 1);
  saveSchedules(baseDir, schedules);
  return removed;
}

export function dueSchedules(baseDir: string, now = new Date()): ScheduleEntry[] {
  const time = now.getTime();
  return listSchedules(baseDir).filter((entry) => new Date(entry.nextRunAt).getTime() <= time);
}

export function markScheduleRun(baseDir: string, id: string, ranAt = new Date()): ScheduleEntry | null {
  const schedules = listSchedules(baseDir);
  const index = schedules.findIndex((entry) => entry.id === id);
  if (index === -1) return null;

  const current = schedules[index];
  const runIso = ranAt.toISOString();

  if (!current.cron) {
    schedules.splice(index, 1);
    saveSchedules(baseDir, schedules);
    return {
      ...current,
      lastRunAt: runIso,
      updated: runIso,
    };
  }

  const updated: ScheduleEntry = {
    ...current,
    lastRunAt: runIso,
    nextRunAt: nextCronRun(current.cron, ranAt),
    updated: runIso,
  };
  schedules[index] = updated;
  saveSchedules(baseDir, schedules);
  return updated;
}
