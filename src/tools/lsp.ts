import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import ts from "typescript";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";
import { ensurePathAllowed } from "./policy.js";

type LspOperation =
  | "definition"
  | "references"
  | "hover"
  | "document_symbols"
  | "workspace_symbols";

type LspArgs = {
  operation: LspOperation;
  file_path?: string;
  line?: number;
  character?: number;
  query?: string;
};

const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);

function isSupportedFile(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function resolveFile(projectCwd: string, filePath: string | undefined): string | null {
  if (!filePath) return null;
  return path.resolve(projectCwd, filePath);
}

function findProjectRoot(projectCwd: string, filePath?: string): string {
  const searchFrom = filePath ? path.dirname(filePath) : projectCwd;
  const configPath = ts.findConfigFile(searchFrom, ts.sys.fileExists);
  return configPath ? path.dirname(configPath) : projectCwd;
}

function buildLanguageService(projectRoot: string): {
  service: ts.LanguageService;
  files: string[];
} {
  const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists);
  let compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX,
  };
  let files: string[] = [];

  if (configPath) {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => {},
      },
    );
    if (parsed) {
      compilerOptions = { ...compilerOptions, ...parsed.options };
      files = parsed.fileNames.filter(isSupportedFile);
    }
  }

  if (files.length === 0) {
    files = fg.sync(
      ["**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"],
      {
        cwd: projectRoot,
        absolute: true,
        dot: false,
        ignore: [
          "**/node_modules/**",
          "**/.git/**",
          "**/dist/**",
          "**/build/**",
          "**/.next/**",
          "**/coverage/**",
        ],
      },
    );
  }

  const versions = new Map<string, string>();
  const snapshots = new Map<string, ts.IScriptSnapshot | undefined>();

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getCurrentDirectory: () => projectRoot,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    getScriptFileNames: () => files,
    getScriptVersion: (fileName) => {
      try {
        const stat = fs.statSync(fileName);
        const version = String(stat.mtimeMs);
        versions.set(fileName, version);
        return version;
      } catch {
        return versions.get(fileName) || "0";
      }
    },
    getScriptSnapshot: (fileName) => {
      if (!fs.existsSync(fileName)) return undefined;
      const cached = snapshots.get(fileName);
      if (cached) return cached;
      const snapshot = ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, "utf-8"));
      snapshots.set(fileName, snapshot);
      return snapshot;
    },
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
  };

  return {
    service: ts.createLanguageService(host, ts.createDocumentRegistry()),
    files,
  };
}

function getPosition(sourceFile: ts.SourceFile, line?: number, character?: number): number | null {
  if (!line || !character) return null;
  const zeroLine = Math.max(0, line - 1);
  const zeroCharacter = Math.max(0, character - 1);
  if (zeroLine >= sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line + 1) {
    return null;
  }
  return sourceFile.getPositionOfLineAndCharacter(zeroLine, zeroCharacter);
}

function formatLocation(
  location: { fileName: string; textSpan: ts.TextSpan },
  root: string,
): string {
  const sourceText = fs.readFileSync(location.fileName, "utf-8");
  const sourceFile = ts.createSourceFile(location.fileName, sourceText, ts.ScriptTarget.Latest, true);
  const start = sourceFile.getLineAndCharacterOfPosition(location.textSpan.start);
  const lineText = sourceText.split("\n")[start.line] || "";
  return `${path.relative(root, location.fileName)}:${start.line + 1}:${start.character + 1}: ${lineText.trim()}`;
}

function formatNavigationTree(tree: ts.NavigationTree, depth = 0): string[] {
  const prefix = "  ".repeat(depth);
  const line = `${prefix}- ${tree.text}${tree.kind ? ` (${tree.kind})` : ""}`;
  const children = tree.childItems || [];
  return [
    line,
    ...children.flatMap((child) => formatNavigationTree(child, depth + 1)),
  ];
}

function findNodeAtPosition(node: ts.Node, position: number): ts.Node {
  const child = node.forEachChild((candidate) => {
    if (position >= candidate.getStart() && position < candidate.getEnd()) {
      return findNodeAtPosition(candidate, position);
    }
    return undefined;
  });
  return child || node;
}

export async function executeLsp(args: LspArgs, projectCwd: string, options: ToolExecutionOptions): Promise<ToolResult> {
  const filePath = resolveFile(projectCwd, args.file_path);
  const sandboxTarget = filePath || projectCwd;
  const sandboxError = ensurePathAllowed(
    sandboxTarget,
    projectCwd,
    options.sandboxMode || "danger-full-access",
    "read",
    options.allowedReadRoots,
  );
  if (sandboxError) return sandboxError;

  if (filePath) {
    if (!fs.existsSync(filePath)) {
      return { output: `File not found: ${filePath}`, error: true };
    }
    if (!isSupportedFile(filePath)) {
      return {
        output: `Unsupported file type for lsp: ${path.extname(filePath) || "(none)"}`,
        error: true,
      };
    }
  }

  const projectRoot = findProjectRoot(projectCwd, filePath || undefined);
  const { service } = buildLanguageService(projectRoot);

  try {
    if (args.operation === "workspace_symbols") {
      const query = args.query || "";
      const items = service.getNavigateToItems(query);
      if (items.length === 0) {
        return { output: `No workspace symbols found for "${query}".` };
      }
      const lines = items.slice(0, 100).map((item) => {
        const location = item.fileName
          ? `${path.relative(projectRoot, item.fileName)}`
          : "(unknown)";
        return `${item.name} (${item.kind}) — ${item.containerName || "global"} — ${location}`;
      });
      return { output: lines.join("\n") };
    }

    if (!filePath) {
      return { output: `lsp operation "${args.operation}" requires file_path.`, error: true };
    }

    const program = service.getProgram();
    const sourceFile = program?.getSourceFile(filePath);
    if (!sourceFile) {
      return { output: `Unable to open ${filePath} in the TypeScript language service.`, error: true };
    }

    if (args.operation === "document_symbols") {
      const tree = service.getNavigationTree(filePath);
      if (!(tree.childItems || []).length) {
        return { output: `No document symbols found in ${path.relative(projectRoot, filePath)}.` };
      }
      return { output: formatNavigationTree(tree).join("\n") };
    }

    const position = getPosition(sourceFile, args.line, args.character);
    if (position == null) {
      return {
        output: `lsp operation "${args.operation}" requires valid line and character values.`,
        error: true,
      };
    }

    if (args.operation === "hover") {
      const info = service.getQuickInfoAtPosition(filePath, position);
      if (!info) {
        return { output: "No hover information available." };
      }
      const signature = ts.displayPartsToString(info.displayParts || []);
      const docs = ts.displayPartsToString(info.documentation || []);
      const body = docs ? `${signature}\n\n${docs}` : signature;
      return { output: body || "No hover information available." };
    }

    if (args.operation === "definition") {
      let definitions: Array<{ fileName: string; textSpan: ts.TextSpan }> =
        Array.from(service.getDefinitionAtPosition(filePath, position) || []);
      const checker = program?.getTypeChecker();
      const node = checker ? findNodeAtPosition(sourceFile, position) : null;
      const signatureDeclaration =
        node &&
        checker &&
        ts.isIdentifier(node) &&
        ts.isCallExpression(node.parent) &&
        node.parent.expression === node
          ? checker.getResolvedSignature(node.parent)?.getDeclaration()
          : undefined;
      const symbol = node && checker ? checker.getSymbolAtLocation(node) : undefined;
      const aliasedSymbol =
        symbol && checker && (symbol.flags & ts.SymbolFlags.Alias)
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      const declarations = [
        ...(signatureDeclaration ? [signatureDeclaration] : []),
        ...(aliasedSymbol?.getDeclarations() || []),
      ];
      if (declarations.length > 0) {
        const resolvedDefinitions = declarations.map((declaration) => ({
          fileName: declaration.getSourceFile().fileName,
          textSpan: {
            start: declaration.getStart(),
            length: declaration.getWidth(),
          },
        }));
        const crossFile = resolvedDefinitions.filter(
          (item) => path.resolve(item.fileName) !== path.resolve(filePath),
        );
        if (crossFile.length > 0) {
          definitions = crossFile;
        } else if (definitions.length === 0) {
          definitions = resolvedDefinitions;
        }
      }
      if (definitions.length === 0) {
        return { output: "No definition found." };
      }
      const preferred = definitions.filter((item) => path.resolve(item.fileName) !== path.resolve(filePath));
      const filtered = preferred.length > 0 ? preferred : definitions;
      return {
        output: filtered.slice(0, 50).map((item) => formatLocation(item, projectRoot)).join("\n"),
      };
    }

    if (args.operation === "references") {
      const references = service.getReferencesAtPosition(filePath, position) || [];
      if (references.length === 0) {
        return { output: "No references found." };
      }
      return {
        output: references.slice(0, 100).map((item) => formatLocation(item, projectRoot)).join("\n"),
      };
    }

    return { output: `Unsupported lsp operation: ${args.operation}`, error: true };
  } catch (err: any) {
    return {
      output: `LSP error: ${err.message}`,
      error: true,
    };
  } finally {
    service.dispose();
  }
}
