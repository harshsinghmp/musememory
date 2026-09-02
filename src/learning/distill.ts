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

/**
 * Distills unprocessed raw observations into structured candidate memories and negative lessons.
 */
export function distillObservationsToCandidates(
  store: Store,
  project: string,
): DistillationResult {
  const unprocessed = listObservations(store, { processed: false, project });
  const proposedCandidates: MemoryEntry[] = [];
  const negativeLessons: MemoryEntry[] = [];

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
        failed_approach: lines.slice(0, 3).join("\n"),
        failure_reason: obs.raw.length > 200 ? obs.raw.slice(0, 300) : obs.raw,
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
        content: obs.raw,
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
        content: obs.raw,
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
