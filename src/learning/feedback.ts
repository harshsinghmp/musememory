import type { Store } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import { recordApplicationOutcome } from "../quality/utility.ts";
import { recordObservation } from "./observation.ts";

export interface SessionOutcomeEvaluationOptions {
  project: string;
  retrievedMemoryIds: string[];
  exitCode: number;
  command?: string;
  logs?: string;
  agent?: string;
}

export interface SessionOutcomeResult {
  updatedMemories: MemoryEntry[];
  observationRecorded?: boolean;
}

/**
 * Automatically evaluates session command outcomes (e.g. test runs, build executions)
 * against memories that were retrieved and applied during the turn.
 * Reinforces successful memories and penalizes/flags regressions.
 */
export function evaluateSessionOutcomes(
  store: Store,
  options: SessionOutcomeEvaluationOptions,
): SessionOutcomeResult {
  const updatedMemories: MemoryEntry[] = [];
  const isSuccess = options.exitCode === 0;
  const isRegression = options.exitCode !== 0;

  for (const id of options.retrievedMemoryIds) {
    try {
      const updated = recordApplicationOutcome(store, {
        memoryId: id,
        success: isSuccess,
        regression: isRegression,
        notes: options.command ? `Execution of "${options.command}" exited ${options.exitCode}` : undefined,
        actor: options.agent ?? "automated_outcome_evaluator",
      });
      updatedMemories.push(updated);
    } catch {}
  }

  // If a command failed, capture raw observation for subsequent distillation
  let observationRecorded = false;
  if (!isSuccess && options.logs) {
    try {
      recordObservation(store, {
        source: options.command?.includes("test") ? "test" : "build",
        project: options.project,
        raw: options.logs,
        summary: `Command failure: ${options.command || "unknown command"} (exit ${options.exitCode})`,
        metadata: {
          exitCode: options.exitCode,
          command: options.command,
        },
      });
      observationRecorded = true;
    } catch {}
  }

  return {
    updatedMemories,
    observationRecorded,
  };
}
