# grok-agent

[![npm version](https://img.shields.io/npm/v/grok-agent.svg)](https://www.npmjs.com/package/grok-agent)
[![license](https://img.shields.io/npm/l/grok-agent.svg)](https://github.com/baba20o/grok-cli/blob/main/LICENSE)

A coding assistant CLI powered by xAI's Grok models.

`grok-agent` gives you an agentic assistant in your terminal that can chat, inspect and edit code, run shell commands, search a repo, attach files/images, use xAI server-side tools, keep JSONL-backed session history, and store persistent long-term memory.

## Features

- Exec mode: `grok-agent "fix the bug in utils.ts"`
- Interactive REPL: `grok-agent`
- Pipe mode: `git diff | grok-agent "review this patch"`
- Local tools: `bash`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `list_directory`, `ask_user_question`, `lsp`, `tool_search`, `memory_search`, `remember_memory`, `forget_memory`, `todo_write`, `task_*`, `schedule_*`, `web_fetch`, `notebook_edit`, `mcp_*`, `spawn_subagent`
- Tool orchestration for concurrent safe reads plus persisted oversized tool outputs
- Session persistence with resume, fork, archive, rename, rollback, and compaction
- Session task boards with explicit status/ownership plus read-only subagents for bounded investigation
- Scheduler support for one-shot and recurring cron-style prompts
- Persistent memory with project/user scopes, markdown files, `MEMORY.md` indexes, and automatic recall
- Ephemeral mode for no-history runs
- JSONL output mode for automation
- xAI server-side tools: web search, X search, code execution, file search, and MCP
- Search filters for domains, X handles, date ranges, and media understanding
- Collection management backed by xAI's management API, with direct metadata-filtered document search
- Review mode for uncommitted diffs, branches, and commits
- Sandbox modes and per-tool approval overrides
- Batch API helpers, JSONL batch submission ergonomics, realtime client-secret creation, and WAV transcription via the realtime API
- Image inputs and file attachments
- Image generation, video generation, TTS voice listing, and streaming TTS
- Structured JSON output with `--json-schema`
- Token usage display, citations, approvals, hooks, and notifications

## Install

```bash
npm install -g grok-agent
```

Requires Node.js >= 20 and an [xAI API key](https://console.x.ai/team/default/api-keys).

Set your API key:

```bash
# Option 1: environment variable
export XAI_API_KEY=your_key_here

# Option 2: .env file (in your project root or ~/.grok/.env)
echo "XAI_API_KEY=your_key_here" > .env
```

Verify everything works:

```bash
grok-agent doctor
```

Start using it:

```bash
grok-agent "what does this project do?"
```

### Install from source

```bash
git clone https://github.com/baba20o/grok-cli.git
cd grok-cli
npm install
npm run build
npm link
```

The CLI loads `.env` from the current directory, the parent directory, or `~/.grok/.env`.

## Usage

```text
grok-agent [options] [command] [prompt...]
```

Key options:

- `-m, --model <model>`: use any specific model id
- `--fast`, `--reasoning`, `--non-reasoning`, `--code`, `--research`: model shortcuts
- `--max-turns <n>`: cap agent turns
- `--cwd <dir>`: change working directory
- `-r, --resume <id>`: resume a saved session
- `--fork <id>`: copy a session into a new one
- `-n, --name <name>`: assign a name to the session
- `--ephemeral`: run without saving session state
- `-o, --output <file>`: write final message to a file
- `--approve`, `--deny-writes`, `--yolo`: approval policy
- `--sandbox <mode>`: `read-only`, `workspace-write`, or `danger-full-access`
- `--plan`: ask the model to plan before execution
- `--json`: machine-readable JSONL events on stdout
- `--json-schema <schema>`: require structured output
- `--color <mode>`: set color output mode (`auto`, `always`, `never`)
- `--web-search`, `--x-search`, `--code-execution`: enable xAI server-side tools
- `--allow-domain`, `--exclude-domain`, `--search-images`: web search controls
- `--x-allow`, `--x-exclude`, `--x-from`, `--x-to`, `--x-images`, `--x-videos`: X search controls
- `--collection <id>`, `--file-search-mode <mode>`, `--collection-filter <expr>`, `--file-search-results <n>`: enable and tune file search over xAI collections
- `--include-tool-outputs`, `--show-server-tool-usage`: expose server-side tool output and usage
- `--mcp <urls...>`: connect remote MCP servers
- `--mcp-allow <label=tool1,tool2>`: restrict MCP tools per server
- `--mcp-desc <label=description>`: attach MCP server descriptions
- `--image <paths...>`: attach images
- `--attach <files...>`: upload files
- `--show-reasoning`, `--show-usage`, `--show-diffs`, `--no-diffs`, `--no-citations`, `--no-tools`
- `-v, --verbose`: output detailed tool calls
- `--notify`: desktop notification on completion
- `--responses-api`: force the Responses API
- `--defer`: fire-and-forget deferred completion

Full help:

```bash
grok-agent --help
```

## Commands

| Command | Description |
|---|---|
| `models` | List models or inspect a specific model |
| `memory` | List, search, show, save, and delete persistent long-term memory |
| `sessions` | List, show, archive, rename, rollback, compact, delete, or clear saved sessions |
| `tasks` | Inspect and update per-session task boards |
| `schedule` | Create, list, delete, and run scheduled prompts |
| `mcp` | List and read resources from configured MCP servers |
| `review` | Run Grok in code review mode for local changes, branches, or commits |
| `generate-image` / `imagine` | Generate images |
| `generate-video` / `video` | Generate video |
| `speak` / `tts` | Convert text to speech |
| `tts-voices` | List currently available TTS voices |
| `collections` | Manage xAI document collections and their documents |
| `batch` | Create, inspect, cancel, and feed Batch API jobs |
| `realtime` | Create realtime client secrets or transcribe WAV audio |
| `doctor` | Validate setup, API key, and session storage |
| `tokenize` | Count tokens for text |
| `config` | Show config or create a default config file |

Examples:

```bash
grok-agent models ls
grok-agent models info grok-4-1-fast-reasoning

grok-agent memory list
grok-agent memory remember "Testing preference" --description "Prefer Vitest" --body "Prefer Vitest for new tests in this repository."
grok-agent memory search vitest
grok-agent memory show project:testing-preference.md
grok-agent memory forget project:testing-preference.md

grok-agent sessions list
grok-agent sessions show <id>
grok-agent sessions archive <id>
grok-agent sessions rename <id> "new name"
grok-agent sessions rollback <id> --turns 2
grok-agent sessions compact <id>
grok-agent sessions delete <id>

grok-agent tasks list --session <id>
grok-agent tasks create --session <id> "Investigate flaky test"
grok-agent tasks update task-1 --session <id> --status in_progress --owner grok

grok-agent schedule create --cron "0 9 * * 1-5" "summarize overnight CI failures"
grok-agent schedule run-due

grok-agent mcp resources wiki
grok-agent mcp read wiki docs://release-notes

grok-agent review --base origin/main
grok-agent review --commit HEAD~1

grok-agent config --init
grok-agent config
```

## Model Selection

You can change models in three ways:

1. One-off on the command line:

```bash
grok-agent -m grok-4-1-fast-reasoning "summarize this repo"
grok-agent --code "fix the TypeScript errors"
grok-agent --reasoning "design a migration plan"
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
| *(default)* | `grok-4.20-0309-reasoning` |
| `--fast` | `grok-4-1-fast-reasoning` |
| `--reasoning` | `grok-4.20-0309-reasoning` |
| `--non-reasoning` | `grok-4.20-0309-non-reasoning` |
| `--code` | `grok-code-fast-1` |
| `--research` | `grok-4.20-multi-agent-0309` |

To see what your API key can actually use:

```bash
grok-agent models ls
```

## Examples

### Coding

```bash
grok-agent "fix the failing tests in src/utils.ts"
grok-agent --code "refactor this module to use async/await"
grok-agent --reasoning "design a caching layer for the API"
grok-agent --plan "add a config migration for the new schema"
```

### Interactive

```bash
grok-agent
grok-agent --ephemeral
grok-agent -r <session-id>
```

Interactive mode also supports slash commands for session control and quick utilities:

```text
/session /sessions /tasks /usage /name /model /archive /compact /rollback /files
```

### Research

```bash
grok-agent --research "compare React Server Components vs Astro Islands"
grok-agent --web-search "what changed in Node.js 22"
grok-agent --x-search "what are developers saying about Bun"
grok-agent --web-search --allow-domain docs.x.ai --search-images "summarize the docs homepage"
grok-agent --x-search --x-allow xai --x-from 2026-03-01 --x-to 2026-03-29 "recent Grok platform updates"
grok-agent --collection engineering-handbook --collection-filter 'team = "platform"' "find the deploy checklist"
```

### Images and Files

```bash
grok-agent --image screenshot.png "what is wrong with this UI?"
grok-agent --attach spec.pdf "implement the auth flow from this spec"
grok-agent --attach data.csv "summarize the anomalies in this dataset"
```

### Generation

```bash
grok-agent imagine "a minimalist logo for a CLI tool"
grok-agent imagine --pro "photorealistic laptop on a desk"
grok-agent video --duration 8 --aspect 16:9 "a futuristic terminal UI"
grok-agent tts --voice eve "Build completed successfully."
grok-agent tts --stream --codec mp3 --voice leo "Streaming speech sample"
grok-agent tts-voices
```

### MCP

```bash
grok-agent --mcp https://mcp.deepwiki.com/mcp "explain this repository"
grok-agent --mcp wiki=https://mcp.deepwiki.com/mcp --mcp custom=https://my-tools.example/mcp "research task"
grok-agent --mcp wiki=https://mcp.deepwiki.com/mcp --mcp-allow wiki=search,read_page --mcp-desc wiki="Team wiki" "find release notes"
grok-agent mcp resources wiki
grok-agent mcp read wiki docs://release-notes
```

For local MCP resource inspection, bearer auth can be provided via `GROK_MCP_AUTH_<LABEL>` or `MCP_AUTH_<LABEL>` environment variables.

### Structured Output and JSON Mode

```bash
grok-agent --json-schema '{"type":"object","properties":{"files":{"type":"array","items":{"type":"string"}}}}' \
  "list the source files touched by session persistence"

grok-agent --json --ephemeral "say hi in one short sentence"
```

JSON mode emits one event per line on stdout. Memory-enabled runs can emit `memory.recalled` before the main turn when stored context is injected.

Common event types:

- `session.started`
- `memory.recalled`
- `turn.started`
- `turn.completed`
- `tool.called`
- `tool.result`
- `tool.persisted`
- `server_tool.called`
- `server_tool.usage`
- `citations`
- `subagent.started`
- `subagent.completed`
- `message`
- `error`
- `session.completed`

### Memory

```bash
grok-agent memory remember "CLI output preference" \
  --scope user \
  --type feedback \
  --description "Keep responses concise" \
  --body "Prefer concise, direct close-outs unless I ask for detail."

grok-agent memory list --scope all
grok-agent memory search concise
grok-agent memory show user:cli-output-preference.md

grok-agent --json --ephemeral "What response style should you prefer here?"
```

Memory is stored under your CLI data dir:

- `GROK_SESSION_DIR/memory/user`
- `GROK_SESSION_DIR/memory/projects/<project-slug>`

Each scope keeps a `MEMORY.md` index plus individual markdown files with frontmatter. New user turns automatically recall the most relevant memories. When semantic recall is enabled, Grok uses a fast side query to pick the strongest candidates and falls back to heuristic matching if that selection step fails.

The default CLI data dir is `~/.grok`. If you already have data in `~/.grok-cli` or `~/.grok-agent`, the CLI will copy it forward automatically the first time it needs the new default path.

### Collections

```bash
grok-agent collections list
grok-agent collections create "Engineering Docs"
grok-agent collections upload col_123 handbook.pdf
grok-agent collections search col_123 --filter 'team = "platform"' --limit 5 "on-call rotation policy"
grok-agent --collection col_123 --collection-filter 'team = "platform"' "summarize the deployment runbook"
```

Collection management requires `XAI_MANAGEMENT_API_KEY`.

### Tasks, Subagents, and Scheduling

```bash
grok-agent tasks list --session <id>
grok-agent tasks create --session <id> "Trace the config merge path"
grok-agent tasks update task-1 --session <id> --status in_progress --owner grok

grok-agent schedule create --at 2030-01-01T09:00:00-05:00 "review open TODOs"
grok-agent schedule create --cron "0 9 * * 1-5" "summarize overnight CI failures"
grok-agent schedule run-due
```

The agent can also use `todo_write`, `task_*`, and `spawn_subagent` internally during longer multi-step work.

### Batch + Realtime

```bash
grok-agent batch list --limit 20
grok-agent batch create nightly-evals
grok-agent batch create-jsonl requests.jsonl nightly-evals
grok-agent batch add-chat batch_123 "summarize this issue thread"
grok-agent batch results batch_123 --limit 10
grok-agent realtime secret --seconds 600
grok-agent realtime transcribe sample.wav
```

### Tokenization

```bash
grok-agent tokenize "fix the bug in approvals.ts"
grok-agent tokenize -m grok-code-fast-1 "class User { constructor() {} }"
```

## Sessions

Sessions are stored as JSONL files under:

- `GROK_SESSION_DIR/sessions`
- or `~/.grok/sessions` by default

Useful commands:

```bash
grok-agent sessions list
grok-agent sessions list --all
grok-agent sessions show <id>
grok-agent -r <id> "follow-up question"
grok-agent --fork <id> "continue on a new branch of thought"
grok-agent sessions archive <id>
grok-agent sessions unarchive <id>
grok-agent sessions rename <id> "better title"
grok-agent sessions rollback <id> --turns 1
grok-agent sessions compact <id>
grok-agent sessions clear
```

If you do not want any session state written, use:

```bash
grok-agent --ephemeral "one-off task"
```

## Configuration

Create a starter config file:

```bash
grok-agent config --init
```

That writes `config.json` under your session dir (`GROK_SESSION_DIR` or `~/.grok`).

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
  "memory": {
    "enabled": true,
    "auto_recall": true,
    "use_semantic_recall": true,
    "recall_limit": 3,
    "selector_model": "grok-4-1-fast-reasoning",
    "default_scope": "project"
  },
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
| `GROK_MODEL` | default model | `grok-4.20-0309-reasoning` |
| `GROK_SESSION_DIR` | base dir for sessions, config, and memory | `~/.grok` |
| `GROK_SANDBOX_MODE` | default sandbox mode | `danger-full-access` |
| `GROK_MEMORY_ENABLED` | enable or disable persistent memory | `true` |
| `GROK_MEMORY_AUTO_RECALL` | automatically inject relevant memory on new turns | `true` |
| `GROK_MEMORY_SELECTOR_MODEL` | fast model used for semantic memory selection | `grok-4-1-fast-reasoning` |

## Tools

### Local Tools

| Tool | Description |
|---|---|
| `bash` | Run shell commands |
| `ask_user_question` | Ask focused multiple-choice questions when a small clarification will unblock the task |
| `lsp` | TypeScript/JavaScript semantic navigation: definitions, references, hover, and symbols |
| `tool_search` | Discover the right local tool by capability instead of guessing names |
| `memory_search` | Search persistent long-term memory |
| `remember_memory` | Save long-term memory for future sessions |
| `forget_memory` | Delete stale or incorrect memory |
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
├── memory.ts            Persistent memory storage and recall
├── tasks.ts             File-backed task boards
├── schedules.ts         Scheduled prompt storage and cron logic
├── mcp-http.ts          Lightweight MCP resource client
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
├── tool-runner.ts       Shared local-tool orchestration
├── tool-result-storage.ts Persist oversized tool outputs to disk
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
    ├── ask-user-question.ts
    ├── bash.ts
    ├── lsp.ts
    ├── todo-write.ts
    ├── task-create.ts
    ├── task-list.ts
    ├── task-get.ts
    ├── task-update.ts
    ├── schedule-create.ts
    ├── schedule-list.ts
    ├── schedule-delete.ts
    ├── web-fetch.ts
    ├── notebook-edit.ts
    ├── mcp-list-resources.ts
    ├── mcp-read-resource.ts
    ├── spawn-subagent.ts
    ├── memory-search.ts
    ├── remember-memory.ts
    ├── forget-memory.ts
    ├── tool-search.ts
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
