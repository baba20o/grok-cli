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
