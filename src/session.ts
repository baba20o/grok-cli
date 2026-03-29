import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  SessionMeta,
  SessionEvent,
  ChatMessage,
  SerializedToolCall,
} from "./types.js";

const SESSION_DIR_NAME = "sessions";

export class SessionManager {
  private sessionDir: string;

  constructor(baseDir: string) {
    this.sessionDir = path.join(baseDir, SESSION_DIR_NAME);
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  private sessionPath(id: string): string {
    return path.join(this.sessionDir, `${id}.jsonl`);
  }

  // --- Create ---

  createSession(opts: {
    model: string;
    cwd: string;
    name?: string;
  }): SessionMeta {
    const id = this.generateId();
    const now = new Date().toISOString();

    const meta: SessionMeta = {
      id,
      name: opts.name || "New session",
      model: opts.model,
      cwd: opts.cwd,
      created: now,
      updated: now,
      turns: 0,
      lastResponseId: null,
    };

    // Write meta as first line
    const event: SessionEvent = { ts: now, type: "meta", meta };
    fs.writeFileSync(this.sessionPath(id), JSON.stringify(event) + "\n", "utf-8");

    return meta;
  }

  // --- Append Events ---

  appendMessage(
    sessionId: string,
    role: "system" | "user" | "assistant" | "tool",
    content: string | null,
    extra?: {
      toolCalls?: SerializedToolCall[];
      toolCallId?: string;
    },
  ): void {
    const event: SessionEvent = {
      ts: new Date().toISOString(),
      type: "msg",
      role,
      content,
      ...extra,
    };
    fs.appendFileSync(this.sessionPath(sessionId), JSON.stringify(event) + "\n", "utf-8");
  }

  appendToolExec(
    sessionId: string,
    toolName: string,
    toolArgs: string,
    toolOutput: string,
    toolError: boolean,
  ): void {
    const event: SessionEvent = {
      ts: new Date().toISOString(),
      type: "tool_exec",
      toolName,
      toolArgs,
      toolOutput: toolOutput.slice(0, 10000), // Cap logged output
      toolError,
    };
    fs.appendFileSync(this.sessionPath(sessionId), JSON.stringify(event) + "\n", "utf-8");
  }

  // --- Update Meta ---

  updateMeta(sessionId: string, updates: Partial<SessionMeta>): void {
    const filePath = this.sessionPath(sessionId);
    if (!fs.existsSync(filePath)) return;

    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    if (lines.length === 0) return;

    const firstEvent: SessionEvent = JSON.parse(lines[0]);
    if (firstEvent.type === "meta" && firstEvent.meta) {
      Object.assign(firstEvent.meta, updates, { updated: new Date().toISOString() });
      lines[0] = JSON.stringify(firstEvent);
      fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
    }
  }

  // --- Load ---

  loadSession(sessionId: string): { meta: SessionMeta; messages: ChatMessage[] } | null {
    const filePath = this.sessionPath(sessionId);
    if (!fs.existsSync(filePath)) return null;

    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    if (lines.length === 0) return null;

    let meta: SessionMeta | null = null;
    const messages: ChatMessage[] = [];

    for (const line of lines) {
      try {
        const event: SessionEvent = JSON.parse(line);

        if (event.type === "meta" && event.meta) {
          meta = event.meta;
        } else if (event.type === "msg") {
          const msg = this.eventToMessage(event);
          if (msg) messages.push(msg);
        }
        // tool_exec events are for logging only, not replayed
      } catch {
        // Skip malformed lines
      }
    }

    if (!meta) return null;
    return { meta, messages };
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
          msg.tool_calls = event.toolCalls.map(tc => ({
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

  // --- List ---

  listSessions(): SessionMeta[] {
    this.ensureDir();
    const files = fs.readdirSync(this.sessionDir).filter(f => f.endsWith(".jsonl"));
    const sessions: SessionMeta[] = [];

    for (const file of files) {
      try {
        const filePath = path.join(this.sessionDir, file);
        const firstLine = fs.readFileSync(filePath, "utf-8").split("\n")[0];
        if (!firstLine) continue;
        const event: SessionEvent = JSON.parse(firstLine);
        if (event.type === "meta" && event.meta) {
          sessions.push(event.meta);
        }
      } catch {
        // Skip corrupted files
      }
    }

    // Sort by updated date, most recent first
    sessions.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
    return sessions;
  }

  // --- Delete ---

  deleteSession(sessionId: string): boolean {
    const filePath = this.sessionPath(sessionId);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  clearSessions(): number {
    const files = fs.readdirSync(this.sessionDir).filter(f => f.endsWith(".jsonl"));
    for (const file of files) {
      fs.unlinkSync(path.join(this.sessionDir, file));
    }
    return files.length;
  }

  // --- Helpers ---

  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString("hex");
    return `${timestamp}-${random}`;
  }

  sessionExists(sessionId: string): boolean {
    return fs.existsSync(this.sessionPath(sessionId));
  }

  /** Auto-name a session from the first user prompt */
  autoName(prompt: string): string {
    const cleaned = prompt.replace(/\s+/g, " ").trim();
    if (cleaned.length <= 60) return cleaned;
    return cleaned.slice(0, 57) + "...";
  }
}
