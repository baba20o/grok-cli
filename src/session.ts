import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  ChatMessage,
  SerializedToolCall,
  SessionEvent,
  SessionMeta,
} from "./types.js";

const SESSION_DIR_NAME = "sessions";
const ARCHIVED_DIR_NAME = "archived";

export class SessionManager {
  private sessionDir: string;
  private archivedDir: string;

  constructor(baseDir: string) {
    this.sessionDir = path.join(baseDir, SESSION_DIR_NAME);
    this.archivedDir = path.join(this.sessionDir, ARCHIVED_DIR_NAME);
    this.ensureDir();
  }

  private ensureDir(): void {
    try {
      fs.mkdirSync(this.sessionDir, { recursive: true });
      fs.mkdirSync(this.archivedDir, { recursive: true });
    } catch (err: any) {
      throw new Error(`Unable to initialize session storage at ${this.sessionDir}: ${err.message}`);
    }
  }

  private sessionPath(id: string, archived = false): string {
    return path.join(archived ? this.archivedDir : this.sessionDir, `${id}.jsonl`);
  }

  private resolveSessionPath(id: string): { filePath: string; archived: boolean } | null {
    const active = this.sessionPath(id, false);
    if (fs.existsSync(active)) return { filePath: active, archived: false };
    const archived = this.sessionPath(id, true);
    if (fs.existsSync(archived)) return { filePath: archived, archived: true };
    return null;
  }

  createSession(opts: { model: string; cwd: string; name?: string }): SessionMeta {
    const id = this.generateId();
    const now = new Date().toISOString();

    const meta: SessionMeta = {
      id,
      name: opts.name || "New session",
      model: opts.model,
      cwd: opts.cwd,
      archived: false,
      created: now,
      updated: now,
      turns: 0,
      lastResponseId: null,
    };

    const event: SessionEvent = { ts: now, type: "meta", meta };
    fs.writeFileSync(this.sessionPath(id), JSON.stringify(event) + "\n", "utf-8");
    return meta;
  }

  appendMessage(
    sessionId: string,
    role: "system" | "user" | "assistant" | "tool",
    content: string | null,
    extra?: {
      toolCalls?: SerializedToolCall[];
      toolCallId?: string;
      turn?: number;
    },
  ): void {
    const resolved = this.resolveSessionPath(sessionId);
    if (!resolved) return;
    const event: SessionEvent = {
      ts: new Date().toISOString(),
      type: "msg",
      role,
      content,
      ...extra,
    };
    fs.appendFileSync(resolved.filePath, JSON.stringify(event) + "\n", "utf-8");
  }

  appendToolExec(
    sessionId: string,
    toolName: string,
    toolArgs: string,
    toolOutput: string,
    toolError: boolean,
    turn?: number,
  ): void {
    const resolved = this.resolveSessionPath(sessionId);
    if (!resolved) return;
    const event: SessionEvent = {
      ts: new Date().toISOString(),
      type: "tool_exec",
      toolName,
      toolArgs,
      toolOutput: toolOutput.slice(0, 10000),
      toolError,
      turn,
    };
    fs.appendFileSync(resolved.filePath, JSON.stringify(event) + "\n", "utf-8");
  }

  updateMeta(sessionId: string, updates: Partial<SessionMeta>): void {
    const resolved = this.resolveSessionPath(sessionId);
    if (!resolved) return;
    const lines = fs.readFileSync(resolved.filePath, "utf-8").split("\n").filter(Boolean);
    if (lines.length === 0) return;

    const firstEvent: SessionEvent = JSON.parse(lines[0]);
    if (firstEvent.type === "meta" && firstEvent.meta) {
      Object.assign(firstEvent.meta, updates, {
        archived: resolved.archived,
        updated: new Date().toISOString(),
      });
      lines[0] = JSON.stringify(firstEvent);
      fs.writeFileSync(resolved.filePath, lines.join("\n") + "\n", "utf-8");
    }
  }

  renameSession(sessionId: string, name: string): boolean {
    if (!this.sessionExists(sessionId)) return false;
    this.updateMeta(sessionId, { name });
    return true;
  }

  loadSession(sessionId: string): { meta: SessionMeta; messages: ChatMessage[] } | null {
    const events = this.readSessionEvents(sessionId);
    if (events.length === 0) return null;

    let meta: SessionMeta | null = null;
    const messages: ChatMessage[] = [];
    for (const event of events) {
      if (event.type === "meta" && event.meta) {
        meta = event.meta;
      } else if (event.type === "msg") {
        const msg = this.eventToMessage(event);
        if (msg) messages.push(msg);
      }
    }

    if (!meta) return null;
    return { meta, messages };
  }

  readSessionEvents(sessionId: string): SessionEvent[] {
    const resolved = this.resolveSessionPath(sessionId);
    if (!resolved) return [];

    const lines = fs.readFileSync(resolved.filePath, "utf-8").split("\n").filter(Boolean);
    const events: SessionEvent[] = [];
    for (const line of lines) {
      try {
        const event: SessionEvent = JSON.parse(line);
        if (event.type === "meta" && event.meta) {
          event.meta.archived = resolved.archived;
        }
        events.push(event);
      } catch {
        // Skip malformed lines.
      }
    }
    return events;
  }

  rewriteSession(sessionId: string, events: SessionEvent[]): boolean {
    const resolved = this.resolveSessionPath(sessionId);
    if (!resolved) return false;
    const serialized = events.map((event) => JSON.stringify(event)).join("\n");
    fs.writeFileSync(resolved.filePath, serialized + (serialized ? "\n" : ""), "utf-8");
    return true;
  }

  rollbackTurns(sessionId: string, numTurns: number): boolean {
    if (numTurns <= 0) return true;
    const events = this.readSessionEvents(sessionId);
    if (events.length === 0) return false;

    const metaEvent = events.find((event) => event.type === "meta" && event.meta);
    if (!metaEvent?.meta) return false;

    const bodyEvents = events.slice(1);
    const firstTurnIndex = bodyEvents.findIndex(
      (event) => event.type === "msg" && event.role === "user",
    );
    const prefixEvents = firstTurnIndex >= 0 ? bodyEvents.slice(0, firstTurnIndex) : bodyEvents;
    const turnEvents = firstTurnIndex >= 0 ? this.groupTurnEvents(bodyEvents.slice(firstTurnIndex)) : [];
    if (turnEvents.length === 0) return true;

    const keptTurns = Math.max(0, turnEvents.length - numTurns);
    const keptEvents = [...prefixEvents, ...turnEvents.slice(0, keptTurns).flat()];
    metaEvent.meta.turns = keptTurns;
    metaEvent.meta.updated = new Date().toISOString();

    return this.rewriteSession(sessionId, [metaEvent, ...keptEvents]);
  }

  archiveSession(sessionId: string): boolean {
    const active = this.sessionPath(sessionId);
    if (!fs.existsSync(active)) return false;
    const archived = this.sessionPath(sessionId, true);
    fs.renameSync(active, archived);
    this.updateMeta(sessionId, { archived: true });
    return true;
  }

  unarchiveSession(sessionId: string): boolean {
    const archived = this.sessionPath(sessionId, true);
    if (!fs.existsSync(archived)) return false;
    const active = this.sessionPath(sessionId);
    fs.renameSync(archived, active);
    this.updateMeta(sessionId, { archived: false });
    return true;
  }

  listSessions(opts?: { archived?: boolean; includeArchived?: boolean }): SessionMeta[] {
    this.ensureDir();
    const sessions: SessionMeta[] = [];

    const includeActive = opts?.archived !== true;
    const includeArchived = opts?.archived === true || opts?.includeArchived;

    if (includeActive) {
      sessions.push(...this.loadMetasFromDir(this.sessionDir, false));
    }
    if (includeArchived) {
      sessions.push(...this.loadMetasFromDir(this.archivedDir, true));
    }

    sessions.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
    return sessions;
  }

  deleteSession(sessionId: string): boolean {
    const resolved = this.resolveSessionPath(sessionId);
    if (!resolved) return false;
    fs.unlinkSync(resolved.filePath);
    return true;
  }

  clearSessions(opts?: { archived?: boolean }): number {
    const dirs = opts?.archived ? [this.archivedDir] : [this.sessionDir, this.archivedDir];
    let deleted = 0;

    for (const dir of dirs) {
      const files = fs.readdirSync(dir).filter((file) => file.endsWith(".jsonl"));
      for (const file of files) {
        fs.unlinkSync(path.join(dir, file));
        deleted++;
      }
    }

    return deleted;
  }

  private loadMetasFromDir(dir: string, archived: boolean): SessionMeta[] {
    const files = fs.readdirSync(dir).filter((file) => file.endsWith(".jsonl"));
    const sessions: SessionMeta[] = [];

    for (const file of files) {
      try {
        const firstLine = fs.readFileSync(path.join(dir, file), "utf-8").split("\n")[0];
        if (!firstLine) continue;
        const event: SessionEvent = JSON.parse(firstLine);
        if (event.type === "meta" && event.meta) {
          event.meta.archived = archived;
          sessions.push(event.meta);
        }
      } catch {
        // Skip corrupted session files.
      }
    }

    return sessions;
  }

  private eventToMessage(event: SessionEvent): ChatMessage | null {
    if (!event.role) return null;

    switch (event.role) {
      case "system":
        return { role: "system", content: event.content || "" };
      case "user":
        return { role: "user", content: event.content || "" };
      case "assistant": {
        const msg: any = { role: "assistant", content: event.content || null };
        if (event.toolCalls && event.toolCalls.length > 0) {
          msg.tool_calls = event.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.arguments },
          }));
        }
        return msg;
      }
      case "tool":
        return {
          role: "tool",
          tool_call_id: event.toolCallId || "",
          content: event.content || "",
        };
      default:
        return null;
    }
  }

  private groupTurnEvents(events: SessionEvent[]): SessionEvent[][] {
    const turns: SessionEvent[][] = [];
    let current: SessionEvent[] = [];

    for (const event of events) {
      if (event.type === "msg" && event.role === "user") {
        if (current.length > 0) turns.push(current);
        current = [event];
      } else if (current.length > 0) {
        current.push(event);
      }
    }

    if (current.length > 0) turns.push(current);
    return turns;
  }

  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString("hex");
    return `${timestamp}-${random}`;
  }

  sessionExists(sessionId: string): boolean {
    return this.resolveSessionPath(sessionId) !== null;
  }

  autoName(prompt: string): string {
    const cleaned = prompt.replace(/\s+/g, " ").trim();
    if (cleaned.length <= 60) return cleaned;
    return cleaned.slice(0, 57) + "...";
  }
}
