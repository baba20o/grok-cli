import fs from "node:fs";
import path from "node:path";
import type { ToolResult } from "../types.js";
import { showDiff } from "../diff.js";
import type { ToolExecutionOptions } from "./index.js";
import { ensurePathAllowed } from "./policy.js";

let showDiffsEnabled = true;
export function setShowDiffs(enabled: boolean): void { showDiffsEnabled = enabled; }

export async function executeEditFile(args: {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}, projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  const filePath = path.resolve(projectCwd, args.file_path);
  const sandboxError = ensurePathAllowed(
    filePath,
    projectCwd,
    options.sandboxMode || "danger-full-access",
    "write",
    options.allowedReadRoots,
  );
  if (sandboxError) return sandboxError;

  try {
    if (!fs.existsSync(filePath)) {
      return { output: `File not found: ${filePath}`, error: true };
    }

    const content = fs.readFileSync(filePath, "utf-8");

    if (args.old_string === args.new_string) {
      return { output: "old_string and new_string are identical, no changes made.", error: true };
    }

    if (!content.includes(args.old_string)) {
      // Help debug: show similar lines
      const searchLines = args.old_string.split("\n");
      const firstLine = searchLines[0].trim();
      const contentLines = content.split("\n");
      const similar = contentLines
        .map((line, i) => ({ line: line.trim(), num: i + 1 }))
        .filter(({ line }) => line.includes(firstLine.slice(0, 30)))
        .slice(0, 3);

      let msg = `old_string not found in ${args.file_path}.`;
      if (similar.length > 0) {
        msg += "\n\nSimilar lines found:\n" +
          similar.map(s => `  Line ${s.num}: ${s.line}`).join("\n");
        msg += "\n\nCheck indentation and whitespace — they must match exactly.";
      }

      return { output: msg, error: true };
    }

    if (!args.replace_all) {
      // Check uniqueness
      const count = content.split(args.old_string).length - 1;
      if (count > 1) {
        return {
          output: `old_string matches ${count} locations in ${args.file_path}. Provide more context to match uniquely, or set replace_all: true.`,
          error: true,
        };
      }
    }

    let updated: string;
    if (args.replace_all) {
      updated = content.split(args.old_string).join(args.new_string);
    } else {
      const idx = content.indexOf(args.old_string);
      updated = content.slice(0, idx) + args.new_string + content.slice(idx + args.old_string.length);
    }

    fs.writeFileSync(filePath, updated, "utf-8");

    // Show diff
    if (showDiffsEnabled) {
      showDiff(args.file_path, content, updated);
    }

    const oldLines = args.old_string.split("\n").length;
    const newLines = args.new_string.split("\n").length;
    const diffSummary = oldLines === newLines
      ? `${oldLines} line(s) modified`
      : `${oldLines} line(s) → ${newLines} line(s)`;

    return {
      output: `Edited ${args.file_path}: ${diffSummary}${args.replace_all ? " (all occurrences)" : ""}`,
    };
  } catch (err: any) {
    return { output: `Error editing file: ${err.message}`, error: true };
  }
}
