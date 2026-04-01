import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  augmentPromptWithMemory,
  countMemories,
  forgetMemory,
  getMemoryDirs,
  listMemories,
  rememberMemory,
  searchMemories,
} from "../src/memory.js";

const tmpRoot = path.join(process.cwd(), ".tmp");
fs.mkdirSync(tmpRoot, { recursive: true });
const testBaseDir = fs.mkdtempSync(path.join(tmpRoot, "grok-cli-memory-test-"));
const projectDir = path.join(testBaseDir, "workspace");
fs.mkdirSync(projectDir, { recursive: true });

describe("memory", () => {
  it("saves memories and rebuilds project/user indexes", () => {
    const projectMemory = rememberMemory(testBaseDir, projectDir, {
      title: "Testing preference",
      description: "Prefer focused unit tests",
      content: "Use Vitest and keep tests focused on behavior, not implementation details.",
      scope: "project",
      type: "project",
    });
    const userMemory = rememberMemory(testBaseDir, projectDir, {
      title: "User coding preference",
      content: "The user prefers TypeScript by default.",
      scope: "user",
      type: "user",
    });

    const dirs = getMemoryDirs(testBaseDir, projectDir);
    assert.ok(fs.existsSync(projectMemory.filePath));
    assert.ok(fs.existsSync(userMemory.filePath));
    assert.ok(fs.readFileSync(path.join(dirs.project, "MEMORY.md"), "utf-8").includes("Testing preference"));
    assert.ok(fs.readFileSync(path.join(dirs.user, "MEMORY.md"), "utf-8").includes("User coding preference"));
  });

  it("searches and recalls relevant memory heuristically", async () => {
    const matches = searchMemories(testBaseDir, projectDir, "vitest testing preference", {
      scope: "all",
      limit: 3,
    });
    assert.ok(matches.length >= 1);
    assert.strictEqual(matches[0].title, "Testing preference");

    const prepared = await augmentPromptWithMemory(
      {
        sessionDir: testBaseDir,
        convId: null,
        memory: {
          enabled: true,
          autoRecall: true,
          useSemanticRecall: false,
          recallLimit: 2,
          selectorModel: "unused",
          defaultScope: "project",
        },
      } as any,
      projectDir,
      "Please add Vitest coverage for the new helper.",
    );

    assert.ok(prepared.recall);
    assert.ok(prepared.prompt.includes("<relevant_memory>"));
    assert.ok(prepared.prompt.includes("Testing preference"));
  });

  it("does not recall unrelated memory just because it is recent", async () => {
    const prepared = await augmentPromptWithMemory(
      {
        sessionDir: testBaseDir,
        convId: null,
        memory: {
          enabled: true,
          autoRecall: true,
          useSemanticRecall: false,
          recallLimit: 2,
          selectorModel: "unused",
          defaultScope: "project",
        },
      } as any,
      projectDir,
      "In one sentence, what does xAI do?",
    );

    assert.strictEqual(prepared.recall, null);
    assert.strictEqual(prepared.prompt, "In one sentence, what does xAI do?");
  });

  it("lists counts and forgets memory entries", () => {
    const all = listMemories(testBaseDir, projectDir, "all");
    assert.ok(all.length >= 2);

    const countsBefore = countMemories(testBaseDir, projectDir);
    assert.ok(countsBefore.project >= 1);
    assert.ok(countsBefore.user >= 1);

    const deleted = forgetMemory(testBaseDir, projectDir, "User coding preference", "user");
    assert.ok(deleted);

    const countsAfter = countMemories(testBaseDir, projectDir);
    assert.strictEqual(countsAfter.user, countsBefore.user - 1);
  });
});
