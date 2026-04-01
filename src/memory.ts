import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "./client.js";
import type {
  GrokConfig,
  MemoryEntry,
  MemoryRecallResult,
  MemoryScope,
  MemoryType,
} from "./types.js";

export const MEMORY_INDEX_NAME = "MEMORY.md";

const MEMORY_TYPES = new Set<MemoryType>(["user", "feedback", "project", "reference"]);
const MEMORY_SCOPES: MemoryScope[] = ["user", "project"];
const INDEX_LINE_LIMIT = 120;
const INDEX_BYTE_LIMIT = 12_000;
const BODY_SNIPPET_LIMIT = 1_400;
const MAX_SELECTOR_CANDIDATES = 24;
const MEMORY_QUERY_STOPWORDS = new Set([
  "about",
  "also",
  "does",
  "from",
  "give",
  "have",
  "into",
  "just",
  "make",
  "only",
  "please",
  "reply",
  "should",
  "tell",
  "that",
  "their",
  "them",
  "there",
  "these",
  "this",
  "those",
  "using",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
  "your",
]);

type SearchOptions = {
  scope?: MemoryScope | "all";
  limit?: number;
};

type RememberMemoryInput = {
  title: string;
  description?: string;
  content: string;
  type?: MemoryType;
  scope?: MemoryScope;
  id?: string;
};

function normalizeSlashes(value: string): string {
  return value.split(path.sep).join("/");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function shortHash(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function safeMemoryType(value: string | undefined, fallback: MemoryType): MemoryType {
  if (value && MEMORY_TYPES.has(value as MemoryType)) return value as MemoryType;
  return fallback;
}

function parseFrontmatter(raw: string): { fields: Record<string, string>; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { fields: {}, body: normalized.trim() };
  }

  const lines = normalized.split("\n");
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) {
    return { fields: {}, body: normalized.trim() };
  }

  const fields: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) fields[key] = value;
  }

  return {
    fields,
    body: lines.slice(end + 1).join("\n").trim(),
  };
}

function serializeFrontmatter(fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return ["---", ...lines, "---", ""].join("\n");
}

function walkMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === MEMORY_INDEX_NAME) continue;
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(absolutePath);
    }
  }

  return files;
}

function buildMemoryId(scope: MemoryScope, relativePath: string): string {
  return `${scope}:${normalizeSlashes(relativePath)}`;
}

function defaultMemoryType(scope: MemoryScope): MemoryType {
  return scope === "user" ? "user" : "project";
}

function toEntry(filePath: string, rootDir: string, scope: MemoryScope): MemoryEntry | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { fields, body } = parseFrontmatter(raw);
    const stat = fs.statSync(filePath);
    const relativePath = normalizeSlashes(path.relative(rootDir, filePath));
    const title = fields.title || path.basename(relativePath, ".md");
    const description =
      fields.description ||
      body.split("\n").map((line) => line.trim()).find(Boolean) ||
      title;
    const updated = fields.updated || new Date(stat.mtimeMs).toISOString();
    const created = fields.created || updated;

    return {
      id: buildMemoryId(scope, relativePath),
      scope,
      type: safeMemoryType(fields.type, defaultMemoryType(scope)),
      title,
      description,
      filePath,
      relativePath,
      created,
      updated,
      content: body,
    };
  } catch {
    return null;
  }
}

function resolveScopes(scope: MemoryScope | "all" = "all"): MemoryScope[] {
  return scope === "all" ? MEMORY_SCOPES : [scope];
}

function clampRecallLimit(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 3;
  return Math.min(Math.max(Math.floor(value), 1), 8);
}

function truncateIndex(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  let output = trimmed.split("\n").slice(0, INDEX_LINE_LIMIT).join("\n");
  if (Buffer.byteLength(output, "utf-8") > INDEX_BYTE_LIMIT) {
    while (Buffer.byteLength(output, "utf-8") > INDEX_BYTE_LIMIT) {
      const next = output.lastIndexOf("\n");
      output = next > 0 ? output.slice(0, next) : output.slice(0, INDEX_BYTE_LIMIT);
    }
  }
  return output.trim();
}

function readIndex(indexPath: string): string | null {
  if (!fs.existsSync(indexPath)) return null;
  try {
    const content = truncateIndex(fs.readFileSync(indexPath, "utf-8"));
    return content || null;
  } catch {
    return null;
  }
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function findExistingByTitle(entries: MemoryEntry[], title: string, scope: MemoryScope): MemoryEntry | null {
  const normalizedTitle = title.trim().toLowerCase();
  const slug = slugify(title);
  return (
    entries.find((entry) => entry.scope === scope && entry.title.trim().toLowerCase() === normalizedTitle) ||
    entries.find((entry) => entry.scope === scope && path.basename(entry.relativePath, ".md") === slug) ||
    null
  );
}

function uniqueMemoryRelativePath(memoryDir: string, title: string): string {
  const baseSlug = slugify(title) || `memory-${Date.now().toString(36)}`;
  let candidate = `${baseSlug}.md`;
  let counter = 2;

  while (fs.existsSync(path.join(memoryDir, candidate))) {
    candidate = `${baseSlug}-${counter}.md`;
    counter++;
  }

  return candidate;
}

function rebuildIndex(memoryDir: string, scope: MemoryScope): void {
  const heading = scope === "user" ? "# User Memory" : "# Project Memory";
  const entries = walkMarkdownFiles(memoryDir)
    .map((file) => toEntry(file, memoryDir, scope))
    .filter((entry): entry is MemoryEntry => entry !== null)
    .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());

  const lines = [heading, ""];
  if (entries.length === 0) {
    lines.push("_No memories yet._");
  } else {
    for (const entry of entries) {
      lines.push(
        `- [${entry.title}](${entry.relativePath}) [${entry.type}] - ${entry.description}`,
      );
    }
  }
  fs.writeFileSync(path.join(memoryDir, MEMORY_INDEX_NAME), lines.join("\n") + "\n", "utf-8");
}

function buildSearchText(entry: MemoryEntry): string {
  return [
    entry.title,
    entry.title,
    entry.description,
    entry.type,
    entry.scope,
    entry.content.slice(0, 1600),
  ]
    .join("\n")
    .toLowerCase();
}

function tokenizeQuery(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .match(/[a-z0-9_./-]{3,}/g)?.filter((token) => !MEMORY_QUERY_STOPWORDS.has(token)) || [],
    ),
  );
}

function scoreMemory(entry: MemoryEntry, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;

  const title = entry.title.toLowerCase();
  const description = entry.description.toLowerCase();
  const content = entry.content.toLowerCase();
  const tokens = tokenizeQuery(query);
  let score = 0;
  let hasLexicalMatch = false;

  if (title.includes(normalizedQuery)) {
    score += 30;
    hasLexicalMatch = true;
  }
  if (description.includes(normalizedQuery)) {
    score += 20;
    hasLexicalMatch = true;
  }
  if (content.includes(normalizedQuery)) {
    score += 10;
    hasLexicalMatch = true;
  }

  for (const token of tokens) {
    let matched = false;
    if (title.includes(token)) {
      score += 8;
      matched = true;
    }
    if (description.includes(token)) {
      score += 5;
      matched = true;
    }
    if (entry.type.includes(token as never)) {
      score += 3;
      matched = true;
    }
    if (content.includes(token)) {
      score += 1;
      matched = true;
    }
    if (matched) hasLexicalMatch = true;
  }

  if (!hasLexicalMatch) return 0;

  const ageDays = (Date.now() - new Date(entry.updated).getTime()) / 86_400_000;
  score += Math.max(0, 2 - ageDays / 60);

  return score;
}

function formatSelectorManifest(candidates: MemoryEntry[]): string {
  return candidates
    .map((entry) => {
      const preview = entry.content.replace(/\s+/g, " ").trim().slice(0, 180);
      return [
        `- id: ${entry.id}`,
        `  scope: ${entry.scope}`,
        `  type: ${entry.type}`,
        `  title: ${entry.title}`,
        `  description: ${entry.description}`,
        preview ? `  preview: ${preview}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

async function selectRelevantMemories(
  config: GrokConfig,
  query: string,
  candidates: MemoryEntry[],
): Promise<string[] | null> {
  const selectorModel = config.memory.selectorModel;
  if (!selectorModel || candidates.length === 0) return null;

  const client = createClient(
    config.convId ? { ...config, convId: `${config.convId}:memory` } : config,
  );

  const response = await client.chat.completions.create({
    model: selectorModel,
    messages: [
      {
        role: "system",
        content:
          "You are selecting stored memories that will help with the user's current request. " +
          "Be selective. Only return ids for memories that are clearly relevant. " +
          "Prefer user preferences, feedback, and durable project facts. " +
          "Do not return irrelevant or weakly related memories.",
      },
      {
        role: "user",
        content:
          `User request:\n${query}\n\nAvailable memories:\n${formatSelectorManifest(candidates)}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "memory_selection",
        strict: true,
        schema: {
          type: "object",
          properties: {
            ids: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["ids"],
          additionalProperties: false,
        },
      },
    } as any,
    max_tokens: 300,
    temperature: 0,
  } as any);

  const text = response.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) return null;
  const parsed = JSON.parse(text) as { ids?: string[] };
  if (!Array.isArray(parsed.ids)) return null;
  return parsed.ids.filter((id) => candidates.some((entry) => entry.id === id));
}

export function getProjectMemorySlug(cwd: string): string {
  const absolute = path.resolve(cwd);
  const name = path.basename(absolute) || "project";
  return `${slugify(name) || "project"}-${shortHash(absolute)}`;
}

export function getMemoryRoot(baseDir: string): string {
  return path.join(baseDir, "memory");
}

export function getMemoryDir(baseDir: string, cwd: string, scope: MemoryScope): string {
  if (scope === "user") {
    return path.join(getMemoryRoot(baseDir), "user");
  }
  return path.join(getMemoryRoot(baseDir), "projects", getProjectMemorySlug(cwd));
}

export function getMemoryDirs(baseDir: string, cwd: string): Record<MemoryScope, string> {
  return {
    user: getMemoryDir(baseDir, cwd, "user"),
    project: getMemoryDir(baseDir, cwd, "project"),
  };
}

export function getMemoryReadRoots(baseDir: string, cwd: string): string[] {
  return Object.values(getMemoryDirs(baseDir, cwd));
}

export function buildMemoryGuidance(config: GrokConfig, cwd: string): string | null {
  if (!config.memory.enabled) return null;

  const dirs = getMemoryDirs(config.sessionDir, cwd);
  const userIndex = readIndex(path.join(dirs.user, MEMORY_INDEX_NAME));
  const projectIndex = readIndex(path.join(dirs.project, MEMORY_INDEX_NAME));

  const lines = [
    "# Persistent Memory",
    "You have file-backed long-term memory for future sessions.",
    `- User memory directory: ${dirs.user}`,
    `- Project memory directory: ${dirs.project}`,
    "- Use remember_memory to save durable user preferences, feedback, project facts, or important gotchas that will matter again later.",
    "- Use forget_memory to remove stale, incorrect, or unwanted memory.",
    "- Use memory_search when you need to inspect stored memory directly.",
    "- Do not save secrets, one-off task state, large code dumps, or facts that are obvious from the current repository state.",
    "- Current user instructions and the live repository state override older memory. If memory is stale, update or remove it.",
  ];

  if (userIndex) {
    lines.push("", "## User Memory Index", userIndex);
  }
  if (projectIndex) {
    lines.push("", "## Project Memory Index", projectIndex);
  }

  return lines.join("\n");
}

export function listMemories(
  baseDir: string,
  cwd: string,
  scope: MemoryScope | "all" = "all",
): MemoryEntry[] {
  const entries: MemoryEntry[] = [];

  for (const resolvedScope of resolveScopes(scope)) {
    const memoryDir = getMemoryDir(baseDir, cwd, resolvedScope);
    for (const filePath of walkMarkdownFiles(memoryDir)) {
      const entry = toEntry(filePath, memoryDir, resolvedScope);
      if (entry) entries.push(entry);
    }
  }

  return entries.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
}

export function resolveMemoryRef(
  baseDir: string,
  cwd: string,
  ref: string,
  scope: MemoryScope | "all" = "all",
): MemoryEntry | null {
  const trimmedRef = ref.trim();
  if (!trimmedRef) return null;

  let effectiveScope = scope;
  let normalizedRef = trimmedRef;
  const prefix = trimmedRef.split(":", 2)[0];
  if ((prefix === "user" || prefix === "project") && trimmedRef.includes(":")) {
    effectiveScope = prefix as MemoryScope;
    normalizedRef = trimmedRef.slice(prefix.length + 1);
  }

  const entries = listMemories(baseDir, cwd, effectiveScope);
  const exact = entries.find((entry) =>
    entry.id === trimmedRef ||
    entry.relativePath === normalizedRef ||
    path.basename(entry.relativePath) === normalizedRef ||
    path.basename(entry.relativePath, ".md") === normalizedRef ||
    entry.title.toLowerCase() === trimmedRef.toLowerCase() ||
    entry.title.toLowerCase() === normalizedRef.toLowerCase(),
  );
  if (exact) return exact;

  const normalizedNeedle = normalizedRef.toLowerCase();
  return entries.find((entry) =>
    entry.relativePath.toLowerCase().includes(normalizedNeedle) ||
    entry.title.toLowerCase().includes(normalizedNeedle),
  ) || null;
}

export function rememberMemory(baseDir: string, cwd: string, input: RememberMemoryInput): MemoryEntry {
  const scope = input.scope || "project";
  const memoryDir = getMemoryDir(baseDir, cwd, scope);
  ensureDir(memoryDir);

  const existing = input.id
    ? resolveMemoryRef(baseDir, cwd, input.id, scope)
    : findExistingByTitle(listMemories(baseDir, cwd, scope), input.title, scope);

  const relativePath = existing?.relativePath || uniqueMemoryRelativePath(memoryDir, input.title);
  const absolutePath = path.join(memoryDir, relativePath);
  const now = new Date().toISOString();
  const content = input.content.trim() || input.description?.trim() || input.title.trim();
  const description =
    input.description?.trim() ||
    content.split("\n").map((line) => line.trim()).find(Boolean) ||
    input.title.trim();
  const type = input.type || existing?.type || defaultMemoryType(scope);

  ensureDir(path.dirname(absolutePath));
  fs.writeFileSync(
    absolutePath,
    serializeFrontmatter({
      title: input.title.trim(),
      description,
      type,
      scope,
      created: existing?.created || now,
      updated: now,
    }) + content.trim() + "\n",
    "utf-8",
  );

  rebuildIndex(memoryDir, scope);

  const saved = toEntry(absolutePath, memoryDir, scope);
  if (!saved) {
    throw new Error(`Failed to save memory at ${absolutePath}`);
  }
  return saved;
}

export function forgetMemory(
  baseDir: string,
  cwd: string,
  ref: string,
  scope: MemoryScope | "all" = "all",
): MemoryEntry | null {
  const entry = resolveMemoryRef(baseDir, cwd, ref, scope);
  if (!entry) return null;

  fs.unlinkSync(entry.filePath);
  rebuildIndex(getMemoryDir(baseDir, cwd, entry.scope), entry.scope);
  return entry;
}

export function searchMemories(
  baseDir: string,
  cwd: string,
  query: string,
  options: SearchOptions = {},
): MemoryEntry[] {
  const limit = Math.max(1, Math.min(options.limit || 5, 20));
  return listMemories(baseDir, cwd, options.scope || "all")
    .map((entry) => ({ entry, score: scoreMemory(entry, query) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((result) => result.entry);
}

export async function recallRelevantMemories(
  config: GrokConfig,
  cwd: string,
  query: string,
): Promise<MemoryRecallResult | null> {
  if (!config.memory.enabled || !config.memory.autoRecall || !query.trim()) return null;

  const recallLimit = clampRecallLimit(config.memory.recallLimit);
  const heuristicCandidates = searchMemories(config.sessionDir, cwd, query, {
    limit: Math.max(recallLimit * 4, 8),
  });
  if (heuristicCandidates.length === 0) return null;

  if (!config.memory.useSemanticRecall || heuristicCandidates.length <= recallLimit) {
    return {
      entries: heuristicCandidates.slice(0, recallLimit),
      strategy: "heuristic",
    };
  }

  const candidates = heuristicCandidates.slice(0, MAX_SELECTOR_CANDIDATES);
  try {
    const selectedIds = await selectRelevantMemories(config, query, candidates);
    if (!selectedIds || selectedIds.length === 0) {
      return {
        entries: heuristicCandidates.slice(0, recallLimit),
        strategy: "heuristic",
      };
    }

    const byId = new Map(candidates.map((entry) => [entry.id, entry]));
    const selected = selectedIds
      .map((id) => byId.get(id))
      .filter((entry): entry is MemoryEntry => entry !== undefined)
      .slice(0, recallLimit);

    if (selected.length === 0) {
      return {
        entries: heuristicCandidates.slice(0, recallLimit),
        strategy: "heuristic",
      };
    }

    return {
      entries: selected,
      strategy: "semantic",
    };
  } catch {
    return {
      entries: heuristicCandidates.slice(0, recallLimit),
      strategy: "heuristic",
    };
  }
}

export function formatMemoryContext(recall: MemoryRecallResult): string {
  const lines = [
    "<relevant_memory>",
    "Use this long-term memory when it helps. Current user instructions and the live repository state take precedence over older memory. If any memory looks stale or wrong, update or remove it.",
    "",
  ];

  for (const entry of recall.entries) {
    lines.push(
      `## ${entry.title}`,
      `- id: ${entry.id}`,
      `- scope: ${entry.scope}`,
      `- type: ${entry.type}`,
      `- updated: ${entry.updated}`,
      `- description: ${entry.description}`,
      "",
      entry.content.slice(0, BODY_SNIPPET_LIMIT).trim() || entry.description,
      "",
    );
  }

  lines.push("</relevant_memory>");
  return lines.join("\n");
}

export async function augmentPromptWithMemory(
  config: GrokConfig,
  cwd: string,
  prompt: string,
): Promise<{ prompt: string; recall: MemoryRecallResult | null }> {
  const recall = await recallRelevantMemories(config, cwd, prompt);
  if (!recall || recall.entries.length === 0) {
    return { prompt, recall: null };
  }

  return {
    prompt: `${formatMemoryContext(recall)}\n\n<user_request>\n${prompt}\n</user_request>`,
    recall,
  };
}

export function formatMemorySummary(entry: MemoryEntry, includeContent = false): string {
  const lines = [
    `${entry.id}`,
    `  title: ${entry.title}`,
    `  type: ${entry.type}`,
    `  scope: ${entry.scope}`,
    `  updated: ${entry.updated}`,
    `  file: ${entry.filePath}`,
    `  description: ${entry.description}`,
  ];

  if (includeContent) {
    const preview = entry.content.replace(/\s+/g, " ").trim();
    if (preview) {
      lines.push(`  content: ${preview.slice(0, 240)}${preview.length > 240 ? "..." : ""}`);
    }
  }

  return lines.join("\n");
}

export function countMemories(baseDir: string, cwd: string): Record<MemoryScope, number> {
  const result: Record<MemoryScope, number> = { user: 0, project: 0 };
  for (const scope of MEMORY_SCOPES) {
    result[scope] = listMemories(baseDir, cwd, scope).length;
  }
  return result;
}
