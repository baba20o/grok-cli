import fs from "node:fs";
import path from "node:path";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";
import { ensurePathAllowed } from "./policy.js";

export async function executeWriteFile(args: {
  file_path: string;
  content: string;
}, projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  const filePath = path.resolve(projectCwd, args.file_path);
  const sandboxError = ensurePathAllowed(filePath, projectCwd, options.sandboxMode || "danger-full-access", "write");
  if (sandboxError) return sandboxError;

  // Safety: block writing to sensitive paths
  const basename = path.basename(filePath).toLowerCase();
  const sensitiveFiles = [".env", "credentials.json", "secrets.json", ".npmrc"];
  if (sensitiveFiles.some(s => basename === s || basename.startsWith(".env"))) {
    return {
      output: `Refusing to write to sensitive file: ${basename}. This could expose secrets.`,
      error: true,
    };
  }

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const existed = fs.existsSync(filePath);
    fs.writeFileSync(filePath, args.content, "utf-8");

    const lines = args.content.split("\n").length;
    const bytes = Buffer.byteLength(args.content, "utf-8");

    return {
      output: `${existed ? "Updated" : "Created"} ${args.file_path} (${lines} lines, ${bytes} bytes)`,
    };
  } catch (err: any) {
    return { output: `Error writing file: ${err.message}`, error: true };
  }
}
