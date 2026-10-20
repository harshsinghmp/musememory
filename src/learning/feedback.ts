import type { Store } from "../store.ts";
import { get } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import { recordApplicationOutcome } from "../quality/utility.ts";
import { recordObservation } from "./observation.ts";
import { matchesWordBoundary, calculateSymbolSpecificity } from "../retrieval.ts";

export interface SessionOutcomeEvaluationOptions {
  project: string;
  retrievedMemoryIds: string[];
  exitCode: number;
  command?: string;
  logs?: string;
  agent?: string;
  sessionId?: string;
  now?: number;
}

export interface FailureRelevanceContext {
  command?: string;
  logs?: string;
  exitCode: number;
  project?: string;
}

/**
 * T-313: Determines whether a memory is relevant to a command failure.
 * Only memories whose code anchors, affected paths, distinctive symbols, or reproduction
 * commands correlate with the failure context are attributed with a regression.
 */
export function isMemoryRelevantToFailure(
  entry: MemoryEntry,
  context: FailureRelevanceContext,
): boolean {
  const combinedContext = [context.command || "", context.logs || ""].join(" ");
  if (!combinedContext.trim()) return false;

  // 1. Anchor matching
  if (entry.anchors && entry.anchors.length > 0) {
    for (const anchor of entry.anchors) {
      const filePath = anchor.file_path || (anchor as any).file;
      if (filePath) {
        const basename = filePath.split(/[/\\]/).pop();
        if (basename && matchesWordBoundary(combinedContext, basename)) {
          return true;
        }
        if (combinedContext.includes(filePath)) {
          return true;
        }
      }
      const symbolName = anchor.symbol_name || (anchor as any).symbol;
      if (symbolName) {
        const spec = calculateSymbolSpecificity(symbolName);
        if (spec > 0.3 && matchesWordBoundary(combinedContext, symbolName)) {
          return true;
        }
      }
    }
  }

  // 2. Affected paths matching
  if (entry.graph?.affected_paths && entry.graph.affected_paths.length > 0) {
    for (const path of entry.graph.affected_paths) {
      const basename = path.split(/[/\\]/).pop();
      if (basename && matchesWordBoundary(combinedContext, basename)) {
        return true;
      }
      if (combinedContext.includes(path)) {
        return true;
      }
    }
  }

  // 3. Reproduction command matching
  if (entry.test_command && context.command && context.command.includes(entry.test_command)) {
    return true;
  }
  if (
    entry.negative?.reproduction_command &&
    context.command &&
    context.command.includes(entry.negative.reproduction_command)
  ) {
    return true;
  }

  // 4. Distinctive title or content match when anchors are absent
  if (!entry.anchors || entry.anchors.length === 0) {
    const textToMatch = `${entry.title} ${entry.content}`.toLowerCase();
    const contextTokens = combinedContext.toLowerCase().split(/[\s:,\(\)\[\]"']+/);
    for (const token of contextTokens) {
      if (token.length >= 4 && calculateSymbolSpecificity(token) > 0.3) {
        if (matchesWordBoundary(textToMatch, token)) {
          return true;
        }
      }
    }
  }

  return false;
}

export interface SessionOutcomeResult {
  updatedMemories: MemoryEntry[];
  observationRecorded?: boolean;
}

/**
 * Automatically evaluates session command outcomes (e.g. test runs, build executions)
 * against memories that were retrieved and applied during the turn.
 * Reinforces successful memories and penalizes/flags regressions on anchor-relevant memories.
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
      const entry = get(store, id);
      let memoryIsRegression = false;

      if (isRegression && entry) {
        memoryIsRegression = isMemoryRelevantToFailure(entry, {
          command: options.command,
          logs: options.logs,
          exitCode: options.exitCode,
          project: options.project,
        });
      }

      const updated = recordApplicationOutcome(store, {
        memoryId: id,
        success: isSuccess,
        regression: memoryIsRegression,
        notes: options.command ? `Execution of "${options.command}" exited ${options.exitCode}` : undefined,
        actor: options.agent ?? "automated_outcome_evaluator",
        sessionId: options.sessionId,
        now: options.now,
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
