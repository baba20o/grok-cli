import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { getConfig } from "../src/config.js";
import {
  isMultiAgentModel,
  reasoningEffortFromAgentCount,
  reasoningEffortFromResearchDepth,
  supportsChatCompletions,
  supportsClientTools,
} from "../src/model-capabilities.js";

const tmpRoot = path.join(process.cwd(), ".tmp");
fs.mkdirSync(tmpRoot, { recursive: true });

describe("model capabilities", () => {
  it("recognizes multi-agent models and disables unsupported client features", () => {
    assert.strictEqual(isMultiAgentModel("grok-4.20-multi-agent"), true);
    assert.strictEqual(isMultiAgentModel("grok-4.20-multi-agent-0309"), true);
    assert.strictEqual(isMultiAgentModel("grok-4.20-0309-reasoning"), false);
    assert.strictEqual(supportsClientTools("grok-4.20-multi-agent-0309"), false);
    assert.strictEqual(supportsChatCompletions("grok-4.20-multi-agent-0309"), false);
  });

  it("maps research depth and agent count onto reasoning effort", () => {
    assert.strictEqual(reasoningEffortFromResearchDepth("quick"), "low");
    assert.strictEqual(reasoningEffortFromResearchDepth("balanced"), "medium");
    assert.strictEqual(reasoningEffortFromResearchDepth("deep"), "high");
    assert.strictEqual(reasoningEffortFromResearchDepth("max"), "xhigh");
    assert.strictEqual(reasoningEffortFromAgentCount("4"), "medium");
    assert.strictEqual(reasoningEffortFromAgentCount("16"), "high");
    assert.strictEqual(reasoningEffortFromAgentCount("8"), null);
  });

  it("forces Responses API for the multi-agent model", () => {
    const previousKey = process.env.XAI_API_KEY;
    const previousDir = process.env.GROK_SESSION_DIR;
    const baseDir = fs.mkdtempSync(path.join(tmpRoot, "grok-cli-model-cap-"));

    process.env.XAI_API_KEY = "test-key";
    process.env.GROK_SESSION_DIR = baseDir;

    try {
      const config = getConfig({
        model: "grok-4.20-multi-agent-0309",
        serverTools: [],
        mcpServers: [],
        fileAttachments: [],
      });

      assert.strictEqual(config.useResponsesApi, true);
      assert.strictEqual(config.reasoningEffort, "high");
    } finally {
      if (previousKey === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = previousKey;

      if (previousDir === undefined) delete process.env.GROK_SESSION_DIR;
      else process.env.GROK_SESSION_DIR = previousDir;

      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
