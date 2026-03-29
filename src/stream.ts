import chalk from "chalk";

export interface StreamAccumulator {
  content: string;
  reasoningContent: string;
  toolCalls: AccumulatedToolCall[];
  finishReason: string | null;
}

export interface AccumulatedToolCall {
  index: number;
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export function createAccumulator(): StreamAccumulator {
  return {
    content: "",
    reasoningContent: "",
    toolCalls: [],
    finishReason: null,
  };
}

export function processChunk(
  acc: StreamAccumulator,
  chunk: any,
  options: { showReasoning: boolean; showOutput: boolean },
): void {
  const choice = chunk.choices?.[0];
  if (!choice) return;

  const delta = choice.delta;
  if (!delta) return;

  // Handle reasoning content (thinking tokens)
  if (delta.reasoning_content) {
    acc.reasoningContent += delta.reasoning_content;
    if (options.showReasoning) {
      process.stderr.write(chalk.dim(delta.reasoning_content));
    }
  }

  // Handle regular content
  if (delta.content) {
    acc.content += delta.content;
    if (options.showOutput) {
      process.stdout.write(delta.content);
    }
  }

  // Handle tool calls (accumulated across chunks)
  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index;
      if (!acc.toolCalls[idx]) {
        acc.toolCalls[idx] = {
          index: idx,
          id: tc.id || "",
          function: { name: "", arguments: "" },
        };
      }
      if (tc.id) acc.toolCalls[idx].id = tc.id;
      if (tc.function?.name) acc.toolCalls[idx].function.name += tc.function.name;
      if (tc.function?.arguments) acc.toolCalls[idx].function.arguments += tc.function.arguments;
    }
  }

  // Capture finish reason
  if (choice.finish_reason) {
    acc.finishReason = choice.finish_reason;
  }
}

export function formatToolCall(name: string, args: string, verbose: boolean): string {
  if (!verbose) {
    return chalk.cyan(`  ► ${name}`);
  }
  try {
    const parsed = JSON.parse(args);
    const summary = formatToolArgs(name, parsed);
    return chalk.cyan(`  ► ${name}`) + chalk.dim(` ${summary}`);
  } catch {
    return chalk.cyan(`  ► ${name}`);
  }
}

function formatToolArgs(name: string, args: Record<string, any>): string {
  switch (name) {
    case "bash":
      return `$ ${truncate(args.command, 80)}`;
    case "read_file":
      return args.file_path;
    case "write_file":
      return args.file_path;
    case "edit_file":
      return args.file_path;
    case "glob":
      return args.pattern;
    case "grep":
      return `/${args.pattern}/ ${args.include || ""}`.trim();
    case "list_directory":
      return args.path || ".";
    default:
      return JSON.stringify(args).slice(0, 80);
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

export function formatToolResult(output: string, isError: boolean): string {
  const lines = output.split("\n");
  if (lines.length <= 5) {
    const prefix = isError ? chalk.red("    ✗ ") : chalk.green("    ✓ ");
    return prefix + chalk.dim(lines.join("\n      "));
  }
  const prefix = isError ? chalk.red("    ✗ ") : chalk.green("    ✓ ");
  return prefix + chalk.dim(`${lines[0]}\n      ... (${lines.length} lines)`);
}
