# Changelog

All notable changes to grok-cli will be documented in this file.

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
