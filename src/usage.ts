import chalk from "chalk";

// Pricing per 1M tokens (input / cached / output)
const PRICING: Record<string, { input: number; cached: number; output: number }> = {
  "grok-4.20-0309-reasoning":       { input: 2.00, cached: 0.20, output: 6.00 },
  "grok-4.20-reasoning":            { input: 2.00, cached: 0.20, output: 6.00 },
  "grok-4.20-0309-non-reasoning":   { input: 2.00, cached: 0.20, output: 6.00 },
  "grok-4.20-non-reasoning":        { input: 2.00, cached: 0.20, output: 6.00 },
  "grok-4.20-multi-agent-0309":     { input: 2.00, cached: 0.20, output: 6.00 },
  "grok-4.20-multi-agent":          { input: 2.00, cached: 0.20, output: 6.00 },
  "grok-4-1-fast-reasoning":        { input: 0.20, cached: 0.05, output: 0.50 },
  "grok-4-1-fast-non-reasoning":    { input: 0.20, cached: 0.05, output: 0.50 },
  "grok-code-fast-1":               { input: 0.20, cached: 0.05, output: 0.50 },
};

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

export function createUsageStats(): UsageStats {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
  };
}

/** Extract usage from a chat.completions final chunk */
export function extractUsageFromChatChunk(chunk: any, stats: UsageStats): void {
  const usage = chunk?.usage;
  if (!usage) return;

  stats.inputTokens = usage.prompt_tokens || 0;
  stats.outputTokens = usage.completion_tokens || 0;
  stats.totalTokens = usage.total_tokens || 0;
  stats.cachedTokens = usage.prompt_tokens_details?.cached_tokens || 0;
}

/** Extract usage from a Responses API response */
export function extractUsageFromResponse(response: any, stats: UsageStats): void {
  const usage = response?.usage;
  if (!usage) return;

  stats.inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
  stats.outputTokens = usage.output_tokens || usage.completion_tokens || 0;
  stats.totalTokens = usage.total_tokens || (stats.inputTokens + stats.outputTokens);
  stats.reasoningTokens = usage.output_tokens_details?.reasoning_tokens || 0;
  stats.cachedTokens = usage.input_tokens_details?.cached_tokens || usage.prompt_tokens_details?.cached_tokens || 0;
}

/** Accumulate usage across multiple turns */
export function accumulateUsage(total: UsageStats, turn: UsageStats): void {
  total.inputTokens += turn.inputTokens;
  total.outputTokens += turn.outputTokens;
  total.reasoningTokens += turn.reasoningTokens;
  total.cachedTokens += turn.cachedTokens;
  total.totalTokens += turn.totalTokens;
}

export function calculateCost(model: string, stats: UsageStats): number {
  // Find pricing - try exact match, then prefix match
  let pricing = PRICING[model];
  if (!pricing) {
    const key = Object.keys(PRICING).find(k => model.startsWith(k));
    pricing = key ? PRICING[key] : PRICING["grok-4-1-fast-reasoning"]; // fallback
  }

  const nonCachedInput = stats.inputTokens - stats.cachedTokens;
  const costInput = (nonCachedInput / 1_000_000) * pricing.input;
  const costCached = (stats.cachedTokens / 1_000_000) * pricing.cached;
  const costOutput = (stats.outputTokens / 1_000_000) * pricing.output;

  return costInput + costCached + costOutput;
}

export function formatUsage(model: string, stats: UsageStats): string {
  const cost = calculateCost(model, stats);
  const parts: string[] = [];

  parts.push(chalk.dim("Tokens:"));
  parts.push(chalk.dim(` in=${stats.inputTokens.toLocaleString()}`));
  if (stats.cachedTokens > 0) {
    parts.push(chalk.dim(` cached=${stats.cachedTokens.toLocaleString()}`));
  }
  parts.push(chalk.dim(` out=${stats.outputTokens.toLocaleString()}`));
  if (stats.reasoningTokens > 0) {
    parts.push(chalk.dim(` reasoning=${stats.reasoningTokens.toLocaleString()}`));
  }
  parts.push(chalk.dim(` | Cost: $${cost.toFixed(4)}`));

  return parts.join("");
}
