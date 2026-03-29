import chalk from "chalk";
import { createClient } from "./client.js";
import { approxTokenCountFromChars } from "./truncation.js";
import type { GrokConfig, ChatMessage } from "./types.js";

// Auto-compact when conversation exceeds this many estimated tokens
const DEFAULT_COMPACT_THRESHOLD = 100_000; // ~100k tokens

/**
 * Check if conversation needs compaction based on estimated token count.
 */
export function needsCompaction(
  messages: ChatMessage[],
  threshold: number = DEFAULT_COMPACT_THRESHOLD,
): boolean {
  let totalChars = 0;
  for (const msg of messages) {
    const content = (msg as any).content;
    if (typeof content === "string") {
      totalChars += content.length;
    } else if (content != null) {
      totalChars += JSON.stringify(content).length;
    }
    // Tool calls add tokens too
    const tc = (msg as any).tool_calls;
    if (tc) totalChars += JSON.stringify(tc).length;
  }
  return approxTokenCountFromChars(totalChars) > threshold;
}

/**
 * Compact a conversation by summarizing older messages.
 * Keeps the system prompt and recent messages, summarizes the middle.
 */
export async function compactConversation(
  config: GrokConfig,
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  if (messages.length < 6) return messages; // Too short to compact

  console.error(chalk.dim("  Compacting conversation history..."));

  const client = createClient(config);

  // Keep system prompt (first message) and last 4 messages
  const systemMsg = messages[0];
  const recentMessages = messages.slice(-4);
  const middleMessages = messages.slice(1, -4);

  // Build summary of middle messages
  const summaryParts: string[] = [];
  for (const msg of middleMessages) {
    const role = (msg as any).role;
    const content = typeof (msg as any).content === "string" ? (msg as any).content : null;
    const tc = (msg as any).tool_calls;

    if (role === "user" && content) {
      summaryParts.push(`User: ${content.slice(0, 200)}`);
    } else if (role === "assistant" && content) {
      summaryParts.push(`Assistant: ${content.slice(0, 200)}`);
    } else if (role === "assistant" && tc) {
      const names = tc.map((t: any) => t.function?.name).filter(Boolean).join(", ");
      summaryParts.push(`Assistant called: ${names}`);
    } else if (role === "tool" && content) {
      summaryParts.push(`Tool result: ${content.slice(0, 100)}`);
    }
  }

  const historyText = summaryParts.join("\n");

  try {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: "system",
          content: "Summarize this conversation history into a concise handoff summary. Include: key decisions made, important context, what remains to be done. Be brief but comprehensive.",
        },
        {
          role: "user",
          content: `Summarize this conversation history:\n\n${historyText}`,
        },
      ],
      max_tokens: 1000,
      temperature: 0,
    });

    const summary = response.choices[0]?.message?.content || "Previous conversation context.";

    console.error(chalk.dim(`  Compacted ${middleMessages.length} messages → summary`));

    // Rebuild messages: system + summary + recent
    return [
      systemMsg,
      {
        role: "user",
        content: `[CONVERSATION SUMMARY - A previous assistant worked on this task. Here is a summary of what happened:]\n\n${summary}\n\n[END SUMMARY - Continue from where the previous assistant left off.]`,
      },
      ...recentMessages,
    ];
  } catch (err: any) {
    console.error(chalk.dim(`  Compaction failed: ${err.message}. Trimming instead.`));
    // Fallback: just keep system + recent messages
    return [systemMsg, ...messages.slice(-8)];
  }
}
