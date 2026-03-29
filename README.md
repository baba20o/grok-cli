# grok-cli

A coding assistant CLI powered by xAI's Grok models. Think Claude Code or Codex, but for Grok.

grok-cli gives you an agentic coding assistant in your terminal that can read, write, and edit files, run shell commands, search your codebase, and maintain persistent conversation sessions — all powered by xAI's API.

## Features

- **Exec mode** — `grok-cli "fix the bug in utils.ts"`
- **Interactive REPL** — `grok-cli`
- **Pipe mode** — `echo "explain this" | grok-cli`
- **7 local tools** — bash, read_file, write_file, edit_file, glob, grep, list_directory
- **Streaming** — real-time response output with optional reasoning display
- **Session persistence** — JSONL-backed history with resume support
- **xAI server-side tools** — web search, X/Twitter search, code execution
- **Remote MCP** — connect to any MCP server (DeepWiki, custom tools, etc.)
- **Multi-agent research** — 4-16 agents collaborating on deep research
- **Image understanding** — analyze screenshots, diagrams, error messages
- **Image generation** — `grok-cli imagine "a futuristic city"`
- **File attachments** — upload PDFs/docs for Grok to reference
- **grok-code-fast-1** — specialized coding model (4x faster, 1/10th cost)
- **Structured outputs** — force JSON output matching a schema
- **Token usage & cost tracking** — see exactly what you spend
- **Citations** — source URLs displayed for web/X search results

## Quickstart

```bash
# Prerequisites: Node.js >= 20, xAI API key (https://console.x.ai)

git clone https://github.com/baba20o/grok-cli.git
cd grok-cli
npm install
npm run build
npm link

export XAI_API_KEY=your_key_here
grok-cli "what does this project do"
```

## Usage

```
grok-cli [options] [command] [prompt...]

Options:
  -m, --model <model>      Model to use
  --fast                   grok-4-1-fast-reasoning (default)
  --reasoning              grok-4.20-reasoning (flagship)
  --code                   grok-code-fast-1 (coding optimized, 4x faster)
  --research               Multi-agent deep research (4-16 agents)
  -v, --verbose            Show tool call details
  --show-reasoning         Show thinking tokens
  --show-usage             Show token usage and cost
  --no-tools               Chat only, no tool calling
  --max-turns <n>          Max agent turns (default: 50)
  --cwd <dir>              Working directory
  -r, --resume <id>        Resume a session
  -n, --name <name>        Name this session

Server-side tools:
  --web-search             Search the internet
  --x-search               Search X/Twitter
  --code-execution         Python sandbox

Advanced:
  --mcp <urls...>          Connect to MCP server(s)
  --image <paths...>       Attach images for analysis
  --attach <files...>      Upload files for reference
  --json-schema <schema>   Force structured JSON output
  --responses-api          Force Responses API

Commands:
  sessions list|show|delete|clear   Manage sessions
  generate-image|imagine <prompt>   Generate images
```

## Examples

### Coding

```bash
grok-cli "fix the failing tests in src/utils.ts"
grok-cli --code "refactor this module to use async/await"
grok-cli --reasoning "design a caching layer for the API"
```

### Research

```bash
grok-cli --research "compare React Server Components vs Astro Islands"
grok-cli --web-search "what's new in Node.js 22"
grok-cli --x-search "what are developers saying about Bun"
```

### Images

```bash
# Analyze a screenshot
grok-cli --image screenshot.png "what's wrong with this UI"
grok-cli --image error.png "fix this error"

# Generate images
grok-cli imagine "a minimalist logo for a CLI tool"
grok-cli imagine --pro "photorealistic laptop on desk"
```

### MCP Tools

```bash
# Connect to DeepWiki for repo analysis
grok-cli --mcp https://mcp.deepwiki.com/mcp "explain the xai-sdk-python repo"

# Multiple MCP servers
grok-cli --mcp wiki=https://mcp.deepwiki.com/mcp --mcp custom=https://my-tools.com/mcp "research task"
```

### File Attachments

```bash
grok-cli --attach spec.pdf "implement the auth flow from this spec"
grok-cli --attach data.csv "analyze this dataset and find anomalies"
```

### Structured Output

```bash
grok-cli --json-schema '{"type":"object","properties":{"files":{"type":"array","items":{"type":"string"}}}}' "list the source files"
```

### Pipe Mode

```bash
echo "explain this error" | grok-cli
cat error.log | grok-cli "what went wrong"
git diff | grok-cli "review this diff"
```

### Sessions

```bash
grok-cli sessions list                    # List all sessions
grok-cli sessions show <id>              # View session history
grok-cli -r <id> "follow up question"    # Resume a session
grok-cli sessions clear                   # Delete all sessions
```

## Models

| Flag | Model | Best For | Price (in/out per 1M) |
|------|-------|----------|----------------------|
| `--fast` (default) | grok-4-1-fast-reasoning | General tasks | $0.20 / $0.50 |
| `--code` | grok-code-fast-1 | Coding (4x faster) | $0.20 / $0.50 |
| `--reasoning` | grok-4.20-reasoning | Complex reasoning | $2.00 / $6.00 |
| `--non-reasoning` | grok-4.20-non-reasoning | Simple generation | $2.00 / $6.00 |
| `--research` | grok-4.20-multi-agent | Deep research | $2.00 / $6.00 |

All models: 2M token context window.

## Tools

### Local Tools (run on your machine)

| Tool | Description |
|------|-------------|
| `bash` | Shell commands (git, npm, builds, tests) |
| `read_file` | Read files with line numbers |
| `write_file` | Create/overwrite files |
| `edit_file` | Find-and-replace edits |
| `glob` | Find files by pattern |
| `grep` | Regex search across files |
| `list_directory` | List directory contents |

### xAI Server-Side Tools

| Tool | Flag | Cost |
|------|------|------|
| Web Search | `--web-search` | $5/1k calls |
| X Search | `--x-search` | $5/1k calls |
| Code Execution | `--code-execution` | $5/1k calls |
| Remote MCP | `--mcp <url>` | Token-based |

## Architecture

```
src/
├── index.ts          CLI entry, argument parsing, subcommands
├── agent.ts          Agent loop (chat.completions + Responses API)
├── client.ts         OpenAI SDK wrapper for xAI
├── config.ts         Configuration and env loading
├── session.ts        JSONL session persistence
├── stream.ts         Streaming accumulator and display
├── system-prompt.ts  Dynamic system prompt builder
├── image.ts          Image encoding and content building
├── usage.ts          Token tracking and cost calculation
├── types.ts          TypeScript types
└── tools/
    ├── index.ts      Tool registry and executor
    ├── definitions.ts  JSON schemas for function calling
    ├── bash.ts       Shell execution
    ├── read-file.ts  File reading
    ├── write-file.ts File writing
    ├── edit-file.ts  Targeted editing
    ├── glob.ts       Pattern matching
    ├── grep.ts       Content search
    └── list-dir.ts   Directory listing
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `XAI_API_KEY` | API key (required) | — |
| `XAI_BASE_URL` | API base URL | `https://api.x.ai/v1` |
| `GROK_MODEL` | Default model | `grok-4-1-fast-reasoning` |
| `GROK_SESSION_DIR` | Session storage | `~/.grok-cli` |

Loads `.env` from: current dir, parent dir, `~/.grok-cli/.env`.

## License

Apache-2.0
