/**
 * Terminal notification system.
 * Uses OSC9 (modern terminals) or BEL (fallback) to notify when tasks complete.
 */

export function notify(title: string, body?: string): void {
  const term = process.env.TERM_PROGRAM || "";
  const wt = process.env.WT_SESSION; // Windows Terminal

  if (wt) {
    // Windows Terminal supports BEL
    process.stderr.write("\x07");
  } else if (
    term.includes("WezTerm") ||
    term.includes("iTerm") ||
    term.includes("Ghostty") ||
    term.includes("kitty")
  ) {
    // OSC9 notification (title only for most terminals)
    const msg = body ? `${title}: ${body}` : title;
    process.stderr.write(`\x1b]9;${msg}\x07`);
  } else {
    // Fallback: BEL character (audible bell)
    process.stderr.write("\x07");
  }
}
