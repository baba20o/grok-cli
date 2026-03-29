# Changelog

All notable changes to grok-cli will be documented in this file.

## [0.4.0] - 2026-03-29

### Added

- **JSONL output mode** (`--json`): Machine-readable event streaming on stdout. Events: `session.started`, `turn.started`, `turn.completed`, `tool.called`, `tool.result`, `message`, `error`. Perfect for CI/automation pipelines.
- **Ephemeral mode** (`--ephemeral`): Run without saving session to disk.
- **Output file** (`-o, --output <file>`): Write final assistant message to a file.
- **YOLO mode** (`--yolo`): Skip all approval prompts (for trusted environments).
- **Color control** (`--color auto|always|never`): Override terminal color detection.
- **Output truncation**: Tool outputs automatically truncated to prevent context window blowup. Preserves beginning and end, inserts omission notice.
- **Context compaction**: When conversations exceed ~100k tokens, automatically summarizes older messages into a handoff brief and continues with fresh context.
- **Fingerprint tracking**: Captures `system_fingerprint` from API responses (shown in verbose mode) for backend drift detection.
- **Test suite**: 20 tests across tools (bash, read/write/edit, glob, grep, list_dir), sessions (create, load, update, delete, fork), and truncation. Uses Node.js native test runner.
- **Proper exit codes**: Exit 1 on fatal errors for automation-friendly signaling.

### Changed

- Tool executor now applies output truncation before returning results.
- Agent loop checks for context window limits and auto-compacts mid-session.
- JSONL mode suppresses human-readable stdout output, keeping stderr for status.

## [0.3.0] - 2026-03-29

### Added

- **`grok-cli models`**: List all available models from `/v1/models`. `models info <id>` for details.
- **`grok-cli doctor`**: Diagnostics — validates API key, shows permissions, checks config and project context.
- **`grok-cli config`**: Configuration management. `config --init` creates `~/.grok-cli/config.json` with defaults.
- **`grok-cli tokenize`**: Count tokens via xAI's tokenizer API. Estimate costs before running.
- **`grok-cli generate-video`** / **`video`**: Generate videos with `grok-imagine-video` (1-15s, multiple aspect ratios).
- **`grok-cli speak`** / **`tts`**: Text-to-speech with 4 voices (eve, ara, sal, rex). Output to file or stdout.
- **`grok-cli collections`**: Manage persistent document collections for RAG (list, create).
- **Approval system**: `--approve` prompts before writes/exec. `--deny-writes` blocks them entirely. Approvals cached per session.
- **Config file**: `~/.grok-cli/config.json` for persistent settings (model, approval policy, MCP servers, hooks, etc.).
- **Project context files**: Automatically loads `GROK.md` or `.grokrc` from the project directory into the system prompt. Like CLAUDE.md for Grok.
- **Diff display**: File edits show unified diffs with red/green coloring. Disable with `--no-diffs`.
- **Prompt cache routing**: `x-grok-conv-id` header for sticky server routing — cached tokens cost 10x less.
- **Plan mode**: `--plan` makes Grok create a step-by-step plan before executing.
- **Session fork**: `--fork <id>` copies a session's history into a new session for branching exploration.
- **Desktop notifications**: `--notify` triggers terminal notification (OSC9/BEL) when tasks complete.
- **Hooks system**: Pre/post tool-use hooks configured in `config.json`. Run custom scripts on tool execution.
- **Deferred completions**: `--defer` fires a request and returns a poll ID immediately (non-blocking).

## [0.2.0] - 2026-03-29

### Added

- **Remote MCP tools**: `--mcp <url>` connects to any MCP server (DeepWiki, custom tools). xAI handles the connection server-side.
- **Multi-agent research**: `--research` flag uses `grok-4.20-multi-agent` with 4-16 collaborating agents for deep research tasks.
- **Image understanding**: `--image <path>` attaches images (screenshots, diagrams, errors) for Grok to analyze. Supports local files and URLs.
- **Image generation**: `generate-image` / `imagine` subcommand creates images via `grok-imagine-image` and `grok-imagine-image-pro`.
- **grok-code-fast-1**: `--code` flag selects the specialized coding model (4x faster, 1/10th cost, optimized for tool-heavy agentic work).
- **File attachments**: `--attach <file>` uploads files (PDFs, docs, CSVs) to xAI for Grok to search and reference.
- **Pipe mode**: `echo "prompt" | grok-cli` reads from stdin when piped. Combine with `cat`, `git diff`, etc.
- **Token usage tracking**: `--show-usage` displays input/output/reasoning/cached token counts and estimated cost.
- **Citation display**: Web search and X search results show source URLs. Disable with `--no-citations`.
- **Structured outputs**: `--json-schema <schema>` forces Grok to return valid JSON matching the provided schema.
- **Prompt cache optimization**: System prompt and tool definitions kept stable across turns to maximize xAI's automatic caching (cached tokens 10x cheaper).
- **Dynamic system prompt**: System prompt now describes available capabilities (server-side tools, MCP servers, attached files/images).
- **Interactive `/usage` command**: Check accumulated token usage during a REPL session.

### Changed

- Bumped version to 0.2.0.
- Responses API is now auto-selected when any advanced feature is enabled (server-side tools, MCP, file attachments).
- Agent loop supports both chat.completions (streaming, default) and Responses API (advanced features) with automatic fallback.

## [0.1.0] - 2026-03-29

### Added

- Initial release of grok-cli.
- **Exec mode**: run a prompt non-interactively (`grok-cli "prompt"`).
- **Interactive REPL**: multi-turn conversations with `grok-cli`.
- **Streaming**: real-time response output via SSE.
- **7 local tools**: bash, read_file, write_file, edit_file, glob, grep, list_directory.
- **Agent tool loop**: Grok autonomously calls tools, executes locally, feeds results back.
- **Session persistence**: JSONL files in `~/.grok-cli/sessions/`.
- **Session resume**: `-r <session-id>` to continue any previous session.
- **Session management**: `sessions list`, `sessions show`, `sessions delete`, `sessions clear`.
- **Model selection**: `--fast`, `--reasoning`, `--non-reasoning` flags.
- **xAI Responses API**: stateful multi-turn with `previous_response_id`.
- **xAI server-side tools**: `--web-search`, `--x-search`, `--code-execution`.
- **Rate limit handling**: automatic retry with backoff on 429 errors.
- **Global install**: `npm link` for system-wide `grok-cli` command.
- **Windows support**: file:// URL handling for ESM on Windows.
