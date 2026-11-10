import type { Store } from "../store.ts";
import { list } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import { isMemoryRelevantToFailure } from "../learning/feedback.ts";
import { calculateSymbolSpecificity, matchesWordBoundary } from "../retrieval.ts";

export type SentryKind = "DO_NOT_USE" | "BUG_PRONE_PATTERN" | "FAILED_APPROACH" | "NEGATIVE";

export interface SentryFailure {
  name: string;
  message?: string;
  file?: string;
}

export interface SentryMatch {
  memory_id: string;
  title: string;
  kind: SentryKind;
  severity?: string;
  failure: string;
  reason: string;
  reproduction_command?: string;
  recommendation?: string;
}

export interface SentryPlaybook {
  memory_id: string;
  title: string;
  steps: string[];
}

export interface SentryReport {
  checked_negatives: number;
  failures: number;
  matched: SentryMatch[];
  unmatched: string[];
  playbooks: SentryPlaybook[];
  notice: string;
}

const NEGATIVE_TAGS = new Set(["negative-pattern", "anti-pattern", "bug-prone", "bug_prone", "do-not-use", "do_not_use"]);

function isNegativeMemory(entry: MemoryEntry): boolean {
  if (entry.type === "negative" || entry.negative !== undefined) return true;
  return (entry.tags ?? []).some((tag) => NEGATIVE_TAGS.has(tag.toLowerCase()));
}

function classifyKind(entry: MemoryEntry): SentryKind {
  const title = entry.title.toUpperCase();
  const tags = (entry.tags ?? []).map((tag) => tag.toLowerCase());
  if (
    title.includes("DO NOT") ||
    title.includes("DO_NOT_USE") ||
    tags.includes("do-not-use") ||
    tags.includes("do_not_use")
  ) {
    return "DO_NOT_USE";
  }
  if (
    title.includes("BUG-PRONE") ||
    title.includes("BUG_PRONE") ||
    tags.includes("bug-prone") ||
    tags.includes("bug_prone")
  ) {
    return "BUG_PRONE_PATTERN";
  }
  if (title.includes("AVOID") || entry.negative) return "FAILED_APPROACH";
  return "NEGATIVE";
}

function failureContext(failure: SentryFailure): string {
  return [failure.name, failure.message ?? "", failure.file ?? ""].filter(Boolean).join(" ");
}

/** Returns a human-readable match reason, or null when the memory is unrelated. */
function matchReason(entry: MemoryEntry, failure: SentryFailure, command?: string): string | null {
  const context = failureContext(failure);
  if (!context.trim()) return null;

  if (isMemoryRelevantToFailure(entry, { command, logs: context, exitCode: 1 })) {
    return "anchored";
  }

  const text = `${entry.title}\n${entry.content}`.toLowerCase();
  const tokens = new Set(context.toLowerCase().split(/[^a-z0-9_]+/));
  for (const token of tokens) {
    if (token.length < 4) continue;
    if (calculateSymbolSpecificity(token) <= 0.3) continue;
    if (matchesWordBoundary(text, token)) return `token:${token}`;
  }
  return null;
}

export interface SentryOptions {
  project?: string;
  /** Maximum matches returned (default 20). */
  limit?: number;
  command?: string;
}

/**
 * Read-only regression sentry: match failing tests against recorded
 * BUG_PRONE_PATTERN / DO_NOT_USE / failed-approach memories and return
 * remediation hints. It never mutates the store or the ledger.
 */
export function runRegressionSentry(
  store: Store,
  failures: SentryFailure[],
  options: SentryOptions = {},
): SentryReport {
  const negatives = list(store, options.project ? { project: options.project } : undefined)
    .filter(isNegativeMemory);
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));

  const matched: SentryMatch[] = [];
  const unmatched: string[] = [];
  const byMemory = new Map<string, { entry: MemoryEntry; failures: string[] }>();

  for (const failure of failures) {
    let hits = 0;
    for (const entry of negatives) {
      const reason = matchReason(entry, failure, options.command);
      if (!reason) continue;
      hits++;
      const existing = byMemory.get(entry.id);
      if (existing) existing.failures.push(failure.name);
      else byMemory.set(entry.id, { entry, failures: [failure.name] });

      if (matched.length < limit) {
        matched.push({
          memory_id: entry.id,
          title: entry.title,
          kind: classifyKind(entry),
          severity: entry.negative?.severity,
          failure: failure.name,
          reason,
          reproduction_command: entry.negative?.reproduction_command ?? entry.test_command,
          recommendation: entry.negative?.alternative_recommended,
        });
      }
    }
    if (hits === 0) unmatched.push(failure.name);
  }

  const playbooks: SentryPlaybook[] = [];
  for (const { entry, failures: names } of byMemory.values()) {
    const steps: string[] = [];
    const reproduce = entry.negative?.reproduction_command ?? entry.test_command;
    if (reproduce) steps.push(`Reproduce: ${reproduce}`);
    if (entry.negative?.failed_approach) steps.push(`Avoid: ${entry.negative.failed_approach}`);
    if (entry.negative?.alternative_recommended) steps.push(`Use instead: ${entry.negative.alternative_recommended}`);
    steps.push(`Failing checks: ${Array.from(new Set(names)).slice(0, 5).join(", ")}`);
    steps.push(`Re-read: ${entry.id}`);
    playbooks.push({ memory_id: entry.id, title: entry.title, steps });
  }

  return {
    checked_negatives: negatives.length,
    failures: failures.length,
    matched,
    unmatched,
    playbooks,
    notice: "Sentry is read-only: the memory store and audit ledger were not modified.",
  };
}
