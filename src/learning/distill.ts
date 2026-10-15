import type { Store } from "../store.ts";
import { propose } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import { listObservations, markObservationProcessed } from "./observation.ts";
import { recordNegativeLesson } from "./negative.ts";

export interface DistillationResult {
  proposedCandidates: MemoryEntry[];
  negativeLessons: MemoryEntry[];
  processedCount: number;
}

export const MAX_DISTILLATION_BODY_CHARS = 1500;

/**
 * Truncates raw observation logs exceeding the distillation body limit.
 */
export function capDistillationBody(
  text: string,
  maxChars: number = MAX_DISTILLATION_BODY_CHARS,
): string {
  if (!text || text.length <= maxChars) return text;
  const truncatedCount = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n... [truncated ${truncatedCount} characters from raw observation]`;
}

/**
 * Distills unprocessed raw observations into structured candidate memories and negative lessons.
 */
export function distillObservationsToCandidates(
  store: Store,
  project: string,
  options?: { maxBodyChars?: number },
): DistillationResult {
  const unprocessed = listObservations(store, { processed: false, project });
  const proposedCandidates: MemoryEntry[] = [];
  const negativeLessons: MemoryEntry[] = [];
  const maxBodyChars = options?.maxBodyChars ?? MAX_DISTILLATION_BODY_CHARS;

  for (const obs of unprocessed) {
    const text = `${obs.summary ?? ""} ${obs.raw}`;
    const lower = text.toLowerCase();

    // 1. Detect Negative Lessons (FAILED_APPROACH / DO_NOT_USE)
    if (
      lower.includes("do not use") ||
      lower.includes("failed approach") ||
      lower.includes("anti-pattern") ||
      lower.includes("caused regression") ||
      lower.includes("avoid using")
    ) {
      // Extract approach and reason
      const lines = obs.raw.split("\n").filter((l) => l.trim().length > 0);
      const title = obs.summary || lines[0].slice(0, 100);

      const negative = recordNegativeLesson(store, {
        project,
        title,
        failed_approach: capDistillationBody(lines.slice(0, 3).join("\n"), maxBodyChars),
        failure_reason: capDistillationBody(obs.raw, maxBodyChars),
        alternative_recommended: obs.metadata?.alternative || "Refer to architectural standards",
        evidence_snippet: obs.metadata?.stack_trace || obs.raw.slice(0, 200),
        severity: obs.metadata?.severity ?? "medium",
        tags: ["distilled-negative", obs.source],
      });

      negativeLessons.push(negative);
      markObservationProcessed(store, obs.id, negative.id);
      continue;
    }

    // 2. Detect Bug Fixes / Error Resolutions
    if (
      obs.source === "test" ||
      obs.source === "build" ||
      lower.includes("error:") ||
      lower.includes("exception:") ||
      lower.includes("fixed")
    ) {
      const title = obs.summary || `Resolution: ${obs.raw.slice(0, 80)}`;
      const candidate = propose(store, {
        title,
        content: capDistillationBody(obs.raw, maxBodyChars),
        project,
        type: "fix",
        source: `distilled_${obs.source}`,
        confirmed: false, // Remains candidate until verified
        tags: ["distilled-fix", obs.source],
        test_command: obs.metadata?.test_command,
      });

      proposedCandidates.push(candidate);
      markObservationProcessed(store, obs.id, candidate.id);
      continue;
    }

    // 3. Detect Architecture / Operational Conventions
    if (
      lower.includes("architecture:") ||
      lower.includes("convention:") ||
      lower.includes("configured") ||
      obs.source === "file_edit"
    ) {
      const title = obs.summary || `Convention: ${obs.raw.slice(0, 80)}`;
      const candidate = propose(store, {
        title,
        content: capDistillationBody(obs.raw, maxBodyChars),
        project,
        type: "architecture",
        source: `distilled_${obs.source}`,
        confirmed: false,
        tags: ["distilled-architecture", obs.source],
      });

      proposedCandidates.push(candidate);
      markObservationProcessed(store, obs.id, candidate.id);
      continue;
    }

    // Otherwise, mark processed without generating low-confidence noise
    markObservationProcessed(store, obs.id);
  }

  return {
    proposedCandidates,
    negativeLessons,
    processedCount: unprocessed.length,
  };
}
