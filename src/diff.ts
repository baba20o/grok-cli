import chalk from "chalk";

/**
 * Generate and display a simple unified diff between old and new content.
 */
export function showDiff(filePath: string, oldContent: string, newContent: string): void {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  console.error(chalk.dim(`--- a/${filePath}`));
  console.error(chalk.dim(`+++ b/${filePath}`));

  // Simple line-by-line diff (not optimal but clear)
  const maxLen = Math.max(oldLines.length, newLines.length);
  let inHunk = false;
  let hunkStart = -1;
  const hunks: { start: number; lines: string[] }[] = [];
  let currentHunk: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (oldLine === newLine) {
      if (inHunk) {
        // Context line after changes
        currentHunk.push(` ${oldLine}`);
        if (currentHunk.filter(l => l.startsWith("+") || l.startsWith("-")).length > 0) {
          // Close hunk after 2 context lines
          const remaining = currentHunk.slice(-2).every(l => l.startsWith(" "));
          if (remaining && currentHunk.length > 6) {
            hunks.push({ start: hunkStart, lines: currentHunk });
            currentHunk = [];
            inHunk = false;
          }
        }
      }
    } else {
      if (!inHunk) {
        inHunk = true;
        hunkStart = Math.max(0, i - 2);
        // Add up to 2 context lines before
        for (let j = Math.max(0, i - 2); j < i; j++) {
          if (j < oldLines.length) currentHunk.push(` ${oldLines[j]}`);
        }
      }

      if (oldLine !== undefined && newLine !== undefined) {
        currentHunk.push(`-${oldLine}`);
        currentHunk.push(`+${newLine}`);
      } else if (oldLine !== undefined) {
        currentHunk.push(`-${oldLine}`);
      } else if (newLine !== undefined) {
        currentHunk.push(`+${newLine}`);
      }
    }
  }

  if (currentHunk.length > 0) {
    hunks.push({ start: hunkStart, lines: currentHunk });
  }

  // Display hunks
  for (const hunk of hunks) {
    const removed = hunk.lines.filter(l => l.startsWith("-")).length;
    const added = hunk.lines.filter(l => l.startsWith("+")).length;
    console.error(chalk.cyan(`@@ -${hunk.start + 1},${removed} +${hunk.start + 1},${added} @@`));

    for (const line of hunk.lines.slice(0, 30)) { // Cap display
      if (line.startsWith("+")) {
        console.error(chalk.green(line));
      } else if (line.startsWith("-")) {
        console.error(chalk.red(line));
      } else {
        console.error(chalk.dim(line));
      }
    }

    if (hunk.lines.length > 30) {
      console.error(chalk.dim(`  ... ${hunk.lines.length - 30} more lines`));
    }
  }
}
