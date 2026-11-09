import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import type { Store } from "../store.ts";
import { formatPromptContext, type FormattedContext, type ScoredEntry } from "../retrieval.ts";
import { scoreBlastRadius, type BlastRisk } from "../intelligence/blast_risk.ts";
import { recallAnchoredMemories } from "../retrieval/anchors.ts";
import { inferProject } from "../retrieval/code_context.ts";

const MAX_FILES = 15;

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
 */
export function preflightContext(store: Store, input: PreflightInput = {}): PreflightResult {
  const files = (input.files ?? detectChangedFiles(input.cwd)).slice(0, MAX_FILES);
  const query = buildPreflightQuery(files, input.branch) || "preflight";
  const project = input.project ?? inferProject(store);
  const context = formatPromptContext(store, store.memoryDir, query, {
    limit: 8,
    tokenBudget: input.tokenBudget ?? 800,
    project,
    recordAccess: false,
    syncConstraints: false,
  });
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
  return { query, files, context, risk, anchors };
}
