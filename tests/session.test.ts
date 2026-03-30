import { SessionManager } from "../src/session.js";
import assert from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";

const tmpRoot = path.join(process.cwd(), ".tmp");
fs.mkdirSync(tmpRoot, { recursive: true });
const testDir = fs.mkdtempSync(path.join(tmpRoot, "grok-cli-session-test-"));

describe("SessionManager", () => {
  const mgr = new SessionManager(testDir);

  it("creates a session", () => {
    const meta = mgr.createSession({ model: "test-model", cwd: "/tmp", name: "Test Session" });
    assert.ok(meta.id);
    assert.strictEqual(meta.name, "Test Session");
    assert.strictEqual(meta.model, "test-model");
    assert.strictEqual(meta.turns, 0);
  });

  it("appends messages and loads them", () => {
    const meta = mgr.createSession({ model: "test-model", cwd: "/tmp" });
    mgr.appendMessage(meta.id, "system", "You are a test.");
    mgr.appendMessage(meta.id, "user", "Hello");
    mgr.appendMessage(meta.id, "assistant", "Hi there!");

    const loaded = mgr.loadSession(meta.id);
    assert.ok(loaded);
    assert.strictEqual(loaded.messages.length, 3);
    assert.strictEqual((loaded.messages[0] as any).role, "system");
    assert.strictEqual((loaded.messages[1] as any).role, "user");
    assert.strictEqual((loaded.messages[2] as any).role, "assistant");
  });

  it("lists sessions sorted by date", () => {
    const sessions = mgr.listSessions();
    assert.ok(sessions.length >= 2);
    // Most recent first
    assert.ok(new Date(sessions[0].updated) >= new Date(sessions[1].updated));
  });

  it("deletes a session", () => {
    const meta = mgr.createSession({ model: "test-model", cwd: "/tmp", name: "To Delete" });
    assert.ok(mgr.sessionExists(meta.id));
    const deleted = mgr.deleteSession(meta.id);
    assert.ok(deleted);
    assert.ok(!mgr.sessionExists(meta.id));
  });

  it("updates session metadata", () => {
    const meta = mgr.createSession({ model: "test-model", cwd: "/tmp" });
    mgr.updateMeta(meta.id, { name: "Updated Name", turns: 5 });
    const loaded = mgr.loadSession(meta.id);
    assert.ok(loaded);
    assert.strictEqual(loaded.meta.name, "Updated Name");
    assert.strictEqual(loaded.meta.turns, 5);
  });

  it("auto-names from prompt", () => {
    const name = mgr.autoName("fix the bug in src/utils.ts and add tests");
    assert.strictEqual(name, "fix the bug in src/utils.ts and add tests");

    const longName = mgr.autoName("a".repeat(100));
    assert.ok(longName.length <= 60);
    assert.ok(longName.endsWith("..."));
  });

  it("archives and restores a session", () => {
    const meta = mgr.createSession({ model: "test-model", cwd: "/tmp", name: "Archive Me" });
    assert.ok(mgr.archiveSession(meta.id));
    const archived = mgr.listSessions({ archived: true });
    assert.ok(archived.some((session) => session.id === meta.id && session.archived));
    assert.ok(mgr.unarchiveSession(meta.id));
    const active = mgr.listSessions();
    assert.ok(active.some((session) => session.id === meta.id && !session.archived));
  });

  it("rolls back the last turn", () => {
    const meta = mgr.createSession({ model: "test-model", cwd: "/tmp", name: "Rollback" });
    mgr.appendMessage(meta.id, "system", "system");
    mgr.appendMessage(meta.id, "user", "turn one");
    mgr.appendMessage(meta.id, "assistant", "answer one");
    mgr.appendMessage(meta.id, "user", "turn two");
    mgr.appendMessage(meta.id, "assistant", "answer two");
    mgr.updateMeta(meta.id, { turns: 2 });

    assert.ok(mgr.rollbackTurns(meta.id, 1));
    const loaded = mgr.loadSession(meta.id);
    assert.ok(loaded);
    assert.strictEqual(loaded.meta.turns, 1);
    assert.strictEqual(loaded.messages.length, 3);
    assert.strictEqual((loaded.messages[2] as any).content, "answer one");
  });

  it("clears all sessions", () => {
    mgr.createSession({ model: "m", cwd: "/tmp" });
    mgr.createSession({ model: "m", cwd: "/tmp" });
    const count = mgr.clearSessions();
    assert.ok(count >= 2);
    assert.strictEqual(mgr.listSessions().length, 0);
  });
});

process.on("exit", () => {
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
});
