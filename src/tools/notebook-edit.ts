import fs from "node:fs";
import path from "node:path";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";
import { ensurePathAllowed } from "./policy.js";

type NotebookCell = {
  cell_type: "code" | "markdown" | "raw";
  source: string[] | string;
  metadata?: Record<string, unknown>;
};

type NotebookDocument = {
  cells: NotebookCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
};

type NotebookArgs = {
  operation: "list_cells" | "read_cell" | "replace_cell" | "append_cell" | "delete_cell";
  notebook_path: string;
  cell_index?: number;
  cell_type?: "code" | "markdown" | "raw";
  source?: string;
};

function cellSourceToString(source: string[] | string): string {
  return Array.isArray(source) ? source.join("") : source;
}

function toCellSource(source: string): string[] {
  return source.split("\n").map((line, index, all) => (index < all.length - 1 ? `${line}\n` : line));
}

function readNotebook(filePath: string): NotebookDocument {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as NotebookDocument;
}

function writeNotebook(filePath: string, notebook: NotebookDocument): void {
  fs.writeFileSync(filePath, JSON.stringify(notebook, null, 2) + "\n", "utf-8");
}

function describeCell(cell: NotebookCell, index: number): string {
  const preview = cellSourceToString(cell.source).replace(/\s+/g, " ").trim().slice(0, 80);
  return `${index}: ${cell.cell_type}${preview ? ` - ${preview}` : ""}`;
}

export async function executeNotebookEdit(
  args: NotebookArgs,
  projectCwd: string,
  options: ToolExecutionOptions,
): Promise<ToolResult> {
  const filePath = path.resolve(projectCwd, args.notebook_path);
  const access = args.operation === "list_cells" || args.operation === "read_cell" ? "read" : "write";
  const sandboxError = ensurePathAllowed(
    filePath,
    projectCwd,
    options.sandboxMode || "danger-full-access",
    access,
    options.allowedReadRoots,
  );
  if (sandboxError) return sandboxError;

  if (!fs.existsSync(filePath)) {
    return { output: `Notebook not found: ${filePath}`, error: true };
  }
  if (path.extname(filePath).toLowerCase() !== ".ipynb") {
    return { output: `Notebook tool only supports .ipynb files: ${filePath}`, error: true };
  }

  const notebook = readNotebook(filePath);
  const cells = notebook.cells || [];

  if (args.operation === "list_cells") {
    if (cells.length === 0) return { output: `Notebook has no cells: ${filePath}` };
    return { output: cells.map((cell, index) => describeCell(cell, index)).join("\n") };
  }

  const index = args.cell_index;
  const target = index !== undefined ? cells[index] : undefined;

  if (args.operation === "read_cell") {
    if (index === undefined || !target) {
      return { output: "read_cell requires a valid cell_index.", error: true };
    }
    return {
      output: [
        `Notebook: ${filePath}`,
        `Cell: ${index} (${target.cell_type})`,
        "",
        cellSourceToString(target.source),
      ].join("\n"),
    };
  }

  if (args.operation === "replace_cell") {
    if (index === undefined || !target) {
      return { output: "replace_cell requires a valid cell_index.", error: true };
    }
    if (typeof args.source !== "string") {
      return { output: "replace_cell requires source.", error: true };
    }
    target.source = toCellSource(args.source);
    if (args.cell_type) target.cell_type = args.cell_type;
    writeNotebook(filePath, notebook);
    return { output: `Replaced cell ${index} in ${filePath}` };
  }

  if (args.operation === "append_cell") {
    if (typeof args.source !== "string") {
      return { output: "append_cell requires source.", error: true };
    }
    const cell: NotebookCell = {
      cell_type: args.cell_type || "code",
      source: toCellSource(args.source),
      metadata: {},
    };
    notebook.cells = [...cells, cell];
    writeNotebook(filePath, notebook);
    return { output: `Appended ${cell.cell_type} cell ${notebook.cells.length - 1} to ${filePath}` };
  }

  if (args.operation === "delete_cell") {
    if (index === undefined || !target) {
      return { output: "delete_cell requires a valid cell_index.", error: true };
    }
    notebook.cells = cells.filter((_, cellIndex) => cellIndex !== index);
    writeNotebook(filePath, notebook);
    return { output: `Deleted cell ${index} from ${filePath}` };
  }

  return { output: `Unknown notebook operation: ${args.operation}`, error: true };
}
