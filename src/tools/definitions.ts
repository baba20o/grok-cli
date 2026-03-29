import type { ToolDef } from "../types.js";

export const toolDefinitions: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "bash",
      description:
        "Execute a shell command and return its stdout/stderr. " +
        "Use for running builds, tests, git commands, package managers, and system utilities. " +
        "Commands run in the user's working directory. " +
        "Avoid interactive commands (vim, less, etc). Prefer non-interactive flags.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute",
          },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds (default: 30000, max: 300000)",
          },
          cwd: {
            type: "string",
            description: "Working directory for the command. Defaults to the project root.",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a file. Returns the file content with line numbers. " +
        "Use offset and limit to read specific portions of large files.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute or relative path to the file",
          },
          offset: {
            type: "number",
            description: "Line number to start reading from (1-based). Default: 1",
          },
          limit: {
            type: "number",
            description: "Maximum number of lines to read. Default: 2000",
          },
        },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or overwrite a file with the given content. " +
        "Creates parent directories if they don't exist. " +
        "Use edit_file for targeted modifications to existing files instead.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute or relative path for the file",
          },
          content: {
            type: "string",
            description: "The full content to write to the file",
          },
        },
        required: ["file_path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Make a targeted edit to a file by replacing an exact string match. " +
        "You MUST read the file first before editing. " +
        "The old_string must match exactly (including indentation/whitespace). " +
        "Provide enough surrounding context in old_string to ensure a unique match. " +
        "If the match is not unique, the edit will fail.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the file to edit",
          },
          old_string: {
            type: "string",
            description: "The exact string to find and replace. Must be unique in the file.",
          },
          new_string: {
            type: "string",
            description: "The string to replace old_string with",
          },
          replace_all: {
            type: "boolean",
            description: "If true, replace all occurrences. Default: false (replace first match only)",
          },
        },
        required: ["file_path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob",
      description:
        "Find files matching a glob pattern. Returns matching file paths. " +
        'Supports patterns like "**/*.ts", "src/**/*.test.js", "*.json".',
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: 'Glob pattern to match (e.g., "**/*.ts", "src/**/*.js")',
          },
          cwd: {
            type: "string",
            description: "Directory to search from. Defaults to project root.",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description:
        "Search file contents using a regex pattern. Returns matching lines with file paths and line numbers. " +
        "Use the include glob to filter which files to search.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex pattern to search for",
          },
          path: {
            type: "string",
            description: "File or directory to search in. Defaults to project root.",
          },
          include: {
            type: "string",
            description: 'Glob pattern to filter files (e.g., "*.ts", "*.py")',
          },
          ignore_case: {
            type: "boolean",
            description: "Case insensitive search. Default: false",
          },
          max_results: {
            type: "number",
            description: "Maximum number of matching lines to return. Default: 100",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description:
        "List files and directories at a given path. Returns names with type indicators (/ for directories). " +
        "Use this to explore the project structure.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path to list. Defaults to project root.",
          },
          recursive: {
            type: "boolean",
            description: "If true, list recursively up to 3 levels deep. Default: false",
          },
        },
      },
    },
  },
];
