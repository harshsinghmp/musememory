import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import type { Store } from "../store.ts";
import { formatPromptContext, type FormattedContext } from "../retrieval.ts";
import { scoreBlastRadius, type BlastRisk } from "../intelligence/blast_risk.ts";

export interface PreflightInput {
  files?: string[];
  branch?: string;
  tokenBudget?: number;
  project?: string;
}

export interface PreflightResult {
  query: string;
  files: string[];
  context: FormattedContext;
  risk: BlastRisk;
}

/** T-433: changed files from git, empty when not in a repository. */
export function detectChangedFiles(cwd: string = process.cwd()): string[] {
  try {
    return execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd, encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Build the pre-flight query from the branch and the files being edited. */
export function buildPreflightQuery(files: string[], branch?: string): string {
  const names = files.map((file) => basename(file).replace(/\.[^.]+$/, "")).filter(Boolean);
  return [branch, ...names].filter(Boolean).join(" ").trim();
}

/**
 * T-433: speculative pre-flight context. Computes a small token-budgeted pack
 * before the agent asks, so file-open/branch-switch hooks can inject it.
 */
export function preflightContext(store: Store, input: PreflightInput = {}): PreflightResult {
  const files = input.files ?? detectChangedFiles();
  const query = buildPreflightQuery(files, input.branch) || "preflight";
  const context = formatPromptContext(store, store.memoryDir || store.dir, query, {
    limit: 8,
    tokenBudget: input.tokenBudget ?? 800,
    project: input.project,
  });
  const risk = scoreBlastRadius({
    files,
    hasTests: files.length === 0 ? undefined : files.every((file) => /(^|\/)(test|tests|__tests__)\//.test(file) || /\.(test|spec)\.[^.]+$/.test(file)),
    crossModule: new Set(files.map((file) => file.split("/")[0])).size > 1,
  });
  return { query, files, context, risk };
}
