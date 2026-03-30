import assert from "node:assert";
import { describe, it } from "node:test";
import {
  collectResponseIncludes,
  normalizeServerTools,
  serializeServerTools,
} from "../src/server-tools.js";

describe("server tools", () => {
  it("normalizes and merges repeated tool configs", () => {
    const tools = normalizeServerTools([
      "web_search",
      {
        type: "web_search",
        filters: { allowedDomains: ["docs.x.ai"], excludedDomains: ["example.com"] },
        includeSources: true,
      },
      {
        type: "web_search",
        filters: { allowedDomains: ["api.x.ai"] },
        enableImageUnderstanding: true,
      },
      {
        type: "file_search",
        collectionIds: ["col_a"],
        includeResults: true,
      },
      {
        type: "file_search",
        collectionIds: ["col_b"],
        retrievalMode: "hybrid",
      },
    ]);

    assert.strictEqual(tools.length, 2);
    assert.deepStrictEqual(tools[0], {
      type: "web_search",
      filters: {
        allowedDomains: ["docs.x.ai", "api.x.ai"],
        excludedDomains: ["example.com"],
      },
      includeSources: true,
      enableImageUnderstanding: true,
    });
    assert.strictEqual(tools[1].type, "file_search");
    assert.deepStrictEqual(tools[1].collectionIds, ["col_a", "col_b"]);
    assert.strictEqual(tools[1].includeResults, true);
    assert.strictEqual(tools[1].retrievalMode, "hybrid");
  });

  it("serializes typed tool config and MCP settings for responses", () => {
    const serialized = serializeServerTools(
      [
        {
          type: "web_search",
          filters: {
            allowedDomains: ["docs.x.ai"],
            excludedDomains: ["example.com"],
          },
          enableImageUnderstanding: true,
        },
        {
          type: "x_search",
          allowedXHandles: ["xai"],
          excludedXHandles: ["spam"],
          fromDate: "2026-03-01",
          toDate: "2026-03-29",
          enableImageUnderstanding: true,
          enableVideoUnderstanding: true,
        },
        {
          type: "code_execution",
          includeOutputs: true,
        },
        {
          type: "file_search",
          collectionIds: ["col_a", "col_b"],
          retrievalMode: "semantic",
          maxNumResults: 8,
          includeResults: true,
        },
      ],
      [
        {
          label: "wiki",
          url: "https://mcp.example.com",
          description: "Team wiki",
          allowedTools: ["search", "read_page"],
        },
      ],
    );

    assert.deepStrictEqual(serialized, [
      {
        type: "web_search",
        filters: {
          allowed_domains: ["docs.x.ai"],
          excluded_domains: ["example.com"],
        },
        enable_image_understanding: true,
      },
      {
        type: "x_search",
        allowed_x_handles: ["xai"],
        excluded_x_handles: ["spam"],
        from_date: "2026-03-01",
        to_date: "2026-03-29",
        enable_image_understanding: true,
        enable_video_understanding: true,
      },
      { type: "code_interpreter" },
      {
        type: "file_search",
        vector_store_ids: ["col_a", "col_b"],
        max_num_results: 8,
        retrieval_mode: { type: "semantic" },
      },
      {
        type: "mcp",
        server_url: "https://mcp.example.com",
        server_label: "wiki",
        server_description: "Team wiki",
        allowed_tools: ["search", "read_page"],
      },
    ]);
  });

  it("collects include paths for enabled tool outputs", () => {
    const includes = collectResponseIncludes(
      [
        { type: "web_search", includeSources: true },
        { type: "code_execution", includeOutputs: true },
        { type: "file_search", collectionIds: ["col_a"], includeResults: true },
      ],
      false,
    );

    assert.deepStrictEqual(includes, [
      "web_search_call.action.sources",
      "code_interpreter_call.outputs",
      "file_search_call.results",
    ]);
  });
});
