import { needsCompaction } from "../src/compaction.js";
import assert from "node:assert";
import { describe, it } from "node:test";

describe("needsCompaction", () => {
  it("returns false for short conversations", () => {
    const messages = [
      { role: "system", content: "You are Grok CLI." },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ] as any;

    assert.strictEqual(needsCompaction(messages), false);
  });

  it("compacts based on message character count", () => {
    const messages = [
      { role: "system", content: "You are Grok CLI." },
      { role: "user", content: "x".repeat(400_100) },
    ] as any;

    assert.strictEqual(needsCompaction(messages), true);
  });

  it("counts structured message content and tool calls", () => {
    const messages = [
      { role: "system", content: "You are Grok CLI." },
      {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "bash", arguments: JSON.stringify({ command: "echo hi" }) },
          },
        ],
      },
    ] as any;

    assert.strictEqual(needsCompaction(messages, 1), true);
  });
});
