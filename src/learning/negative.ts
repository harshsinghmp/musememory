import type { Store } from "../store.ts";
import { propose, save } from "../store.ts";
import { recordAuditEvent } from "../audit.ts";
import type { MemoryEntry, NegativeMemoryDetails } from "../types.ts";

export interface RecordNegativeLessonOptions {
  project: string;
  title: string;
  failed_approach: string;
  failure_reason: string;
  alternative_recommended?: string;
  reproduction_command?: string;
  evidence_snippet?: string;
  severity?: "low" | "medium" | "high" | "critical";
  tags?: string[];
  source?: string;
  confirmed?: boolean;
}

/**
 * Records a first-class negative lesson (DO_NOT_USE / FAILED_APPROACH / BUG_PRONE_PATTERN).
 * Ensures negative lessons are timeless, highly salient, and clearly articulate
 * what failed, why it failed, and what to use instead.
 */
export function recordNegativeLesson(
  store: Store,
  options: RecordNegativeLessonOptions,
): MemoryEntry {
  const parts: string[] = [
    `### ❌ Failed Approach / Anti-Pattern:`,
    options.failed_approach.trim(),
    "",
    `### ⚠️ Failure Reason & Impact:`,
    options.failure_reason.trim(),
  ];

  if (options.alternative_recommended && options.alternative_recommended.trim()) {
    parts.push("");
    parts.push(`### ✅ Recommended Alternative / Correct Fix:`);
    parts.push(options.alternative_recommended.trim());
  }

  if (options.evidence_snippet && options.evidence_snippet.trim()) {
    parts.push("");
    parts.push(`### 🔍 Evidence & Error Context:`);
    parts.push("```");
    parts.push(options.evidence_snippet.trim());
    parts.push("```");
  }

  const negativeDetails: NegativeMemoryDetails = {
    failed_approach: options.failed_approach,
    failure_reason: options.failure_reason,
    alternative_recommended: options.alternative_recommended,
    reproduction_command: options.reproduction_command,
    evidence_snippet: options.evidence_snippet,
    severity: options.severity ?? "medium",
  };

  const title = options.title.startsWith("DO NOT") || options.title.startsWith("AVOID")
    ? options.title
    : `AVOID: ${options.title}`;

  const entry = propose(store, {
    title,
    content: parts.join("\n"),
    project: options.project,
    type: "negative",
    source: options.source ?? "negative_learning_engine",
    confirmed: options.confirmed ?? true,
    salience: 0.85, // Negative lessons carry high salience to prevent regressions
    temporal_mode: "timeless",
    test_command: options.reproduction_command,
    tags: [...(options.tags ?? []), "negative-pattern", "anti-pattern", options.severity ?? "medium"],
  });

  entry.negative = negativeDetails;
  save(store, entry);

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "negative_capture",
      entry_id: entry.id,
      project: entry.project,
      actor: options.source ?? "agent",
      details: {
        failed_approach: options.failed_approach,
        failure_reason: options.failure_reason,
        alternative: options.alternative_recommended,
        severity: options.severity ?? "medium",
      },
    });
  }

  return entry;
}
