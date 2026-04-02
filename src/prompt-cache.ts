import type { GrokConfig } from "./types.js";

function normalizeConvId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function getPromptCacheKey(
  config: Pick<GrokConfig, "convId">,
  conversationId?: string | null,
): string | null {
  const explicit = normalizeConvId(config.convId);
  if (explicit) return explicit;

  const normalizedConversationId = normalizeConvId(conversationId);
  if (!normalizedConversationId) return null;

  return `grok-agent:${normalizedConversationId}`;
}

export function withPromptCacheKey(
  config: GrokConfig,
  conversationId?: string | null,
): GrokConfig {
  const promptCacheKey = getPromptCacheKey(config, conversationId);
  if (!promptCacheKey || promptCacheKey === config.convId) return config;
  return { ...config, convId: promptCacheKey };
}
