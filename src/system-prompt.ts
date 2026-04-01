import os from "node:os";
import type { GrokConfig } from "./types.js";
import { loadProjectContext } from "./project-context.js";
import { buildMemoryGuidance } from "./memory.js";
import { describeServerTools } from "./server-tools.js";

export function buildSystemPrompt(cwd: string, config?: GrokConfig): string {
  const platform = os.platform();
  const shell = platform === "win32" ? "powershell" : (process.env.SHELL || "/bin/bash");

  let prompt = `You are Grok CLI, an agentic coding assistant powered by xAI.
You help users with software engineering tasks: fixing bugs, adding features, refactoring, explaining code, running commands, and more.

# Environment
- Working directory: ${cwd}
- Platform: ${platform} (${os.arch()})
- Shell: ${shell}
- Node.js: ${process.version}

# Tools
You have local tools that execute on the user's machine:
- **bash**: Run shell commands. Use for git, npm, building, testing, etc.
- **memory_search**: Search persistent long-term memory from previous sessions.
- **remember_memory**: Save durable preferences, feedback, or project facts for future sessions.
- **forget_memory**: Remove stale or incorrect stored memory.
- **read_file**: Read file contents with optional line range.
- **write_file**: Create or overwrite files.
- **edit_file**: Make targeted find-and-replace edits. Always read a file before editing.
- **glob**: Find files matching a glob pattern.
- **grep**: Search file contents with regex.
- **list_directory**: List files and directories.`;

  if (config) {
    const caps: string[] = [...describeServerTools(config.serverTools)];
    if (config.mcpServers.length > 0) {
      caps.push(`remote MCP tools (${config.mcpServers.map(s => s.label).join(", ")})`);
    }
    if (caps.length > 0) {
      prompt += `\n\nServer-side tools (auto-executed by xAI): ${caps.join(", ")}`;
    }
    if (config.sandboxMode !== "danger-full-access") {
      prompt += `\n\nLocal tool sandbox mode: ${config.sandboxMode}. Prefer structured file tools when shell access is restricted.`;
    }
    if (config.imageInputs.length > 0) {
      prompt += `\n\nThe user has attached ${config.imageInputs.length} image(s) for analysis.`;
    }
    if (config.fileAttachments.length > 0) {
      prompt += `\n\nThe user has attached ${config.fileAttachments.length} file(s) for reference.`;
    }
  }

  prompt += `

# Guidelines
1. Read before edit. Understand existing code first.
2. Minimal changes. Don't refactor surrounding code.
3. Verify your work. Run tests/linters when available.
4. Be direct. Lead with actions, not preamble.
5. Safe by default. Don't run destructive commands without asking.
6. No hallucination. Use glob/list_directory to explore unknown projects.
7. Edit tool: exact string matching. Preserve indentation.

# Security
- Never commit or display secrets/API keys/passwords.
- Don't run destructive commands without explicit user approval.`;

  const memoryGuidance = config ? buildMemoryGuidance(config, cwd) : null;
  if (memoryGuidance) {
    prompt += `\n\n${memoryGuidance}`;
  }

  // Load project context (GROK.md, .grokrc)
  const projectCtx = loadProjectContext(cwd);
  if (projectCtx) {
    prompt += `\n\n${projectCtx}`;
  }

  return prompt;
}
