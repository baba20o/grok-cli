#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { getConfig, MODELS } from "./config.js";
import { runAgent, runInteractive } from "./agent.js";
import { SessionManager } from "./session.js";
import { createClient } from "./client.js";
import { setShowDiffs } from "./tools/edit-file.js";
import type { GrokConfig, ServerTool, McpServer } from "./types.js";

const VERSION = "0.3.0";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8").trim();
}

const program = new Command()
  .name("grok-cli")
  .description("A coding assistant CLI powered by xAI's Grok models")
  .version(VERSION);

// ─── Default command ─────────────────────────────────────────────────────────

program
  .option("-m, --model <model>", "Model to use", MODELS.default)
  .option("--fast", "grok-4-1-fast-reasoning")
  .option("--reasoning", "grok-4.20-reasoning (flagship)")
  .option("--non-reasoning", "grok-4.20-non-reasoning")
  .option("--code", "grok-code-fast-1 (4x faster coding model)")
  .option("--research", "Multi-agent deep research (4-16 agents)")
  .option("-v, --verbose", "Detailed tool call output", false)
  .option("--show-reasoning", "Show thinking tokens", false)
  .option("--show-usage", "Show token usage and cost", false)
  .option("--show-diffs", "Show diffs on file edits (default: true)")
  .option("--no-diffs", "Hide file edit diffs")
  .option("--no-tools", "Chat only")
  .option("--no-citations", "Hide sources")
  .option("--max-turns <n>", "Max agent turns", "50")
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("-r, --resume <id>", "Resume session")
  .option("--fork <id>", "Fork a session (copy history, new session)")
  .option("-n, --name <name>", "Name this session")
  .option("--plan", "Plan mode: create a plan first, then execute")
  .option("--approve", "Ask before writes/exec (default: always-approve)")
  .option("--deny-writes", "Block all file writes and shell commands")
  .option("--notify", "Desktop notification on completion")
  .option("--responses-api", "Force Responses API")
  .option("--web-search", "Enable web search")
  .option("--x-search", "Enable X/Twitter search")
  .option("--code-execution", "Enable Python sandbox")
  .option("--mcp <urls...>", "Connect to MCP server(s)")
  .option("--image <paths...>", "Attach image(s)")
  .option("--attach <files...>", "Upload file(s)")
  .option("--json-schema <schema>", "Force structured JSON output")
  .option("--defer", "Use deferred completion (fire-and-forget)")
  .argument("[prompt...]", "Prompt (non-interactive)")
  .action(async (promptArgs: string[], opts: any) => {
    let model = opts.model;
    if (opts.fast) model = MODELS.fast;
    if (opts.reasoning) model = MODELS.reasoning;
    if (opts.nonReasoning) model = MODELS.nonReasoning;
    if (opts.code) model = MODELS.code;
    if (opts.research) model = MODELS.multiAgent;

    const serverTools: ServerTool[] = [];
    if (opts.webSearch) serverTools.push("web_search");
    if (opts.xSearch) serverTools.push("x_search");
    if (opts.codeExecution) serverTools.push("code_execution");
    if (opts.research && serverTools.length === 0) serverTools.push("web_search", "x_search");

    const mcpServers: McpServer[] = [];
    if (opts.mcp) {
      for (const entry of opts.mcp) {
        if (entry.includes("=")) {
          const [label, url] = entry.split("=", 2);
          mcpServers.push({ label, url });
        } else {
          try {
            const hostname = new URL(entry).hostname.split(".")[0];
            mcpServers.push({ label: hostname, url: entry });
          } catch { mcpServers.push({ label: "mcp", url: entry }); }
        }
      }
    }

    let approvalPolicy: any = "always-approve";
    if (opts.approve) approvalPolicy = "ask";
    if (opts.denyWrites) approvalPolicy = "deny-writes";

    const config: GrokConfig = getConfig({
      model,
      showReasoning: opts.showReasoning,
      showToolCalls: opts.tools !== false,
      showUsage: opts.showUsage,
      showCitations: opts.citations !== false,
      showDiffs: opts.diffs !== false,
      maxToolRounds: parseInt(opts.maxTurns, 10),
      serverTools,
      mcpServers,
      useResponsesApi: opts.responsesApi || serverTools.length > 0 || mcpServers.length > 0,
      imageInputs: opts.image || [],
      fileAttachments: opts.attach || [],
      jsonSchema: opts.jsonSchema || null,
      approvalPolicy,
      notify: opts.notify || false,
      hooks: {},
    });

    setShowDiffs(config.showDiffs);

    // Session fork: copy history to new session
    let sessionId = opts.resume || undefined;
    if (opts.fork) {
      const mgr = new SessionManager(config.sessionDir);
      const source = mgr.loadSession(opts.fork);
      if (source) {
        const newMeta = mgr.createSession({ model: config.model, cwd: opts.cwd, name: `Fork of ${source.meta.name}` });
        // Copy messages
        for (const msg of source.messages) {
          const role = (msg as any).role;
          const content = (msg as any).content;
          mgr.appendMessage(newMeta.id, role, typeof content === "string" ? content : null);
        }
        sessionId = newMeta.id;
        console.error(chalk.dim(`Forked session ${opts.fork} → ${newMeta.id}`));
      } else {
        console.error(chalk.red(`Session not found: ${opts.fork}`));
        process.exit(1);
      }
    }

    const agentOpts = {
      verbose: opts.verbose,
      showReasoning: opts.showReasoning,
      maxTurns: parseInt(opts.maxTurns, 10),
      cwd: opts.cwd,
      sessionId,
      sessionName: opts.name,
      planMode: opts.plan || false,
    };

    // Build prompt from args or pipe
    let prompt = promptArgs.join(" ");
    if (!prompt && !process.stdin.isTTY) {
      const piped = await readStdin();
      if (piped) { prompt = piped; console.error(chalk.dim(`(piped ${piped.length} chars)`)); }
    }

    // Deferred mode
    if (opts.defer && prompt) {
      try {
        const client = createClient(config);
        const { buildSystemPrompt } = await import("./system-prompt.js");
        const resp = await (client as any).chat.completions.create({
          model: config.model,
          messages: [
            { role: "system", content: buildSystemPrompt(opts.cwd, config) },
            { role: "user", content: prompt },
          ],
          deferred: true,
        });
        console.log(chalk.cyan(`Deferred request ID: ${resp.request_id}`));
        console.log(chalk.dim(`Poll: curl -H "Authorization: Bearer $XAI_API_KEY" https://api.x.ai/v1/chat/deferred-completion/${resp.request_id}`));
        return;
      } catch (err: any) {
        console.error(chalk.red(`Deferred error: ${err.message}`));
        process.exit(1);
      }
    }

    // Plan mode: prepend planning instruction
    if (opts.plan && prompt) {
      prompt = `PLAN MODE: First, create a detailed step-by-step plan for the following task. List each step with what you'll do and why. After presenting the plan, proceed to execute it step by step.\n\nTask: ${prompt}`;
    }

    if (prompt) {
      const startTime = Date.now();
      try {
        await runAgent(config, prompt, agentOpts);
      } catch (err: any) {
        console.error(chalk.red(`\nFatal: ${err.message}`));
        if (opts.verbose && err.stack) console.error(chalk.dim(err.stack));
        process.exit(1);
      }
      if (opts.verbose) {
        console.error(chalk.dim(`\n${((Date.now() - startTime) / 1000).toFixed(1)}s`));
      }
      // Notification
      if (config.notify) {
        const { notify } = await import("./notifications.js");
        notify("grok-cli", "Task completed");
      }
    } else {
      await runInteractive(config, agentOpts);
    }
  });

// ─── Models ──────────────────────────────────────────────────────────────────

const modelsCmd = program.command("models").description("List and inspect available models");

modelsCmd
  .command("list").alias("ls").description("List all available models")
  .action(async () => {
    const config = getConfig();
    const client = createClient(config);
    try {
      const response = await client.models.list();
      const models: any[] = [];
      for await (const model of response) models.push(model);

      models.sort((a, b) => a.id.localeCompare(b.id));

      console.log(chalk.bold(`Available models (${models.length}):\n`));
      for (const m of models) {
        console.log(chalk.cyan(m.id) + chalk.dim(`  owner=${m.owned_by || "xai"}`));
      }
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    }
  });

modelsCmd
  .command("info <model>").description("Show details about a model")
  .action(async (modelId: string) => {
    const config = getConfig();
    const client = createClient(config);
    try {
      const model = await client.models.retrieve(modelId);
      console.log(chalk.bold("Model: ") + chalk.cyan(model.id));
      console.log(chalk.bold("Owner: ") + (model.owned_by || "xai"));
      console.log(chalk.bold("Created: ") + new Date((model.created || 0) * 1000).toISOString());
      console.log(chalk.bold("Object: ") + model.object);
    } catch (err: any) {
      console.error(chalk.red(`Model not found: ${modelId}`));
    }
  });

// Shortcut: `grok-cli models` without subcommand lists models
modelsCmd.action(async () => {
  const config = getConfig();
  const client = createClient(config);
  try {
    const response = await client.models.list();
    const models: any[] = [];
    for await (const model of response) models.push(model);
    models.sort((a, b) => a.id.localeCompare(b.id));
    console.log(chalk.bold(`Available models (${models.length}):\n`));
    for (const m of models) {
      console.log(chalk.cyan(m.id) + chalk.dim(`  owner=${m.owned_by || "xai"}`));
    }
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
  }
});

// ─── Sessions ────────────────────────────────────────────────────────────────

const sessionsCmd = program.command("sessions").description("Manage sessions");

sessionsCmd.command("list").alias("ls").description("List sessions")
  .option("--limit <n>", "Max to show", "20")
  .action((opts: any) => {
    const config = getConfig();
    const mgr = new SessionManager(config.sessionDir);
    const sessions = mgr.listSessions();
    if (sessions.length === 0) { console.log(chalk.dim("No sessions.")); return; }
    const limit = parseInt(opts.limit, 10);
    console.log(chalk.bold(`Sessions (${sessions.length}):\n`));
    for (const s of sessions.slice(0, limit)) {
      console.log(chalk.cyan(s.id) + "  " + chalk.white(s.name) + chalk.dim(`  ${s.turns}t  ${s.model}  ${fmtAge(s.updated)}`));
    }
    if (sessions.length > limit) console.log(chalk.dim(`\n+${sessions.length - limit} more`));
  });

sessionsCmd.command("show <id>").description("Show session")
  .action((id: string) => {
    const config = getConfig();
    const mgr = new SessionManager(config.sessionDir);
    const s = mgr.loadSession(id);
    if (!s) { console.error(chalk.red(`Not found: ${id}`)); process.exit(1); }
    console.log(chalk.bold("ID:      ") + chalk.cyan(s.meta.id));
    console.log(chalk.bold("Name:    ") + s.meta.name);
    console.log(chalk.bold("Model:   ") + s.meta.model);
    console.log(chalk.bold("Turns:   ") + s.meta.turns);
    console.log(chalk.bold("Updated: ") + s.meta.updated);
    console.log("");
    for (const msg of s.messages) {
      const r = (msg as any).role, c = (msg as any).content, tc = (msg as any).tool_calls;
      if (r === "system") console.log(chalk.dim("  [sys] ") + chalk.dim(trunc(c || "", 80)));
      else if (r === "user") console.log(chalk.blue("  [user] ") + trunc(c || "", 120));
      else if (r === "assistant" && tc?.length) console.log(chalk.green("  [grok] ") + chalk.dim(`calls: ${tc.map((t: any) => t.function?.name).join(", ")}`));
      else if (r === "assistant") console.log(chalk.green("  [grok] ") + trunc(c || "", 120));
      else if (r === "tool") console.log(chalk.yellow("  [tool] ") + chalk.dim(trunc(c || "", 80)));
    }
  });

sessionsCmd.command("delete <id>").alias("rm").description("Delete session")
  .action((id: string) => {
    const config = getConfig();
    const mgr = new SessionManager(config.sessionDir);
    if (mgr.deleteSession(id)) console.log(chalk.green(`Deleted: ${id}`));
    else { console.error(chalk.red(`Not found: ${id}`)); process.exit(1); }
  });

sessionsCmd.command("clear").description("Delete all")
  .action(() => {
    const config = getConfig();
    console.log(chalk.green(`Cleared ${new SessionManager(config.sessionDir).clearSessions()} session(s).`));
  });

// ─── Image Generation ────────────────────────────────────────────────────────

program.command("generate-image").alias("imagine")
  .description("Generate an image")
  .argument("<prompt...>", "Description")
  .option("--pro", "High quality ($0.07)")
  .option("-n, --count <n>", "Number of images", "1")
  .action(async (args: string[], opts: any) => {
    const config = getConfig();
    const client = createClient(config);
    const model = opts.pro ? "grok-imagine-image-pro" : "grok-imagine-image";
    const n = parseInt(opts.count, 10);
    console.error(chalk.dim(`Generating ${n} image(s)...`));
    try {
      const res = await client.images.generate({ model, prompt: args.join(" "), n });
      for (const img of res.data || []) console.log(img.url || img.b64_json);
      console.error(chalk.dim(`Cost: ~$${(opts.pro ? 0.07 * n : 0.02 * n).toFixed(2)}`));
    } catch (err: any) { console.error(chalk.red(err.message)); process.exit(1); }
  });

// ─── Video Generation ────────────────────────────────────────────────────────

program.command("generate-video").alias("video")
  .description("Generate a video")
  .argument("<prompt...>", "Description")
  .option("-d, --duration <s>", "Duration in seconds (1-15)", "8")
  .option("--aspect <ratio>", "Aspect ratio (16:9, 9:16, 1:1, 4:3)", "16:9")
  .action(async (args: string[], opts: any) => {
    const config = getConfig();
    console.error(chalk.dim("Generating video (this may take a while)..."));
    try {
      const response = await fetch(`${config.baseUrl}/videos/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: "grok-imagine-video",
          prompt: args.join(" "),
          duration: parseInt(opts.duration, 10),
          aspect_ratio: opts.aspect,
        }),
      });
      const data = await response.json() as any;
      if (data.url) console.log(data.url);
      else if (data.request_id) {
        console.log(chalk.cyan(`Video request ID: ${data.request_id}`));
        console.log(chalk.dim("Video is generating. Poll for results or check xAI Console."));
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
      const cost = parseInt(opts.duration, 10) * 0.05;
      console.error(chalk.dim(`Est. cost: ~$${cost.toFixed(2)}`));
    } catch (err: any) { console.error(chalk.red(err.message)); process.exit(1); }
  });

// ─── Text-to-Speech ──────────────────────────────────────────────────────────

program.command("speak").alias("tts")
  .description("Convert text to speech")
  .argument("<text...>", "Text to speak")
  .option("--voice <name>", "Voice: eve, ara, sal, rex", "eve")
  .option("--lang <code>", "Language code (BCP-47)", "en")
  .option("-o, --output <file>", "Output file (default: stdout)")
  .action(async (args: string[], opts: any) => {
    const config = getConfig();
    console.error(chalk.dim(`Generating speech (voice: ${opts.voice}, lang: ${opts.lang})...`));
    try {
      const response = await fetch(`${config.baseUrl}/tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          text: args.join(" "),
          voice_id: opts.voice,
          language: opts.lang,
        }),
      });
      if (!response.ok) {
        const err = await response.text();
        console.error(chalk.red(`TTS error: ${err}`));
        process.exit(1);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (opts.output) {
        fs.writeFileSync(opts.output, buffer);
        console.error(chalk.green(`Saved: ${opts.output} (${(buffer.length / 1024).toFixed(1)}KB)`));
      } else {
        process.stdout.write(buffer);
      }
    } catch (err: any) { console.error(chalk.red(err.message)); process.exit(1); }
  });

// ─── Collections (RAG) ──────────────────────────────────────────────────────

const collectionsCmd = program.command("collections").description("Manage document collections (RAG)");

collectionsCmd.command("list").alias("ls").description("List collections")
  .action(async () => {
    const config = getConfig();
    try {
      const res = await fetch(`${config.baseUrl.replace("/v1", "")}/v1/collections`, {
        headers: { "Authorization": `Bearer ${config.apiKey}` },
      });
      const data = await res.json() as any;
      const cols = data.collections || data.data || [];
      if (cols.length === 0) { console.log(chalk.dim("No collections.")); return; }
      for (const c of cols) {
        console.log(chalk.cyan(c.id || c.collection_id) + "  " + chalk.white(c.name || "unnamed"));
      }
    } catch (err: any) { console.error(chalk.red(err.message)); }
  });

collectionsCmd.command("create <name>").description("Create a collection")
  .action(async (name: string) => {
    const config = getConfig();
    try {
      const res = await fetch(`${config.baseUrl.replace("/v1", "")}/v1/collections`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ name }),
      });
      const data = await res.json() as any;
      console.log(chalk.green(`Created: ${data.id || data.collection_id}`));
    } catch (err: any) { console.error(chalk.red(err.message)); }
  });

// ─── Doctor (diagnostics) ────────────────────────────────────────────────────

program.command("doctor").description("Check setup and API key")
  .action(async () => {
    const config = getConfig();
    console.log(chalk.bold("grok-cli doctor\n"));

    // Check API key
    console.log(chalk.bold("API Key: ") + chalk.green("set") + chalk.dim(` (${config.apiKey.slice(0, 8)}...)`));
    console.log(chalk.bold("Base URL: ") + config.baseUrl);
    console.log(chalk.bold("Model: ") + config.model);
    console.log(chalk.bold("Session Dir: ") + config.sessionDir);

    // Check config file
    const configPath = path.join(config.sessionDir, "config.json");
    console.log(chalk.bold("Config File: ") + (fs.existsSync(configPath) ? chalk.green(configPath) : chalk.dim("not found")));

    // Check project context
    const { loadProjectContext } = await import("./project-context.js");
    const ctx = loadProjectContext(process.cwd());
    console.log(chalk.bold("Project Context: ") + (ctx ? chalk.green("found (GROK.md / .grokrc)") : chalk.dim("none")));

    // Validate API key
    console.log(chalk.dim("\nValidating API key..."));
    try {
      const client = createClient(config);
      const models = await client.models.list();
      let count = 0;
      for await (const _ of models) count++;
      console.log(chalk.green(`API key valid. ${count} models available.`));
    } catch (err: any) {
      console.log(chalk.red(`API key invalid: ${err.message}`));
    }

    // Check API key info
    try {
      const res = await fetch(`${config.baseUrl}/api-key`, {
        headers: { "Authorization": `Bearer ${config.apiKey}` },
      });
      if (res.ok) {
        const info = await res.json() as any;
        console.log(chalk.bold("\nAPI Key Details:"));
        if (info.name) console.log(chalk.dim(`  Name: ${info.name}`));
        if (info.acls) console.log(chalk.dim(`  ACLs: ${JSON.stringify(info.acls)}`));
      }
    } catch { /* endpoint may not exist */ }

    // Sessions
    const mgr = new SessionManager(config.sessionDir);
    const sessions = mgr.listSessions();
    console.log(chalk.bold("\nSessions: ") + `${sessions.length} saved`);
  });

// ─── Tokenize ────────────────────────────────────────────────────────────────

program.command("tokenize").description("Count tokens in text")
  .argument("<text...>", "Text to tokenize")
  .option("-m, --model <model>", "Model for tokenization", MODELS.default)
  .action(async (args: string[], opts: any) => {
    const config = getConfig();
    const text = args.join(" ");
    try {
      const res = await fetch(`${config.baseUrl}/tokenize-text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model: opts.model, text }),
      });
      const data = await res.json() as any;
      const tokens = data.token_ids || data.tokens || [];
      console.log(chalk.bold(`Tokens: `) + tokens.length);
      if (data.token_ids) {
        const preview = data.token_ids.slice(0, 20).map((t: any) => t.string_token || t).join("");
        console.log(chalk.dim(`Preview: ${preview}${tokens.length > 20 ? "..." : ""}`));
      }
    } catch (err: any) { console.error(chalk.red(err.message)); }
  });

// ─── Config ──────────────────────────────────────────────────────────────────

program.command("config").description("Show or edit configuration")
  .option("--init", "Create default config file")
  .option("--show", "Show current config")
  .action((opts: any) => {
    const config = getConfig();
    const configPath = path.join(config.sessionDir, "config.json");

    if (opts.init) {
      if (fs.existsSync(configPath)) {
        console.log(chalk.yellow(`Config already exists: ${configPath}`));
        return;
      }
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const defaultConfig = {
        model: "grok-4-1-fast-reasoning",
        approval_policy: "always-approve",
        show_usage: false,
        show_diffs: true,
        show_citations: true,
        notify: false,
        max_turns: 50,
        mcp_servers: {},
        server_tools: [],
        hooks: {},
      };
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + "\n", "utf-8");
      console.log(chalk.green(`Created: ${configPath}`));
      return;
    }

    // Default: show config
    console.log(chalk.bold("Configuration:\n"));
    console.log(chalk.dim(`Config file: ${fs.existsSync(configPath) ? configPath : "not found (run: grok-cli config --init)"}`));
    console.log(chalk.dim(`Model: ${config.model}`));
    console.log(chalk.dim(`Approval: ${config.approvalPolicy}`));
    console.log(chalk.dim(`Show usage: ${config.showUsage}`));
    console.log(chalk.dim(`Show diffs: ${config.showDiffs}`));
    console.log(chalk.dim(`Notify: ${config.notify}`));
    console.log(chalk.dim(`Max turns: ${config.maxToolRounds}`));
    if (config.mcpServers.length > 0) {
      console.log(chalk.dim(`MCP servers: ${config.mcpServers.map(m => `${m.label}=${m.url}`).join(", ")}`));
    }
    if (config.serverTools.length > 0) {
      console.log(chalk.dim(`Server tools: ${config.serverTools.join(", ")}`));
    }
  });

// ─── Parse ───────────────────────────────────────────────────────────────────

program.parse();

function trunc(s: string, n: number): string {
  const l = s.replace(/\n/g, " ").trim();
  return l.length <= n ? l : l.slice(0, n - 3) + "...";
}

function fmtAge(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now"; if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); return d < 30 ? `${d}d` : `${Math.floor(d / 30)}mo`;
}
