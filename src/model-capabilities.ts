import type { ReasoningEffort } from "./types.js";

export function isMultiAgentModel(model: string | null | undefined): boolean {
  const normalized = (model || "").toLowerCase();
  return normalized.includes("grok-4.20-multi-agent");
}

export function supportsClientTools(model: string | null | undefined): boolean {
  return !isMultiAgentModel(model);
}

export function supportsChatCompletions(model: string | null | undefined): boolean {
  return !isMultiAgentModel(model);
}

export function normalizeReasoningEffort(
  value: string | null | undefined,
  fallback: ReasoningEffort = "high",
): ReasoningEffort {
  switch ((value || "").toLowerCase()) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
      return "xhigh";
    default:
      return fallback;
  }
}

export function reasoningEffortFromResearchDepth(
  value: string | null | undefined,
): ReasoningEffort | null {
  switch ((value || "").toLowerCase()) {
    case "quick":
      return "low";
    case "balanced":
    case "standard":
      return "medium";
    case "deep":
      return "high";
    case "max":
    case "maximum":
      return "xhigh";
    default:
      return null;
  }
}

export function reasoningEffortFromAgentCount(
  value: string | number | null | undefined,
): ReasoningEffort | null {
  const normalized = String(value ?? "").trim();
  if (normalized === "4") return "medium";
  if (normalized === "16") return "high";
  return null;
}
