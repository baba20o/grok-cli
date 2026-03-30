import readline from "node:readline";
import chalk from "chalk";
import type { ApprovalPolicy, GrokConfig, ToolApprovalMode } from "./types.js";

const approvalCache = new Map<string, boolean>();

const ALWAYS_SAFE = new Set(["read_file", "glob", "grep", "list_directory"]);
const WRITE_TOOLS = new Set(["write_file", "edit_file"]);
const EXEC_TOOLS = new Set(["bash"]);

function cacheKey(tool: string, args: string): string {
  if (tool === "bash") {
    try {
      const cmd = JSON.parse(args)?.command?.split(" ")[0] || "";
      return `bash:${cmd}`;
    } catch {
      return "bash:?";
    }
  }
  if (tool === "write_file" || tool === "edit_file") {
    try {
      return `${tool}:${JSON.parse(args)?.file_path}`;
    } catch {
      return `${tool}:?`;
    }
  }
  return tool;
}

function resolveToolApprovalMode(config: Pick<GrokConfig, "approvalPolicy" | "toolApprovals">, toolName: string): ApprovalPolicy | ToolApprovalMode {
  const override = config.toolApprovals.tools?.[toolName];
  if (override) return override;
  return config.toolApprovals.defaultMode || config.approvalPolicy;
}

export async function checkApproval(
  config: Pick<GrokConfig, "approvalPolicy" | "toolApprovals">,
  toolName: string,
  argsJson: string,
): Promise<boolean> {
  if (ALWAYS_SAFE.has(toolName)) return true;

  const mode = resolveToolApprovalMode(config, toolName);
  if (mode === "allow" || mode === "always-approve") return true;
  if (mode === "deny") {
    console.error(chalk.red(`  ✗ Blocked by tool approval override: ${toolName}`));
    return false;
  }

  if (mode === "deny-writes") {
    if (WRITE_TOOLS.has(toolName) || EXEC_TOOLS.has(toolName)) {
      console.error(chalk.red(`  ✗ Blocked by deny-writes policy: ${toolName}`));
      return false;
    }
    return true;
  }

  const key = cacheKey(toolName, argsJson);
  if (approvalCache.has(key)) return approvalCache.get(key)!;

  let summary = toolName;
  try {
    const args = JSON.parse(argsJson);
    if (toolName === "bash") summary = `bash: ${args.command}`;
    else if (toolName === "write_file") summary = `write: ${args.file_path}`;
    else if (toolName === "edit_file") summary = `edit: ${args.file_path}`;
  } catch {
    // Ignore parse errors in prompt summary.
  }

  const answer = await promptUser(
    chalk.yellow(`  ⚠ Approve ${summary}? `) + chalk.dim("[y]es / [n]o / [a]lways: "),
  );

  const choice = answer.toLowerCase().trim();
  if (choice === "a" || choice === "always") {
    approvalCache.set(key, true);
    return true;
  }
  if (choice === "y" || choice === "yes" || choice === "") {
    return true;
  }

  approvalCache.set(key, false);
  return false;
}

function promptUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export function clearApprovalCache(): void {
  approvalCache.clear();
}
