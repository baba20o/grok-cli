import assert from "node:assert";
import { describe, it } from "node:test";
import {
  extractCitationsFromContent,
  extractServerToolUsage,
  getServerToolEvent,
  sanitizeResponseText,
} from "../src/response-utils.js";

describe("response utils", () => {
  it("strips internal xAI tool markup from assistant text", () => {
    assert.strictEqual(
      sanitizeResponseText('<parameter name="limit">20</parameter>'),
      "",
    );
    assert.strictEqual(
      sanitizeResponseText('</xai:function_call>**Answer**'),
      "**Answer**",
    );
    assert.strictEqual(
      sanitizeResponseText('<parameter name="limit">20</parameter></xai:function_call>**Answer**'),
      "**Answer**",
    );
  });

  it("extracts normalized server tool usage from usage details", () => {
    assert.deepStrictEqual(
      extractServerToolUsage({
        usage: {
          server_side_tool_usage_details: {
            web_search_calls: 0,
            x_search_calls: 3,
            code_interpreter_calls: 1,
            file_search_calls: 2,
            mcp_calls: 0,
          },
        },
      }),
      {
        x_search: 3,
        code_execution: 1,
        file_search: 2,
      },
    );
  });

  it("derives server tool events from custom tool calls", () => {
    assert.deepStrictEqual(
      getServerToolEvent({
        type: "custom_tool_call",
        id: "ctc_123",
        call_id: "xs_456",
        name: "x_keyword_search",
        input: '{"query":"from:xai"}',
      }),
      {
        name: "x_search",
        payload: {
          id: "ctc_123",
          call_id: "xs_456",
          tool: "x_keyword_search",
          input: '{"query":"from:xai"}',
        },
      },
    );
  });

  it("extracts citations from message content annotations", () => {
    assert.deepStrictEqual(
      extractCitationsFromContent([
        {
          type: "output_text",
          text: "Answer",
          annotations: [
            {
              type: "url_citation",
              url: "https://docs.x.ai/overview",
              title: "Overview",
            },
          ],
        },
      ]),
      [{ url: "https://docs.x.ai/overview", title: "Overview" }],
    );
  });
});
