import assert from "node:assert";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { executeTool } from "../src/tools/index.js";
import {
  createSchedule,
  dueSchedules,
  listSchedules,
  markScheduleRun,
} from "../src/schedules.js";

const tmpRoot = path.join(process.cwd(), ".tmp");
fs.mkdirSync(tmpRoot, { recursive: true });
const testDir = fs.mkdtempSync(path.join(tmpRoot, "grok-cli-workflow-test-"));
const sessionDir = path.join(testDir, "state");
const sessionId = "session-test";

let webServer: http.Server;
let webBaseUrl = "";
let mcpServer: http.Server;
let mcpBaseUrl = "";

before(async () => {
  webServer = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><head><title>Example Page</title></head><body><main><h1>Hello</h1><p>Fetched content body.</p></main></body></html>");
  });
  await new Promise<void>((resolve) => webServer.listen(0, "127.0.0.1", resolve));
  const webAddress = webServer.address();
  if (!webAddress || typeof webAddress === "string") throw new Error("Failed to bind web server");
  webBaseUrl = `http://127.0.0.1:${webAddress.port}`;

  mcpServer = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf-8")) as any : null;

    if (req.method === "POST" && body?.method === "initialize") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "MCP-Session-Id": "test-session",
      });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { protocolVersion: "2025-11-25" },
      }));
      return;
    }

    if (req.method === "POST" && body?.method === "notifications/initialized") {
      res.writeHead(202);
      res.end();
      return;
    }

    if (req.method === "POST" && body?.method === "resources/list") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          resources: [
            { uri: "memo://release-notes", name: "Release Notes" },
          ],
        },
      }));
      return;
    }

    if (req.method === "POST" && body?.method === "resources/read") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          contents: [
            { uri: body.params.uri, text: "Version 0.6.0 shipped workflow tools." },
          ],
        },
      }));
      return;
    }

    if (req.method === "DELETE") {
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => mcpServer.listen(0, "127.0.0.1", resolve));
  const mcpAddress = mcpServer.address();
  if (!mcpAddress || typeof mcpAddress === "string") throw new Error("Failed to bind MCP server");
  mcpBaseUrl = `http://127.0.0.1:${mcpAddress.port}/mcp`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => webServer.close((err) => err ? reject(err) : resolve()));
  await new Promise<void>((resolve, reject) => mcpServer.close((err) => err ? reject(err) : resolve()));
});

describe("workflow tools", () => {
  it("creates, lists, updates, and rewrites tasks", async () => {
    const baseOptions = {
      sessionDir,
      sessionId,
    };

    const created = await executeTool(
      "task_create",
      JSON.stringify({ content: "Investigate session rollback", owner: "lead" }),
      testDir,
      baseOptions,
    );
    assert.ok(!created.error, created.output);
    assert.ok(created.output.includes("task-1"));

    const updated = await executeTool(
      "task_update",
      JSON.stringify({ id: "task-1", status: "in_progress", notes: "Reading session.ts" }),
      testDir,
      baseOptions,
    );
    assert.ok(!updated.error, updated.output);
    assert.ok(updated.output.includes("[in_progress]"));

    const rewritten = await executeTool(
      "todo_write",
      JSON.stringify({
        items: [
          { id: "task-1", content: "Investigate session rollback", status: "completed" },
          { content: "Verify tests", status: "pending" },
        ],
      }),
      testDir,
      baseOptions,
    );
    assert.ok(!rewritten.error, rewritten.output);
    assert.ok(rewritten.output.includes("task-1"));

    const listed = await executeTool("task_list", JSON.stringify({}), testDir, baseOptions);
    assert.ok(!listed.error, listed.output);
    assert.ok(listed.output.includes("Verify tests"));
  });

  it("creates schedules and advances cron schedules after execution", () => {
    const oneShot = createSchedule(sessionDir, {
      prompt: "run nightly report",
      cwd: testDir,
      runAt: "2030-01-01T00:00:00.000Z",
    });
    assert.ok(oneShot.id.startsWith("schedule-"));

    const cron = createSchedule(sessionDir, {
      prompt: "check releases",
      cwd: testDir,
      cron: "0 9 * * 1-5",
    });
    assert.ok(cron.nextRunAt);

    const due = dueSchedules(sessionDir, new Date("2030-01-01T00:00:01.000Z"));
    assert.ok(due.some((entry) => entry.id === oneShot.id));
    markScheduleRun(sessionDir, oneShot.id, new Date("2030-01-01T00:00:01.000Z"));

    const updated = markScheduleRun(sessionDir, cron.id, new Date("2030-01-02T09:00:00.000Z"));
    assert.ok(updated?.nextRunAt);
    assert.ok(new Date(updated!.nextRunAt).getTime() > new Date("2030-01-02T09:00:00.000Z").getTime());

    const all = listSchedules(sessionDir);
    assert.ok(all.some((entry) => entry.id === cron.id));
    assert.ok(!all.some((entry) => entry.id === oneShot.id));
  });

  it("fetches an exact URL and cleans HTML", async () => {
    const result = await executeTool(
      "web_fetch",
      JSON.stringify({ url: webBaseUrl }),
      testDir,
      {},
    );
    assert.ok(!result.error, result.output);
    assert.ok(result.output.includes("Example Page"));
    assert.ok(result.output.includes("Fetched content body."));
  });

  it("inspects and edits notebooks at cell granularity", async () => {
    const notebookPath = path.join(testDir, "analysis.ipynb");
    fs.writeFileSync(notebookPath, JSON.stringify({
      cells: [
        { cell_type: "markdown", metadata: {}, source: ["# Title\n"] },
        { cell_type: "code", metadata: {}, source: ["print('hello')\n"] },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }, null, 2));

    const listed = await executeTool(
      "notebook_edit",
      JSON.stringify({ operation: "list_cells", notebook_path: notebookPath }),
      testDir,
      {},
    );
    assert.ok(!listed.error, listed.output);
    assert.ok(listed.output.includes("0: markdown"));

    const replaced = await executeTool(
      "notebook_edit",
      JSON.stringify({
        operation: "replace_cell",
        notebook_path: notebookPath,
        cell_index: 1,
        source: "print('updated')",
      }),
      testDir,
      {},
    );
    assert.ok(!replaced.error, replaced.output);
    assert.ok(fs.readFileSync(notebookPath, "utf-8").includes("updated"));
  });

  it("lists and reads MCP resources from configured servers", async () => {
    const config = {
      mcpServers: [{ label: "docs", url: mcpBaseUrl }],
    } as any;

    const listed = await executeTool(
      "mcp_list_resources",
      JSON.stringify({ server: "docs" }),
      testDir,
      { config },
    );
    assert.ok(!listed.error, listed.output);
    assert.ok(listed.output.includes("memo://release-notes"));

    const read = await executeTool(
      "mcp_read_resource",
      JSON.stringify({ server: "docs", uri: "memo://release-notes" }),
      testDir,
      { config },
    );
    assert.ok(!read.error, read.output);
    assert.ok(read.output.includes("Version 0.6.0"));
  });
});
