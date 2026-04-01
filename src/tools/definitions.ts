import type { ToolDef } from "../types.js";

export interface ToolCapabilities {
  readOnly: boolean;
  concurrencySafe: boolean;
}

export const toolCapabilities: Record<string, ToolCapabilities> = {
  bash: { readOnly: false, concurrencySafe: false },
  ask_user_question: { readOnly: true, concurrencySafe: false },
  lsp: { readOnly: true, concurrencySafe: true },
  tool_search: { readOnly: true, concurrencySafe: true },
  memory_search: { readOnly: true, concurrencySafe: true },
  remember_memory: { readOnly: false, concurrencySafe: false },
  forget_memory: { readOnly: false, concurrencySafe: false },
  read_file: { readOnly: true, concurrencySafe: true },
  write_file: { readOnly: false, concurrencySafe: false },
  edit_file: { readOnly: false, concurrencySafe: false },
  glob: { readOnly: true, concurrencySafe: true },
  grep: { readOnly: true, concurrencySafe: true },
  list_directory: { readOnly: true, concurrencySafe: true },
};

export const toolDefinitions: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "tool_search",
      description:
        "Search available local tools by capability when you are unsure about the exact tool name. " +
        "Use this instead of guessing unknown tool names.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Keywords describing the capability you need.",
          },
          max_results: {
            type: "number",
            description: "Maximum number of matching tools to return.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_search",
      description:
        "Search long-term persistent memory from previous sessions. " +
        "Use this when stored preferences, feedback, or project facts may matter.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Keywords describing the memory you want to find.",
          },
          scope: {
            type: "string",
            enum: ["project", "user", "all"],
            description: "Which memory scope to search. Default: all.",
          },
          limit: {
            type: "number",
            description: "Maximum number of results to return.",
          },
          include_content: {
            type: "boolean",
            description: "Include a short content preview for each result.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_memory",
      description:
        "Save durable long-term memory for future sessions. " +
        "Use for user preferences, collaboration feedback, durable project facts, and important gotchas.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short title for the memory.",
          },
          description: {
            type: "string",
            description: "One-line summary for the memory index.",
          },
          content: {
            type: "string",
            description: "Detailed memory content to save.",
          },
          type: {
            type: "string",
            enum: ["user", "feedback", "project", "reference"],
            description: "Memory type.",
          },
          scope: {
            type: "string",
            enum: ["project", "user"],
            description: "Where to store the memory. Default comes from config.",
          },
          id: {
            type: "string",
            description: "Existing memory id to update instead of creating a new one.",
          },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget_memory",
      description:
        "Delete a stored memory that is stale, incorrect, or no longer wanted.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Memory id, relative path, or title to remove.",
          },
          scope: {
            type: "string",
            enum: ["project", "user", "all"],
            description: "Limit the deletion lookup to a specific scope.",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user_question",
      description:
        "Ask the user one or more focused multiple-choice questions when a decision is ambiguous. " +
        "Use this instead of guessing when a small clarification will unblock the task.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            description: "Questions to ask the user.",
            items: {
              type: "object",
              properties: {
                header: {
                  type: "string",
                  description: "Short label for the question.",
                },
                question: {
                  type: "string",
                  description: "The question to present to the user.",
                },
                multi_select: {
                  type: "boolean",
                  description: "Allow selecting multiple options.",
                },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: {
                        type: "string",
                        description: "Short user-facing option label.",
                      },
                      description: {
                        type: "string",
                        description: "Short explanation of the option.",
                      },
                    },
                    required: ["label"],
                  },
                },
              },
              required: ["question", "options"],
            },
          },
        },
        required: ["questions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lsp",
      description:
        "Use TypeScript/JavaScript code intelligence to find definitions, references, hover info, and symbols. " +
        "Prefer this over grep when you need semantic code navigation.",
      parameters: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: ["definition", "references", "hover", "document_symbols", "workspace_symbols"],
            description: "The semantic code navigation operation to run.",
          },
          file_path: {
            type: "string",
            description: "Path to the source file for file-based operations.",
          },
          line: {
            type: "number",
            description: "1-based line number for symbol-position operations.",
          },
          character: {
            type: "number",
            description: "1-based character number for symbol-position operations.",
          },
          query: {
            type: "string",
            description: "Search query for workspace_symbols.",
          },
        },
        required: ["operation"],
      },
    },
  },
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

export function searchToolDefinitions(query: string, maxResults = 5): Array<{ name: string; description: string }> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  const scored = toolDefinitions.map((tool) => {
    const fn = (tool as any).function;
    const name = String(fn?.name || "");
    const description = String(fn?.description || "");
    const haystack = `${name} ${description}`.toLowerCase();

    let score = 0;
    if (name === normalizedQuery) score += 100;
    if (name.includes(normalizedQuery)) score += 40;
    if (description.toLowerCase().includes(normalizedQuery)) score += 25;
    for (const term of terms) {
      if (name.includes(term)) score += 15;
      if (haystack.includes(term)) score += 5;
    }

    return { name, description, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, maxResults)
    .map(({ name, description }) => ({ name, description }));
}
