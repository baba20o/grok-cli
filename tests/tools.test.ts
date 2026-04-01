import { executeTool } from "../src/tools/index.js";
import assert from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";

const tmpRoot = path.join(process.cwd(), ".tmp");
fs.mkdirSync(tmpRoot, { recursive: true });
const testDir = fs.mkdtempSync(path.join(tmpRoot, "grok-cli-test-"));

describe("tools", () => {
  describe("list_directory", () => {
    it("lists files in a directory", async () => {
      const result = await executeTool("list_directory", JSON.stringify({ path: "." }), testDir);
      assert.ok(!result.error);
    });
  });

  describe("write_file + read_file", () => {
    it("creates and reads a file", async () => {
      const filePath = path.join(testDir, "test-write.txt");
      const content = "hello from test";

      const writeResult = await executeTool(
        "write_file",
        JSON.stringify({ file_path: filePath, content }),
        testDir,
      );
      assert.ok(!writeResult.error, `Write failed: ${writeResult.output}`);
      assert.ok(writeResult.output.includes("Created"));

      const readResult = await executeTool(
        "read_file",
        JSON.stringify({ file_path: filePath }),
        testDir,
      );
      assert.ok(!readResult.error, `Read failed: ${readResult.output}`);
      assert.ok(readResult.output.includes("hello from test"));
    });
  });

  describe("edit_file", () => {
    it("edits a file with find-and-replace", async () => {
      const filePath = path.join(testDir, "test-edit.txt");
      fs.writeFileSync(filePath, "line one\nline two\nline three\n");

      const result = await executeTool(
        "edit_file",
        JSON.stringify({ file_path: filePath, old_string: "line two", new_string: "LINE TWO MODIFIED" }),
        testDir,
      );
      assert.ok(!result.error, `Edit failed: ${result.output}`);

      const content = fs.readFileSync(filePath, "utf-8");
      assert.ok(content.includes("LINE TWO MODIFIED"));
      assert.ok(!content.includes("line two"));
    });

    it("rejects edits with no match", async () => {
      const filePath = path.join(testDir, "test-edit.txt");
      const result = await executeTool(
        "edit_file",
        JSON.stringify({ file_path: filePath, old_string: "DOES NOT EXIST", new_string: "replacement" }),
        testDir,
      );
      assert.ok(result.error);
      assert.ok(result.output.includes("not found"));
    });
  });

  describe("glob", () => {
    it("finds files by pattern", async () => {
      fs.writeFileSync(path.join(testDir, "a.ts"), "");
      fs.writeFileSync(path.join(testDir, "b.ts"), "");
      fs.writeFileSync(path.join(testDir, "c.js"), "");

      const result = await executeTool("glob", JSON.stringify({ pattern: "*.ts" }), testDir);
      assert.ok(!result.error);
      assert.ok(result.output.includes("a.ts"));
      assert.ok(result.output.includes("b.ts"));
      assert.ok(!result.output.includes("c.js"));
    });
  });

  describe("grep", () => {
    it("finds content by regex", async () => {
      fs.writeFileSync(path.join(testDir, "search.txt"), "findme123\nother line\nfindme456\n");

      const result = await executeTool(
        "grep",
        JSON.stringify({ pattern: "findme\\d+", path: testDir }),
        testDir,
      );
      assert.ok(!result.error);
      assert.ok(result.output.includes("findme123"));
      assert.ok(result.output.includes("findme456"));
    });
  });

  describe("bash", () => {
    it("executes a command", async () => {
      const result = await executeTool("bash", JSON.stringify({ command: "echo hello_world" }), testDir);
      assert.ok(!result.error, `Bash failed: ${result.output}`);
      assert.ok(result.output.includes("hello_world"));
    });

    it("returns error on failed command", async () => {
      const result = await executeTool("bash", JSON.stringify({ command: "exit 42" }), testDir);
      assert.ok(result.error);
      assert.ok(result.output.includes("exit code"));
    });

    it("blocks shell execution under workspace-write sandbox", async () => {
      const result = await executeTool(
        "bash",
        JSON.stringify({ command: "echo should_not_run" }),
        testDir,
        { sandboxMode: "workspace-write" },
      );
      assert.ok(result.error);
      assert.ok(result.output.includes("Sandbox policy"));
    });
  });

  describe("ask_user_question", () => {
    it("fails cleanly without an interactive terminal", async () => {
      const result = await executeTool(
        "ask_user_question",
        JSON.stringify({
          questions: [
            {
              question: "Which style?",
              options: [
                { label: "Cursor" },
                { label: "Offset" },
              ],
            },
          ],
        }),
        testDir,
      );
      assert.ok(result.error);
      assert.ok(result.output.includes("interactive terminal"));
    });
  });

  describe("lsp", () => {
    it("finds definitions and workspace symbols in TS files", async () => {
      const projectDir = path.join(testDir, "tsproj");
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
        },
      }, null, 2));
      fs.writeFileSync(
        path.join(projectDir, "a.ts"),
        'export function greet(name: string) {\n  return `hi ${name}`;\n}\n',
      );
      fs.writeFileSync(
        path.join(projectDir, "b.ts"),
        'import { greet } from "./a.js";\nconst value = greet("world");\n',
      );

      const definition = await executeTool(
        "lsp",
        JSON.stringify({
          operation: "definition",
          file_path: "b.ts",
          line: 2,
          character: 15,
        }),
        projectDir,
      );
      assert.ok(!definition.error, `Definition failed: ${definition.output}`);
      assert.ok(definition.output.includes("a.ts:1:"));

      const workspaceSymbols = await executeTool(
        "lsp",
        JSON.stringify({
          operation: "workspace_symbols",
          query: "greet",
        }),
        projectDir,
      );
      assert.ok(!workspaceSymbols.error, `Workspace symbols failed: ${workspaceSymbols.output}`);
      assert.ok(workspaceSymbols.output.includes("greet"));
    });
  });

  describe("tool_search", () => {
    it("finds tools by capability keywords", async () => {
      const result = await executeTool(
        "tool_search",
        JSON.stringify({ query: "definition references symbols", max_results: 3 }),
        testDir,
      );
      assert.ok(!result.error, `tool_search failed: ${result.output}`);
      assert.ok(result.output.includes("lsp"));
    });
  });

  describe("memory tools", () => {
    it("saves, searches, and forgets persistent memory", async () => {
      const memoryRoot = path.join(tmpRoot, "memory-tools");
      fs.mkdirSync(memoryRoot, { recursive: true });
      const memorySettings = {
        enabled: true,
        autoRecall: true,
        useSemanticRecall: false,
        recallLimit: 3,
        selectorModel: "unused",
        defaultScope: "project",
      } as const;

      const saved = await executeTool(
        "remember_memory",
        JSON.stringify({
          title: "CLI style",
          content: "Keep CLI output concise and direct.",
          type: "feedback",
        }),
        testDir,
        {
          sessionDir: memoryRoot,
          memorySettings,
        },
      );
      assert.ok(!saved.error, `remember_memory failed: ${saved.output}`);
      assert.ok(saved.output.includes("Saved memory"));

      const searched = await executeTool(
        "memory_search",
        JSON.stringify({ query: "CLI concise output", limit: 3, include_content: true }),
        testDir,
        {
          sessionDir: memoryRoot,
          memorySettings,
        },
      );
      assert.ok(!searched.error, `memory_search failed: ${searched.output}`);
      assert.ok(searched.output.includes("CLI style"));

      const forgotten = await executeTool(
        "forget_memory",
        JSON.stringify({ id: "CLI style", scope: "project" }),
        testDir,
        {
          sessionDir: memoryRoot,
          memorySettings,
        },
      );
      assert.ok(!forgotten.error, `forget_memory failed: ${forgotten.output}`);
      assert.ok(forgotten.output.includes("Deleted memory"));
    });
  });

  describe("sandboxed file access", () => {
    it("blocks writes outside the workspace", async () => {
      const outside = path.resolve(testDir, "..", "outside.txt");
      const result = await executeTool(
        "write_file",
        JSON.stringify({ file_path: outside, content: "nope" }),
        testDir,
        { sandboxMode: "workspace-write" },
      );
      assert.ok(result.error);
      assert.ok(result.output.includes("outside the workspace"));
    });

    it("blocks writes in read-only mode", async () => {
      const filePath = path.join(testDir, "readonly.txt");
      const result = await executeTool(
        "write_file",
        JSON.stringify({ file_path: filePath, content: "blocked" }),
        testDir,
        { sandboxMode: "read-only" },
      );
      assert.ok(result.error);
      assert.ok(result.output.includes("read-only"));
    });

    it("allows reads from configured internal roots", async () => {
      const internalRoot = path.join(tmpRoot, "internal-results");
      fs.mkdirSync(internalRoot, { recursive: true });
      const internalFile = path.join(internalRoot, "result.txt");
      fs.writeFileSync(internalFile, "persisted tool output");

      const blocked = await executeTool(
        "read_file",
        JSON.stringify({ file_path: internalFile }),
        testDir,
        { sandboxMode: "workspace-write" },
      );
      assert.ok(blocked.error);

      const allowed = await executeTool(
        "read_file",
        JSON.stringify({ file_path: internalFile }),
        testDir,
        {
          sandboxMode: "workspace-write",
          allowedReadRoots: [internalRoot],
        },
      );
      assert.ok(!allowed.error, `Read failed: ${allowed.output}`);
      assert.ok(allowed.output.includes("persisted tool output"));
    });
  });

  describe("large output handling", () => {
    it("persists oversized tool output to disk", async () => {
      const largeFile = path.join(testDir, "large.txt");
      const lines = Array.from({ length: 12000 }, (_, i) => `line ${i + 1} ${"x".repeat(40)}`);
      fs.writeFileSync(largeFile, lines.join("\n") + "\n");

      const resultStoreDir = path.join(tmpRoot, "tool-results");
      const result = await executeTool(
        "read_file",
        JSON.stringify({ file_path: largeFile, limit: 5000 }),
        testDir,
        {
          resultStoreDir,
          toolCallId: "call_large",
          maxOutputTokens: 8000,
        },
      );

      assert.ok(!result.error, `Read failed: ${result.output}`);
      assert.ok(result.metadata?.persisted, "Expected persisted metadata");
      assert.ok(result.output.includes("<persisted-output>"));
      assert.ok(result.metadata?.persisted?.path);
      assert.ok(fs.existsSync(result.metadata!.persisted!.path));
    });

    it("falls back to truncation metadata when persistence is unavailable", async () => {
      const largeFile = path.join(testDir, "truncate.txt");
      const lines = Array.from({ length: 8000 }, (_, i) => `row ${i + 1} ${"y".repeat(30)}`);
      fs.writeFileSync(largeFile, lines.join("\n") + "\n");

      const result = await executeTool(
        "read_file",
        JSON.stringify({ file_path: largeFile, limit: 5000 }),
        testDir,
        {
          maxOutputTokens: 400,
        },
      );

      assert.ok(!result.error, `Read failed: ${result.output}`);
      assert.ok(result.metadata?.truncated, "Expected truncation metadata");
      assert.ok(result.output.includes("truncated") || result.output.includes("omitted"));
    });
  });

  describe("unknown tool", () => {
    it("returns error for unknown tools", async () => {
      const result = await executeTool("nonexistent_tool", "{}", testDir);
      assert.ok(result.error);
      assert.ok(result.output.includes("Unknown tool"));
    });
  });
});

// Cleanup
process.on("exit", () => {
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
});
