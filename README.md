# grok-cli

A coding assistant CLI powered by xAI's Grok models.

`grok-cli` gives you an agentic assistant in your terminal that can chat, inspect and edit code, run shell commands, search a repo, attach files/images, use xAI server-side tools, and keep JSONL-backed session history.

## Features

- Exec mode: `grok-cli "fix the bug in utils.ts"`
- Interactive REPL: `grok-cli`
- Pipe mode: `git diff | grok-cli "review this patch"`
- Local tools: `bash`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `list_directory`
- Session persistence with resume, fork, archive, rename, rollback, and compaction
- Ephemeral mode for no-history runs
- JSONL output mode for automation
- xAI server-side tools: web search, X search, code execution, file search, and MCP
- Search filters for domains, X handles, date ranges, and media understanding
- Collection management backed by xAI's management API
- Review mode for uncommitted diffs, branches, and commits
- Sandbox modes and per-tool approval overrides
- Batch API helpers and realtime client-secret creation
- Image inputs and file attachments
- Image generation, video generation, TTS voice listing, and streaming TTS
- Structured JSON output with `--json-schema`
- Token usage display, citations, approvals, hooks, and notifications

## Quickstart

```bash
# Prerequisites: Node.js >= 20 and an xAI API key

git clone https://github.com/baba20o/grok-cli.git
cd grok-cli
npm install
npm run build
npm link

export XAI_API_KEY=your_key_here
grok-cli doctor
grok-cli "what does this project do?"
```

You can also place `XAI_API_KEY` in a local `.env` file. The CLI loads `.env` from:

- the current directory
- the parent directory
- `~/.grok-cli/.env`

## Usage

```text
grok-cli [options] [command] [prompt...]
```

Key options:

- `-m, --model <model>`: use any specific model id
- `--fast`, `--reasoning`, `--non-reasoning`, `--code`, `--research`: model shortcuts
- `--max-turns <n>`: cap agent turns
- `--cwd <dir>`: change working directory
- `-r, --resume <id>`: resume a saved session
- `--fork <id>`: copy a session into a new one
- `--ephemeral`: run without saving session state
- `--approve`, `--deny-writes`, `--yolo`: approval policy
- `--sandbox <mode>`: `read-only`, `workspace-write`, or `danger-full-access`
- `--plan`: ask the model to plan before execution
- `--json`: machine-readable JSONL events on stdout
- `--json-schema <schema>`: require structured output
- `--web-search`, `--x-search`, `--code-execution`: enable xAI server-side tools
- `--allow-domain`, `--exclude-domain`, `--search-images`: web search controls
- `--x-allow`, `--x-exclude`, `--x-from`, `--x-to`, `--x-images`, `--x-videos`: X search controls
- `--collection <id>` and `--file-search-mode <mode>`: enable file search over xAI collections
- `--include-tool-outputs`, `--show-server-tool-usage`: expose server-side tool output and usage
- `--mcp <urls...>`: connect remote MCP servers
- `--mcp-allow <label=tool1,tool2>`: restrict MCP tools per server
- `--mcp-desc <label=description>`: attach MCP server descriptions
- `--image <paths...>`: attach images
- `--attach <files...>`: upload files
- `--show-reasoning`, `--show-usage`, `--show-diffs`, `--no-citations`
- `--notify`: desktop notification on completion
- `--responses-api`: force the Responses API
- `--defer`: fire-and-forget deferred completion

Full help:

```bash
grok-cli --help
```

## Commands

| Command | Description |
|---|---|
| `models` | List models or inspect a specific model |
| `sessions` | List, show, archive, rename, rollback, compact, delete, or clear saved sessions |
| `review` | Run Grok in code review mode for local changes, branches, or commits |
| `generate-image` / `imagine` | Generate images |
| `generate-video` / `video` | Generate video |
| `speak` / `tts` | Convert text to speech |
| `tts-voices` | List currently available TTS voices |
| `collections` | Manage xAI document collections and their documents |
| `batch` | Create, inspect, cancel, and feed Batch API jobs |
| `realtime` | Create ephemeral realtime client secrets |
| `doctor` | Validate setup, API key, and session storage |
| `tokenize` | Count tokens for text |
| `config` | Show config or create a default config file |

Examples:

```bash
grok-cli models ls
grok-cli models info grok-4-1-fast-reasoning

grok-cli sessions list
grok-cli sessions show <id>
grok-cli sessions archive <id>
grok-cli sessions rename <id> "new name"
grok-cli sessions rollback <id> --turns 2
grok-cli sessions compact <id>
grok-cli sessions delete <id>

grok-cli review --base origin/main
grok-cli review --commit HEAD~1

grok-cli config --init
grok-cli config
```

## Model Selection

You can change models in three ways:

1. One-off on the command line:

```bash
grok-cli -m grok-4-1-fast-reasoning "summarize this repo"
grok-cli --code "fix the TypeScript errors"
grok-cli --reasoning "design a migration plan"
```

2. Via environment:

```bash
export GROK_MODEL=grok-code-fast-1
```

3. Via config file:

```json
{
  "model": "grok-code-fast-1"
}
```

Selection precedence is:

`CLI flag` > `config.json` > `GROK_MODEL` > built-in default

Current built-in aliases:

| Flag | Model |
|---|---|
| `--fast` | `grok-4-1-fast-reasoning` |
| `--reasoning` | `grok-4.20-0309-reasoning` |
| `--non-reasoning` | `grok-4.20-0309-non-reasoning` |
| `--code` | `grok-code-fast-1` |
| `--research` | `grok-4.20-multi-agent-0309` |

To see what your API key can actually use:

```bash
grok-cli models ls
```

## Examples

### Coding

```bash
grok-cli "fix the failing tests in src/utils.ts"
grok-cli --code "refactor this module to use async/await"
grok-cli --reasoning "design a caching layer for the API"
grok-cli --plan "add a config migration for the new schema"
```

### Interactive

```bash
grok-cli
grok-cli --ephemeral
grok-cli -r <session-id>
```

### Research

```bash
grok-cli --research "compare React Server Components vs Astro Islands"
grok-cli --web-search "what changed in Node.js 22"
grok-cli --x-search "what are developers saying about Bun"
grok-cli --web-search --allow-domain docs.x.ai --search-images "summarize the docs homepage"
grok-cli --x-search --x-allow xai --x-from 2026-03-01 --x-to 2026-03-29 "recent Grok platform updates"
grok-cli --collection engineering-handbook "find the deploy checklist"
```

### Images and Files

```bash
grok-cli --image screenshot.png "what is wrong with this UI?"
grok-cli --attach spec.pdf "implement the auth flow from this spec"
grok-cli --attach data.csv "summarize the anomalies in this dataset"
```

### Generation

```bash
grok-cli imagine "a minimalist logo for a CLI tool"
grok-cli imagine --pro "photorealistic laptop on a desk"
grok-cli video --duration 8 --aspect 16:9 "a futuristic terminal UI"
grok-cli tts --voice eve "Build completed successfully."
grok-cli tts --stream --codec mp3 --voice leo "Streaming speech sample"
grok-cli tts-voices
```

### MCP

```bash
grok-cli --mcp https://mcp.deepwiki.com/mcp "explain this repository"
grok-cli --mcp wiki=https://mcp.deepwiki.com/mcp --mcp custom=https://my-tools.example/mcp "research task"
grok-cli --mcp wiki=https://mcp.deepwiki.com/mcp --mcp-allow wiki=search,read_page --mcp-desc wiki="Team wiki" "find release notes"
```

### Structured Output and JSON Mode

```bash
grok-cli --json-schema '{"type":"object","properties":{"files":{"type":"array","items":{"type":"string"}}}}' \
  "list the source files touched by session persistence"

grok-cli --json --ephemeral "say hi in one short sentence"
```

### Collections

```bash
grok-cli collections list
grok-cli collections create "Engineering Docs"
grok-cli collections upload col_123 handbook.pdf
grok-cli collections search col_123 "on-call rotation policy"
grok-cli --collection col_123 "summarize the deployment runbook"
```

Collection management requires `XAI_MANAGEMENT_API_KEY`.

### Batch + Realtime

```bash
grok-cli batch list --limit 20
grok-cli batch create nightly-evals
grok-cli batch add-chat batch_123 "summarize this issue thread"
grok-cli batch results batch_123 --limit 10
grok-cli realtime secret --seconds 600
```

### Tokenization

```bash
grok-cli tokenize "fix the bug in approvals.ts"
grok-cli tokenize -m grok-code-fast-1 "class User { constructor() {} }"
```

## Sessions

Sessions are stored as JSONL files under:

- `GROK_SESSION_DIR/sessions`
- or `~/.grok-cli/sessions` by default

Useful commands:

```bash
grok-cli sessions list
grok-cli sessions list --all
grok-cli sessions show <id>
grok-cli -r <id> "follow-up question"
grok-cli --fork <id> "continue on a new branch of thought"
grok-cli sessions archive <id>
grok-cli sessions unarchive <id>
grok-cli sessions rename <id> "better title"
grok-cli sessions rollback <id> --turns 1
grok-cli sessions compact <id>
grok-cli sessions clear
```

If you do not want any session state written, use:

```bash
grok-cli --ephemeral "one-off task"
```

## Configuration

Create a starter config file:

```bash
grok-cli config --init
```

That writes `config.json` under your session dir (`GROK_SESSION_DIR` or `~/.grok-cli`).

Supported config fields currently include:

```json
{
  "model": "grok-4-1-fast-reasoning",
  "approval_policy": "always-approve",
  "sandbox_mode": "workspace-write",
  "show_usage": false,
  "show_diffs": true,
  "show_citations": true,
  "show_server_tool_usage": false,
  "include_tool_outputs": false,
  "notify": false,
  "max_turns": 50,
  "management_api_key": "",
  "management_base_url": "https://management-api.x.ai/v1",
  "mcp_servers": [
    {
      "label": "wiki",
      "url": "https://mcp.deepwiki.com/mcp",
      "description": "Team wiki",
      "allowedTools": ["search", "read_page"]
    }
  ],
  "tool_approvals": {
    "defaultMode": "ask",
    "tools": {
      "bash": "allow",
      "write_file": "deny"
    }
  },
  "server_tools": [
    {
      "type": "web_search",
      "filters": {
        "allowedDomains": ["docs.x.ai"]
      },
      "includeSources": true
    },
    {
      "type": "file_search",
      "collectionIds": ["col_123"],
      "retrievalMode": "hybrid",
      "includeResults": true
    }
  ],
  "hooks": {
    "pre-tool": ["echo pre"],
    "post-tool": ["echo post"]
  }
}
```

Environment variables:

| Variable | Description | Default |
|---|---|---|
| `XAI_API_KEY` | xAI API key | required |
| `XAI_MANAGEMENT_API_KEY` | xAI management API key for collections | unset |
| `XAI_BASE_URL` | API base URL | `https://api.x.ai/v1` |
| `XAI_MANAGEMENT_BASE_URL` | management API base URL | `https://management-api.x.ai/v1` |
| `GROK_MODEL` | default model | `grok-4-1-fast-reasoning` |
| `GROK_SESSION_DIR` | base dir for sessions and config | `~/.grok-cli` |
| `GROK_SANDBOX_MODE` | default sandbox mode | `danger-full-access` |

## Tools

### Local Tools

| Tool | Description |
|---|---|
| `bash` | Run shell commands |
| `read_file` | Read file contents |
| `write_file` | Create or overwrite files |
| `edit_file` | Exact find-and-replace edits |
| `glob` | Find files by glob |
| `grep` | Search file contents by regex |
| `list_directory` | List directory contents |

### xAI Server-Side Tools

| Tool | CLI support |
|---|---|
| Web Search | `--web-search`, `--allow-domain`, `--exclude-domain`, `--search-images` |
| X Search | `--x-search`, `--x-allow`, `--x-exclude`, `--x-from`, `--x-to`, `--x-images`, `--x-videos` |
| Code Execution | `--code-execution` |
| File Search | `--collection <id>`, `--file-search-mode <mode>` |
| Remote MCP | `--mcp <url>`, `--mcp-allow`, `--mcp-desc` |

## Development

```bash
npm run lint
npm run build
npm test
```

Source layout:

```text
src/
├── index.ts             CLI entry and subcommands
├── agent.ts             Agent loop and interactive mode
├── client.ts            xAI client wrapper
├── cli-errors.ts        Shared CLI/network/session error formatting
├── config.ts            Config and .env loading
├── server-tools.ts      Typed server-tool normalization and serialization
├── session.ts           JSONL session persistence
├── json-output.ts       JSONL event output
├── approvals.ts         Approval policy checks
├── hooks.ts             Hook execution
├── compaction.ts        Conversation compaction
├── truncation.ts        Tool output truncation and token estimation
├── system-prompt.ts     Dynamic system prompt
├── collections-api.ts   xAI collections management helpers
├── batch-api.ts         Batch API helpers
├── voice-api.ts         TTS and realtime helpers
├── project-context.ts   Optional repo context loading
├── image.ts             Image input helpers
├── notifications.ts     Desktop notification support
├── usage.ts             Usage accounting
└── tools/
    ├── index.ts
    ├── definitions.ts
    ├── bash.ts
    ├── read-file.ts
    ├── write-file.ts
    ├── edit-file.ts
    ├── glob.ts
    ├── grep.ts
    ├── list-dir.ts
    └── policy.ts
```

## License

Apache-2.0
