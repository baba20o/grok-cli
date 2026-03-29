#!/usr/bin/env node

import fs from "node:fs";
import { Command } from "commander";
import chalk from "chalk";
import { getConfig, MODELS } from "./config.js";
import { runAgent, runInteractive } from "./agent.js";
import { SessionManager } from "./session.js";
import { createClient } from "./client.js";
import type { GrokConfig, ServerTool, McpServer } from "./types.js";

const VERSION = "0.2.0";

// ─── Pipe Mode: read stdin if piped ──────────────────────────────────────────

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

// ─── Main Program ────────────────────────────────────────────────────────────

const program = new Command()
  .name("grok-cli")
  .description("A coding assistant CLI powered by xAI's Grok models")
  .version(VERSION);

// ─── Default command ─────────────────────────────────────────────────────────

program
  .option("-m, --model <model>", "Model to use", MODELS.default)
  .option("--fast", "Use fast model (grok-4-1-fast-reasoning)")
  .option("--reasoning", "Use flagship reasoning model (grok-4.20-reasoning)")
  .option("--non-reasoning", "Use non-reasoning model")
  .option("--code", "Use grok-code-fast-1 (optimized for coding, 4x faster)")
  .option("--research", "Use multi-agent model for deep research (4-16 agents)")
  .option("-v, --verbose", "Show detailed tool call arguments", false)
  .option("--show-reasoning", "Display model reasoning/thinking tokens", false)
  .option("--show-usage", "Display token usage and cost after each run", false)
  .option("--no-tools", "Disable tool calling (chat only)")
  .option("--no-citations", "Hide citation sources")
  .option("--max-turns <n>", "Maximum agent turns", "50")
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("-r, --resume <id>", "Resume a previous session by ID")
  .option("-n, --name <name>", "Name for this session")
  .option("--responses-api", "Force use of xAI Responses API")
  // Server-side tools
  .option("--web-search", "Enable xAI web search")
  .option("--x-search", "Enable xAI X/Twitter search")
  .option("--code-execution", "Enable xAI Python sandbox")
  // Advanced features
  .option("--mcp <urls...>", "Connect to remote MCP server(s) (url or label=url)")
  .option("--image <paths...>", "Attach image(s) for analysis")
  .option("--attach <files...>", "Upload and attach file(s) for reference")
  .option("--json-schema <schema>", "Force structured JSON output matching schema")
  .argument("[prompt...]", "Prompt to execute (non-interactive mode)")
  .action(async (promptArgs: string[], opts: any) => {
    // Resolve model
    let model = opts.model;
    if (opts.fast) model = MODELS.fast;
    if (opts.reasoning) model = MODELS.reasoning;
    if (opts.nonReasoning) model = MODELS.nonReasoning;
    if (opts.code) model = MODELS.code;
    if (opts.research) model = MODELS.multiAgent;

    // Server-side tools
    const serverTools: ServerTool[] = [];
    if (opts.webSearch) serverTools.push("web_search");
    if (opts.xSearch) serverTools.push("x_search");
    if (opts.codeExecution) serverTools.push("code_execution");
    // Multi-agent auto-enables search tools
    if (opts.research && serverTools.length === 0) {
      serverTools.push("web_search", "x_search");
    }

    // MCP servers
    const mcpServers: McpServer[] = [];
    if (opts.mcp) {
      for (const entry of opts.mcp) {
        if (entry.includes("=")) {
          const [label, url] = entry.split("=", 2);
          mcpServers.push({ label, url });
        } else {
          // Auto-label from hostname
          try {
            const hostname = new URL(entry).hostname.split(".")[0];
            mcpServers.push({ label: hostname, url: entry });
          } catch {
            mcpServers.push({ label: "mcp", url: entry });
          }
        }
      }
    }

    const config: GrokConfig = getConfig({
      model,
      showReasoning: opts.showReasoning,
      showToolCalls: opts.tools !== false,
      showUsage: opts.showUsage,
      showCitations: opts.citations !== false,
      maxToolRounds: parseInt(opts.maxTurns, 10),
      serverTools,
      mcpServers,
      useResponsesApi: opts.responsesApi || serverTools.length > 0 || mcpServers.length > 0,
      imageInputs: opts.image || [],
      fileAttachments: opts.attach || [],
      jsonSchema: opts.jsonSchema || null,
    });

    const agentOpts = {
      verbose: opts.verbose,
      showReasoning: opts.showReasoning,
      maxTurns: parseInt(opts.maxTurns, 10),
      cwd: opts.cwd,
      sessionId: opts.resume || undefined,
      sessionName: opts.name || undefined,
    };

    // Build prompt: from args or pipe
    let prompt = promptArgs.join(" ");

    if (!prompt && !process.stdin.isTTY) {
      // Pipe mode: read from stdin
      const piped = await readStdin();
      if (piped) {
        prompt = piped;
        console.error(chalk.dim(`(piped ${piped.length} chars)`));
      }
    }

    if (prompt) {
      // Exec mode
      const startTime = Date.now();
      try {
        await runAgent(config, prompt, agentOpts);
      } catch (err: any) {
        console.error(chalk.red(`\nFatal: ${err.message}`));
        if (opts.verbose && err.stack) console.error(chalk.dim(err.stack));
        process.exit(1);
      }
      if (opts.verbose) {
        console.error(chalk.dim(`\nCompleted in ${((Date.now() - startTime) / 1000).toFixed(1)}s`));
      }
    } else {
      // Interactive mode
      await runInteractive(config, agentOpts);
    }
  });

// ─── Sessions ────────────────────────────────────────────────────────────────

const sessionsCmd = program.command("sessions").description("Manage conversation sessions");

sessionsCmd
  .command("list").alias("ls")
  .description("List saved sessions")
  .option("--limit <n>", "Number to show", "20")
  .action((opts: any) => {
    const config = getConfig();
    const mgr = new SessionManager(config.sessionDir);
    const sessions = mgr.listSessions();
    if (sessions.length === 0) { console.log(chalk.dim("No sessions.")); return; }
    const limit = parseInt(opts.limit, 10);
    console.log(chalk.bold(`Sessions (${sessions.length}):\n`));
    for (const s of sessions.slice(0, limit)) {
      console.log(
        chalk.cyan(s.id) + "  " + chalk.white(s.name) +
        chalk.dim(`  ${s.turns}t  ${s.model}  ${formatAge(s.updated)}`)
      );
    }
    if (sessions.length > limit) console.log(chalk.dim(`\n... +${sessions.length - limit} more`));
    console.log(chalk.dim("\ngrok-cli -r <id> \"prompt\""));
  });

sessionsCmd
  .command("show <id>").description("Show session details")
  .action((id: string) => {
    const config = getConfig();
    const mgr = new SessionManager(config.sessionDir);
    const s = mgr.loadSession(id);
    if (!s) { console.error(chalk.red(`Not found: ${id}`)); process.exit(1); }
    console.log(chalk.bold("Session: ") + chalk.cyan(s.meta.id));
    console.log(chalk.bold("Name:    ") + s.meta.name);
    console.log(chalk.bold("Model:   ") + s.meta.model);
    console.log(chalk.bold("CWD:     ") + s.meta.cwd);
    console.log(chalk.bold("Turns:   ") + s.meta.turns);
    console.log(chalk.bold("Updated: ") + s.meta.updated);
    if (s.meta.lastResponseId) console.log(chalk.bold("Resp ID: ") + chalk.dim(s.meta.lastResponseId));
    console.log("");
    for (const msg of s.messages) {
      const role = (msg as any).role;
      const content = typeof (msg as any).content === "string" ? (msg as any).content : null;
      const tc = (msg as any).tool_calls;
      switch (role) {
        case "system": console.log(chalk.dim("  [system] ") + chalk.dim(trunc(content || "", 80))); break;
        case "user": console.log(chalk.blue("  [user] ") + trunc(content || "", 120)); break;
        case "assistant":
          if (tc?.length > 0) {
            console.log(chalk.green("  [assistant] ") + chalk.dim(`calls: ${tc.map((t: any) => t.function?.name).join(", ")}`));
          } else {
            console.log(chalk.green("  [assistant] ") + trunc(content || "", 120));
          }
          break;
        case "tool": console.log(chalk.yellow("  [tool] ") + chalk.dim(trunc(content || "", 80))); break;
      }
    }
  });

sessionsCmd.command("delete <id>").alias("rm").description("Delete a session")
  .action((id: string) => {
    const config = getConfig();
    const mgr = new SessionManager(config.sessionDir);
    if (mgr.deleteSession(id)) console.log(chalk.green(`Deleted: ${id}`));
    else { console.error(chalk.red(`Not found: ${id}`)); process.exit(1); }
  });

sessionsCmd.command("clear").description("Delete all sessions")
  .action(() => {
    const config = getConfig();
    const mgr = new SessionManager(config.sessionDir);
    console.log(chalk.green(`Cleared ${mgr.clearSessions()} session(s).`));
  });

// ─── Image Generation ────────────────────────────────────────────────────────

program
  .command("generate-image")
  .alias("imagine")
  .description("Generate an image from a text prompt")
  .argument("<prompt...>", "Image description prompt")
  .option("--pro", "Use grok-imagine-image-pro (higher quality, $0.07)")
  .option("-n, --count <n>", "Number of images", "1")
  .action(async (promptArgs: string[], opts: any) => {
    const config = getConfig();
    const client = createClient(config);
    const prompt = promptArgs.join(" ");
    const model = opts.pro ? "grok-imagine-image-pro" : "grok-imagine-image";
    const n = parseInt(opts.count, 10);

    console.error(chalk.dim(`Generating ${n} image(s) with ${model}...`));

    try {
      const response = await client.images.generate({
        model,
        prompt,
        n,
      });

      const data = response.data || [];
      for (let i = 0; i < data.length; i++) {
        const img = data[i];
        const url = img.url || img.b64_json;
        if (url) {
          console.log(url);
        }
      }

      const cost = opts.pro ? 0.07 * n : 0.02 * n;
      console.error(chalk.dim(`Cost: $${cost.toFixed(2)}`));
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

// ─── Parse ───────────────────────────────────────────────────────────────────

program.parse();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function trunc(s: string, max: number): string {
  const line = s.replace(/\n/g, " ").trim();
  return line.length <= max ? line : line.slice(0, max - 3) + "...";
}

function formatAge(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  return days < 30 ? `${days}d` : `${Math.floor(days / 30)}mo`;
}
