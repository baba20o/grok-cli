import assert from "node:assert";
import { describe, it, afterEach } from "node:test";
import { checkApproval, clearApprovalCache } from "../src/approvals.js";

describe("approvals", () => {
  afterEach(() => {
    clearApprovalCache();
  });

  it("always allows safe read-only tools", async () => {
    const allowed = await checkApproval(
      {
        approvalPolicy: "ask",
        toolApprovals: { tools: {} },
      } as any,
      "read_file",
      JSON.stringify({ file_path: "src/index.ts" }),
    );
    assert.strictEqual(allowed, true);
  });

  it("respects deny-writes for write, memory, and shell tools", async () => {
    const writeAllowed = await checkApproval(
      {
        approvalPolicy: "deny-writes",
        toolApprovals: { tools: {} },
      } as any,
      "write_file",
      JSON.stringify({ file_path: "tmp.txt", content: "blocked" }),
    );
    const bashAllowed = await checkApproval(
      {
        approvalPolicy: "deny-writes",
        toolApprovals: { tools: {} },
      } as any,
      "bash",
      JSON.stringify({ command: "echo nope" }),
    );
    const rememberAllowed = await checkApproval(
      {
        approvalPolicy: "deny-writes",
        toolApprovals: { tools: {} },
      } as any,
      "remember_memory",
      JSON.stringify({ title: "style", content: "be concise" }),
    );
    const forgetAllowed = await checkApproval(
      {
        approvalPolicy: "deny-writes",
        toolApprovals: { tools: {} },
      } as any,
      "forget_memory",
      JSON.stringify({ id: "style" }),
    );
    assert.strictEqual(writeAllowed, false);
    assert.strictEqual(bashAllowed, false);
    assert.strictEqual(rememberAllowed, false);
    assert.strictEqual(forgetAllowed, false);
  });

  it("applies explicit per-tool overrides", async () => {
    const allowed = await checkApproval(
      {
        approvalPolicy: "deny-writes",
        toolApprovals: { tools: { bash: "allow", write_file: "deny" } },
      } as any,
      "bash",
      JSON.stringify({ command: "echo ok" }),
    );
    const denied = await checkApproval(
      {
        approvalPolicy: "always-approve",
        toolApprovals: { tools: { write_file: "deny" } },
      } as any,
      "write_file",
      JSON.stringify({ file_path: "tmp.txt", content: "blocked" }),
    );
    assert.strictEqual(allowed, true);
    assert.strictEqual(denied, false);
  });
});
