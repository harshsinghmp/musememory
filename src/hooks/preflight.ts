import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import type { Store } from "../store.ts";
import { formatPromptContext, type FormattedContext, type ScoredEntry } from "../retrieval.ts";
import { scoreBlastRadius, type BlastRisk } from "../intelligence/blast_risk.ts";
import { recallAnchoredMemories } from "../retrieval/anchors.ts";
import { inferProject } from "../retrieval/code_context.ts";
import { estimateTokens } from "../compress.ts";

const MAX_FILES = 15;
export const DEFAULT_TOKEN_BUDGET = 800;
const MAX_ENTRY_LIMIT = 8;

export interface PreflightInput {
  files?: string[];
  branch?: string;
  tokenBudget?: number;
  project?: string;
  symbols?: string[];
  changedLines?: number;
  cwd?: string;
}

export interface PreflightResult {
  query: string;
  files: string[];
  context: FormattedContext;
  risk: BlastRisk;
  anchors: ScoredEntry[];
  /** W26-2: true cost of the assembled pack, not just the entry subset. */
  markdownTokens: number;
  /** W26-2: whether the requested budget was actually honoured. */
  withinBudget: boolean;
}

/** T-433: changed files from git, empty when not in a repository. */
export function detectChangedFiles(cwd: string = process.cwd()): string[] {
  try {
    return execFileSync("git", ["diff", "--name-only", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_FILES);
  } catch {
    try {
      return execFileSync("git", ["status", "--porcelain"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .split("\n")
        .map((line) => line.slice(3).trim())
        .filter(Boolean)
        .slice(0, MAX_FILES);
    } catch {
      return [];
    }
  }
}

/** Build the pre-flight query from the branch and the files being edited. */
export function buildPreflightQuery(files: string[], branch?: string): string {
  const names = files
    .slice(0, MAX_FILES)
    .map((file) => basename(file).replace(/\.[^.]+$/, ""))
    .filter(Boolean);
  return [branch, ...names].filter(Boolean).join(" ").trim();
}

function isTestPath(file: string): boolean {
  return /(^|\/)(test|tests|__tests__)\//.test(file) || /\.(test|spec)\.[^.]+$/.test(file);
}

/**
 * T-433: speculative pre-flight context. Read-only: it must not bump access
 * counts or rewrite CURRENT.md just because an editor opened a file.
 *
 * W26-2: `tokenBudget` bounds the whole assembled pack, not just the entry
 * subset. Constraints, USER.md, CORE.md and the handoff block are appended
 * after the entry search has already spent its budget, so honouring only the
 * entry budget reported figures like "47 tokens" for a pack that actually
 * injected over 1,100. The fix measures the final markdown and re-queries
 * with a reduced entry budget until the whole thing fits — or keeps the
 * mandatory blocks and reports honestly that it could not.
 */
export function preflightContext(store: Store, input: PreflightInput = {}): PreflightResult {
  const files = (input.files ?? detectChangedFiles(input.cwd)).slice(0, MAX_FILES);
  const query = buildPreflightQuery(files, input.branch) || "preflight";
  const project = input.project ?? inferProject(store);
  const budget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

  const build = (entryBudget: number, entryLimit: number): FormattedContext =>
    formatPromptContext(store, store.memoryDir, query, {
      limit: entryLimit,
      tokenBudget: entryBudget,
      project,
      recordAccess: false,
      syncConstraints: false,
    });

  let entryBudget = budget;
  let entryLimit = MAX_ENTRY_LIMIT;
  let context = build(entryBudget, entryLimit);
  let markdownTokens = estimateTokens(context.markdown);

  // Halve the entry allocation until the full pack fits. Mandatory blocks
  // (constraints, profile, core) are never dropped: silently omitting a hard
  // constraint to hit a number would be worse than an honest overrun.
  while (markdownTokens > budget && entryLimit > 0) {
    entryLimit = entryLimit > 1 ? Math.floor(entryLimit / 2) : 0;
    entryBudget = entryLimit === 0 ? 0 : Math.max(1, Math.floor(entryBudget / 2));
    context = build(entryBudget, entryLimit);
    markdownTokens = estimateTokens(context.markdown);
  }

  const sourceDirs = new Set(
    files.filter((file) => !isTestPath(file)).map((file) => file.split("/")[0]).filter(Boolean),
  );
  const risk = scoreBlastRadius({
    files,
    symbols: input.symbols,
    changedLines: input.changedLines,
    hasTests: files.length === 0 ? undefined : files.some((file) => isTestPath(file)),
    crossModule: sourceDirs.size > 1,
  });
  const anchors = recallAnchoredMemories(store, {
    files,
    symbols: input.symbols,
    project,
  });
  return {
    query,
    files,
    context,
    risk,
    anchors,
    markdownTokens,
    withinBudget: markdownTokens <= budget,
  };
}
