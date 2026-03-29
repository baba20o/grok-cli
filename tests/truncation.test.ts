import { approxTokenCount, truncateOutput } from "../src/truncation.js";
import assert from "node:assert";
import { describe, it } from "node:test";

describe("approxTokenCount", () => {
  it("estimates tokens from text length", () => {
    assert.strictEqual(approxTokenCount(""), 0);
    assert.strictEqual(approxTokenCount("hi"), 1);
    assert.strictEqual(approxTokenCount("hello world this is a test"), 7);
  });
});

describe("truncateOutput", () => {
  it("returns short output unchanged", () => {
    const input = "short output";
    assert.strictEqual(truncateOutput(input, 100), input);
  });

  it("truncates long output with middle omission", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}: ${"x".repeat(50)}`);
    const input = lines.join("\n");
    const result = truncateOutput(input, 500);
    assert.ok(result.length < input.length, "Should be shorter");
    assert.ok(result.includes("omitted") || result.includes("truncated"), "Should have truncation notice");
    assert.ok(result.includes("line 1:"), "Should keep beginning");
  });

  it("handles single-line content", () => {
    const input = "a".repeat(100000);
    const result = truncateOutput(input, 100);
    assert.ok(result.length < input.length, "Should be shorter");
    assert.ok(
      result.includes("truncated") || result.includes("omitted"),
      "Should have truncation/omission notice",
    );
  });
});
