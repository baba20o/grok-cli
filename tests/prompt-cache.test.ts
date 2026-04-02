import assert from "node:assert";
import { afterEach, describe, it } from "node:test";
import { getConfig } from "../src/config.js";
import { getPromptCacheKey, withPromptCacheKey } from "../src/prompt-cache.js";

const ORIGINAL_ENV = {
  XAI_API_KEY: process.env.XAI_API_KEY,
  GROK_CONV_ID: process.env.GROK_CONV_ID,
};

afterEach(() => {
  if (ORIGINAL_ENV.XAI_API_KEY === undefined) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = ORIGINAL_ENV.XAI_API_KEY;

  if (ORIGINAL_ENV.GROK_CONV_ID === undefined) delete process.env.GROK_CONV_ID;
  else process.env.GROK_CONV_ID = ORIGINAL_ENV.GROK_CONV_ID;
});

describe("prompt cache routing", () => {
  it("derives a stable cache key from the session id when none is provided", () => {
    assert.equal(getPromptCacheKey({ convId: null }, "session-123"), "grok-agent:session-123");
  });

  it("preserves an explicit cache key", () => {
    assert.equal(getPromptCacheKey({ convId: "shared-cache" }, "session-123"), "shared-cache");
    const config = withPromptCacheKey({
      apiKey: "test",
      managementApiKey: "",
      baseUrl: "https://api.x.ai/v1",
      managementBaseUrl: "https://management-api.x.ai/v1",
      model: "grok-4.20-0309-reasoning",
      maxTokens: 1024,
      timeout: 1000,
      reasoningEffort: "high",
      showReasoning: false,
      showToolCalls: true,
      showUsage: false,
      showCitations: true,
      showDiffs: true,
      showServerToolUsage: false,
      maxToolRounds: 3,
      serverTools: [],
      useResponsesApi: false,
      sessionDir: ".tmp",
      mcpServers: [],
      imageInputs: [],
      fileAttachments: [],
      jsonSchema: null,
      approvalPolicy: "always-approve",
      sandboxMode: "danger-full-access",
      toolApprovals: { tools: {} },
      includeToolOutputs: false,
      notify: false,
      hooks: {},
      convId: "shared-cache",
      jsonOutput: false,
      ephemeral: true,
      outputFile: null,
      color: "never",
      maxOutputTokens: 1000,
      researchVerboseStreaming: false,
      useEncryptedContent: false,
      memory: {
        enabled: false,
        autoRecall: false,
        useSemanticRecall: false,
        recallLimit: 0,
        selectorModel: "grok-4-1-fast-reasoning",
        defaultScope: "project",
      },
    }, "session-123");
    assert.equal(config.convId, "shared-cache");
  });

  it("loads a manual cache key from GROK_CONV_ID", () => {
    process.env.XAI_API_KEY = "test-key";
    process.env.GROK_CONV_ID = "conv-from-env";
    const config = getConfig({ jsonOutput: false });
    assert.equal(config.convId, "conv-from-env");
  });
});
