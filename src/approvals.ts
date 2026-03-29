import readline from "node:readline";
import chalk from "chalk";

export type ApprovalPolicy = "always-approve" | "ask" | "deny-writes";

// Cache approvals within a session
const approvalCache = new Map<string, boolean>();

const ALWAYS_SAFE = new Set(["read_file", "glob", "grep", "list_directory"]);
const WRITE_TOOLS = new Set(["write_file", "edit_file"]);
const EXEC_TOOLS = new Set(["bash"]);

function cacheKey(tool: string, args: string): string {
  if (tool === "bash") {
    // Cache by command prefix (first word)
    try {
      const cmd = JSON.parse(args)?.command?.split(" ")[0] || "";
      return `bash:${cmd}`;
    } catch { return `bash:?`; }
  }
  if (tool === "write_file" || tool === "edit_file") {
    try { return `${tool}:${JSON.parse(args)?.file_path}`; } catch { return `${tool}:?`; }
  }
  return tool;
}

export async function checkApproval(
  policy: ApprovalPolicy,
  toolName: string,
  argsJson: string,
): Promise<boolean> {
  // Always-safe tools never need approval
  if (ALWAYS_SAFE.has(toolName)) return true;

  // Always-approve policy skips prompts
  if (policy === "always-approve") return true;

  // Deny-writes blocks write/exec tools entirely
  if (policy === "deny-writes") {
    if (WRITE_TOOLS.has(toolName) || EXEC_TOOLS.has(toolName)) {
      console.error(chalk.red(`  ✗ Blocked by deny-writes policy: ${toolName}`));
      return false;
    }
    return true;
  }

  // "ask" policy — check cache first
  const key = cacheKey(toolName, argsJson);
  if (approvalCache.has(key)) return approvalCache.get(key)!;

  // Show what's about to happen
  let summary = toolName;
  try {
    const args = JSON.parse(argsJson);
    if (toolName === "bash") summary = `bash: ${args.command}`;
    else if (toolName === "write_file") summary = `write: ${args.file_path}`;
    else if (toolName === "edit_file") summary = `edit: ${args.file_path}`;
  } catch {}

  // Prompt user
  const answer = await promptUser(
    chalk.yellow(`  ⚠ Approve ${summary}? `) + chalk.dim("[y]es / [n]o / [a]lways: ")
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
