#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { getConfig, MODELS } from "./config.js";
import { runAgent, runInteractive } from "./agent.js";
import { SessionManager } from "./session.js";
import { createClient } from "./client.js";
import { formatApiError, formatSessionDirError, getResponseErrorMessage, isNetworkError } from "./cli-errors.js";
import { emitError, isJsonMode, setJsonMode } from "./json-output.js";
import { setShowDiffs } from "./tools/edit-file.js";
import { approxTokenCount } from "./truncation.js";
import type { GrokConfig, ServerTool, McpServer } from "./types.js";

const VERSION = readVersion();

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8").trim();
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
    ) as { version?: string };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command()
  .name("grok-cli")
  .description("A coding assistant CLI powered by xAI's Grok models")
  .version(VERSION);

// ─── Default command ─────────────────────────────────────────────────────────

program
  .option("-m, --model <model>", "Model to use")
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
  .option("--max-turns <n>", "Max agent turns")
  .option("--cwd <dir>", "Working directory", process.cwd())
  .option("-r, --resume <id>", "Resume session")
  .option("--fork <id>", "Fork a session (copy history, new session)")
  .option("-n, --name <name>", "Name this session")
  .option("--plan", "Plan mode: create a plan first, then execute")
  .option("--approve", "Ask before writes/exec (default: always-approve)")
  .option("--deny-writes", "Block all file writes and shell commands")
  .option("--yolo", "Skip all approvals (dangerous)")
  .option("--ephemeral", "Don't save session to disk")
  .option("-o, --output <file>", "Write final message to file")
  .option("--json", "JSONL output mode (machine-readable, events on stdout)")
  .option("--color <mode>", "Color mode: auto, always, never", "auto")
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
    const hasCliValue = (name: string): boolean => {
      const source = program.getOptionValueSource(name);
      return source !== undefined && source !== "default";
    };

    let model: string | undefined = hasCliValue("model") ? opts.model : undefined;
    if (opts.fast) model = MODELS.fast;
    if (opts.reasoning) model = MODELS.reasoning;
    if (opts.nonReasoning) model = MODELS.nonReasoning;
    if (opts.code) model = MODELS.code;
    if (opts.research) model = MODELS.multiAgent;

    const maxTurns = hasCliValue("maxTurns") ? parseInt(opts.maxTurns, 10) : undefined;

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

    let approvalPolicy: GrokConfig["approvalPolicy"] | undefined;
    if (opts.yolo) approvalPolicy = "always-approve";
    else if (opts.denyWrites) approvalPolicy = "deny-writes";
    else if (opts.approve) approvalPolicy = "ask";

    // Color control
    if (hasCliValue("color") && opts.color === "never") {
      process.env.NO_COLOR = "1";
    } else if (hasCliValue("color") && opts.color === "always") {
      process.env.FORCE_COLOR = "3";
    }

    // JSON mode
    if (opts.json) {
      setJsonMode(true);
    }

    const config: GrokConfig = getConfig({
      model,
      showReasoning: hasCliValue("showReasoning") ? opts.showReasoning : undefined,
      showToolCalls: opts.tools !== false,
      showUsage: hasCliValue("showUsage") ? opts.showUsage : undefined,
      showCitations: hasCliValue("citations") ? opts.citations !== false : undefined,
      showDiffs: hasCliValue("diffs")
        ? opts.diffs !== false
        : hasCliValue("showDiffs")
          ? true
          : undefined,
      maxToolRounds: maxTurns,
      serverTools,
      mcpServers,
      useResponsesApi: opts.responsesApi || serverTools.length > 0 || mcpServers.length > 0,
      imageInputs: opts.image || [],
      fileAttachments: opts.attach || [],
      jsonSchema: hasCliValue("jsonSchema") ? opts.jsonSchema || null : undefined,
      approvalPolicy,
      notify: hasCliValue("notify") ? opts.notify || false : undefined,
      jsonOutput: hasCliValue("json") ? opts.json || false : undefined,
      ephemeral: hasCliValue("ephemeral") ? opts.ephemeral || false : undefined,
      outputFile: hasCliValue("output") ? opts.output || null : undefined,
      color: hasCliValue("color") ? opts.color || "auto" : undefined,
    });

    setShowDiffs(config.showDiffs);

    // Session fork: copy history to new session
    let sessionId = config.ephemeral ? undefined : opts.resume || undefined;
    if (config.ephemeral && (opts.resume || opts.fork) && !config.jsonOutput) {
      console.error(chalk.dim("(ephemeral mode ignores --resume and --fork)"));
    }
    if (!config.ephemeral && opts.fork) {
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
      showReasoning: config.showReasoning,
      maxTurns: config.maxToolRounds,
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
      let result = "";
      try {
        result = await runAgent(config, prompt, agentOpts);
      } catch (err: any) {
        await fatalExit("Request failed", err, opts.verbose);
      }
      // Write final message to file if requested
      if (config.outputFile && result) {
        const dir = path.dirname(config.outputFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(config.outputFile, result, "utf-8");
        console.error(chalk.dim(`Output saved: ${config.outputFile}`));
      }
      if (opts.verbose) {
        console.error(chalk.dim(`\n${((Date.now() - startTime) / 1000).toFixed(1)}s`));
      }
      if (config.notify) {
        const { notify } = await import("./notifications.js");
        notify("grok-cli", "Task completed");
      }
    } else {
      try {
        await runInteractive(config, agentOpts);
      } catch (err: any) {
        await fatalExit("Interactive session failed", err, opts.verbose);
      }
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
      console.error(chalk.red(formatApiError("Failed to list models", err)));
      process.exit(1);
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
      if (err?.status === 404) {
        console.error(chalk.red(`Model not found: ${modelId}`));
      } else {
        console.error(chalk.red(formatApiError(`Failed to load model ${modelId}`, err)));
      }
      process.exit(1);
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
    console.error(chalk.red(formatApiError("Failed to list models", err)));
    process.exit(1);
  }
});

// ─── Sessions ────────────────────────────────────────────────────────────────

const sessionsCmd = program.command("sessions").description("Manage sessions");

sessionsCmd.command("list").alias("ls").description("List sessions")
  .option("--limit <n>", "Max to show", "20")
  .action((opts: any) => {
    const config = getConfig();
    const mgr = createSessionManagerOrExit(config.sessionDir);
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
    const mgr = createSessionManagerOrExit(config.sessionDir);
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
    const mgr = createSessionManagerOrExit(config.sessionDir);
    if (mgr.deleteSession(id)) console.log(chalk.green(`Deleted: ${id}`));
    else { console.error(chalk.red(`Not found: ${id}`)); process.exit(1); }
  });

sessionsCmd.command("clear").description("Delete all")
  .action(() => {
    const config = getConfig();
    console.log(chalk.green(`Cleared ${createSessionManagerOrExit(config.sessionDir).clearSessions()} session(s).`));
  });

// ─── Image Generation ────────────────────────────────────────────────────────

program.command("generate-image").alias("imagine")
  .description("Generate an image")
  .argument("<prompt...>", "Description")
  .option("--pro", "High quality ($0.07)")
  .option("-n, --count <n>", "Number of images", "1")
  .option("-o, --output <dir>", "Output directory", "generated/images")
  .option("--no-download", "Print URL only, don't download")
  .action(async (args: string[], opts: any) => {
    const config = getConfig();
    const client = createClient(config);
    const model = opts.pro ? "grok-imagine-image-pro" : "grok-imagine-image";
    const n = parseInt(opts.count, 10);
    console.error(chalk.dim(`Generating ${n} image(s) with ${model}...`));
    try {
      const res = await client.images.generate({ model, prompt: args.join(" "), n });
      const outDir = path.resolve(opts.output);
      if (opts.download !== false) {
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      }
      for (let i = 0; i < (res.data || []).length; i++) {
        const img = res.data![i];
        const url = img.url;
        if (!url) continue;

        if (opts.download === false) {
          console.log(url);
          continue;
        }

        // Download the image
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const ext = url.includes(".png") ? "png" : "jpg";
        const filename = `grok-${timestamp}${n > 1 ? `-${i + 1}` : ""}.${ext}`;
        const filePath = path.join(outDir, filename);

        const imgRes = await fetch(url);
        if (!imgRes.ok) { console.error(chalk.yellow(`Failed to download image ${i + 1}`)); continue; }
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        fs.writeFileSync(filePath, buffer);
        console.log(chalk.green(`Saved: ${filePath}`) + chalk.dim(` (${(buffer.length / 1024).toFixed(0)}KB)`));
      }
      console.error(chalk.dim(`Cost: ~$${(opts.pro ? 0.07 * n : 0.02 * n).toFixed(2)}`));
    } catch (err: any) { console.error(chalk.red(err.message)); process.exit(1); }
  });

// ─── Video Generation ────────────────────────────────────────────────────────

program.command("generate-video").alias("video")
  .description("Generate a video")
  .argument("<prompt...>", "Description")
  .option("-d, --duration <s>", "Duration in seconds (1-15)", "8")
  .option("--aspect <ratio>", "Aspect ratio (16:9, 9:16, 1:1, 4:3)", "16:9")
  .option("-o, --output <dir>", "Output directory", "generated/video")
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
      if (data.url) {
        // Download the video
        const outDir = path.resolve(opts.output);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const filePath = path.join(outDir, `grok-video-${timestamp}.mp4`);
        const vidRes = await fetch(data.url);
        if (vidRes.ok) {
          const buffer = Buffer.from(await vidRes.arrayBuffer());
          fs.writeFileSync(filePath, buffer);
          console.log(chalk.green(`Saved: ${filePath}`) + chalk.dim(` (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`));
        } else {
          console.log(data.url);
        }
      } else if (data.request_id) {
        console.log(chalk.cyan(`Video request ID: ${data.request_id}`));
        console.log(chalk.dim("Video is generating async. Poll for results or check xAI Console."));
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
  .option("-o, --output <file>", "Output file (auto-generated if omitted)")
  .option("--dir <dir>", "Output directory", "generated/audio")
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
      // Determine output path
      let outPath = opts.output;
      if (!outPath) {
        const outDir = path.resolve(opts.dir);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        outPath = path.join(outDir, `grok-tts-${opts.voice}-${timestamp}.mp3`);
      }
      const dir = path.dirname(outPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outPath, buffer);
      console.log(chalk.green(`Saved: ${outPath}`) + chalk.dim(` (${(buffer.length / 1024).toFixed(1)}KB)`));
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
      console.log(chalk.red(formatApiError("API key validation failed", err)));
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
    try {
      const mgr = new SessionManager(config.sessionDir);
      const sessions = mgr.listSessions();
      console.log(chalk.bold("\nSessions: ") + `${sessions.length} saved`);
    } catch (err: any) {
      console.log(chalk.bold("\nSessions: ") + chalk.red("unavailable"));
      console.log(chalk.dim(`  ${formatSessionDirError(config.sessionDir, err)}`));
    }
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
      if (!res.ok) {
        throw new Error(await getResponseErrorMessage("Tokenization failed", res));
      }
      const data = await res.json() as any;
      const tokens = data.token_ids || data.tokens || [];
      console.log(chalk.bold(`Tokens: `) + tokens.length);
      if (data.token_ids) {
        const preview = data.token_ids.slice(0, 20).map((t: any) => t.string_token || t).join("");
        console.log(chalk.dim(`Preview: ${preview}${tokens.length > 20 ? "..." : ""}`));
      }
    } catch (err: any) {
      if (isNetworkError(err)) {
        const estimatedTokens = approxTokenCount(text);
        console.error(chalk.yellow(formatApiError("Tokenization API unavailable", err)));
        console.log(chalk.bold("Tokens (estimated): ") + estimatedTokens);
        console.log(chalk.dim(`Preview: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`));
        return;
      }
      console.error(chalk.red(err instanceof Error ? err.message : formatApiError("Tokenization failed", err)));
      process.exit(1);
    }
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

async function fatalExit(context: string, err: any, verbose: boolean): Promise<never> {
  const message = getFatalMessage(context, err);
  emitError(message);
  if (!isJsonMode()) {
    console.error(chalk.red(`\nFatal: ${message}`));
    if (verbose && err?.stack) console.error(chalk.dim(err.stack));
  }
  process.exit(1);
}

function getFatalMessage(context: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("session storage")) return message;
  return formatApiError(context, err);
}

function createSessionManagerOrExit(baseDir: string): SessionManager {
  try {
    return new SessionManager(baseDir);
  } catch (err: any) {
    console.error(chalk.red(formatSessionDirError(baseDir, err)));
    process.exit(1);
  }
}

function fmtAge(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now"; if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); return d < 30 ? `${d}d` : `${Math.floor(d / 30)}mo`;
}
