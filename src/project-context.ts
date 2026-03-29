import fs from "node:fs";
import path from "node:path";

const CONTEXT_FILES = ["GROK.md", ".grokrc", "grok.md", ".grok/context.md"];

/**
 * Search for project context files (like CLAUDE.md) in the working directory
 * and parent directories up to 3 levels.
 */
export function loadProjectContext(cwd: string): string | null {
  const found: string[] = [];

  // Search cwd and up to 3 parent dirs
  let dir = cwd;
  for (let i = 0; i < 4; i++) {
    for (const name of CONTEXT_FILES) {
      const filePath = path.join(dir, name);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, "utf-8").trim();
          if (content) {
            found.push(`# Project Context (from ${path.relative(cwd, filePath) || name})\n\n${content}`);
          }
        } catch { /* skip unreadable */ }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (found.length === 0) return null;
  return found.join("\n\n---\n\n");
}
