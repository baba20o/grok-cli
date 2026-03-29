#!/usr/bin/env node

// Entry point — delegates to compiled TypeScript or tsx in development
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distEntry = join(__dirname, "..", "dist", "index.js");
const srcEntry = join(__dirname, "..", "src", "index.ts");

if (existsSync(distEntry)) {
  // Production: run compiled JS — use file:// URL for Windows compatibility
  await import(pathToFileURL(distEntry).href);
} else {
  // Development: run via tsx
  const { execFileSync } = await import("node:child_process");
  try {
    execFileSync("npx", ["tsx", srcEntry, ...process.argv.slice(2)], {
      stdio: "inherit",
      cwd: process.cwd(),
    });
  } catch (err) {
    process.exit(err.status || 1);
  }
}
