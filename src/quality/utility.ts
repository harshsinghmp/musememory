import type { Store } from "../store.ts";
import { get, list, save } from "../store.ts";
import { recordAuditEvent } from "../audit.ts";
import type { MemoryEntry, MemoryUtility } from "../types.ts";

/**
 * Initializes a default utility object for a memory entry if not present.
 */
export function ensureUtility(entry: MemoryEntry): MemoryUtility {
  if (!entry.utility) {
    entry.utility = {
      retrieval_count: 0,
      application_count: 0,
      successful_applications: 0,
      failed_applications: 0,
      regressions: 0,
      contradictions: 0,
      reuse_success_rate: 1.0,
    };
  }
  return entry.utility;
}

/**
 * Records that one or more memories were retrieved for an agent prompt context.
 */
export function recordRetrievals(store: Store, memoryIds: string[]): void {
  for (const id of memoryIds) {
    const entry = get(store, id);
    if (!entry) continue;

    const utility = ensureUtility(entry);
    utility.retrieval_count++;
    entry.salience = Math.min(1.0, (entry.salience ?? 0.5) + 0.02);
    save(store, entry);
  }
}

export interface ApplicationOutcomeOptions {
  memoryId: string;
  success: boolean;
  regression?: boolean;
  notes?: string;
  actor?: string;
}

/**
 * Records the outcome when an agent applied a memory (solution, decision, or constraint).
 * Updates utility metrics, calculates reuse success rate, and adjusts reinforcement.
 */
export function recordApplicationOutcome(
  store: Store,
  options: ApplicationOutcomeOptions,
): MemoryEntry {
  const entry = get(store, options.memoryId);
  if (!entry) {
    throw new Error(`Memory with ID ${options.memoryId} not found`);
  }

  const utility = ensureUtility(entry);
  utility.application_count++;
  utility.last_applied_at = new Date().toISOString();

  if (options.success) {
    utility.successful_applications++;
    entry.reinforcement = (entry.reinforcement ?? 0) + 1;
  } else {
    utility.failed_applications++;
    entry.reinforcement = Math.max(-5, (entry.reinforcement ?? 0) - 1);
  }

  if (options.regression) {
    utility.regressions++;
    entry.reinforcement = Math.max(-10, (entry.reinforcement ?? 0) - 2);
    // If multiple regressions occur, automatically flag as disputed
    if (utility.regressions >= 3 && entry.status === "confirmed") {
      entry.status = "disputed";
    }
  }

  utility.reuse_success_rate = utility.application_count > 0
    ? utility.successful_applications / utility.application_count
    : 1.0;

  entry.updated_at = new Date().toISOString();
  save(store, entry);

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "application_outcome",
      entry_id: entry.id,
      project: entry.project,
      actor: options.actor ?? "agent",
      details: {
        success: options.success,
        regression: options.regression ?? false,
        notes: options.notes,
        success_rate: utility.reuse_success_rate,
        application_count: utility.application_count,
      },
    });
  }

  return entry;
}

export interface MemoryRoiReport {
  totalMemories: number;
  totalRetrievals: number;
  totalApplications: number;
  totalSuccessfulApplications: number;
  totalFailedApplications: number;
  totalRegressions: number;
  overallReuseSuccessRate: number;
  topPerformingMemories: { id: string; title: string; successCount: number; successRate: number }[];
  concerningMemories: { id: string; title: string; failCount: number; regressions: number }[];
}

/**
 * Computes memory return-on-investment (ROI) metrics across the store.
 */
export function computeMemoryRoi(
  store: Store,
  options?: { project?: string },
): MemoryRoiReport {
  const entries = list(store, options?.project ? { project: options.project } : undefined);

  let totalRetrievals = 0;
  let totalApplications = 0;
  let totalSuccessfulApplications = 0;
  let totalFailedApplications = 0;
  let totalRegressions = 0;

  const withUtility: MemoryEntry[] = [];

  for (const e of entries) {
    if (e.utility) {
      withUtility.push(e);
      totalRetrievals += e.utility.retrieval_count || 0;
      totalApplications += e.utility.application_count || 0;
      totalSuccessfulApplications += e.utility.successful_applications || 0;
      totalFailedApplications += e.utility.failed_applications || 0;
      totalRegressions += e.utility.regressions || 0;
    }
  }

  const overallReuseSuccessRate = totalApplications > 0
    ? totalSuccessfulApplications / totalApplications
    : 1.0;

  const topPerformingMemories = withUtility
    .filter((e) => (e.utility?.successful_applications ?? 0) > 0)
    .sort((a, b) => (b.utility?.successful_applications ?? 0) - (a.utility?.successful_applications ?? 0))
    .slice(0, 10)
    .map((e) => ({
      id: e.id,
      title: e.title,
      successCount: e.utility!.successful_applications,
      successRate: e.utility!.reuse_success_rate ?? 1.0,
    }));

  const concerningMemories = withUtility
    .filter((e) => (e.utility?.failed_applications ?? 0) > 0 || (e.utility?.regressions ?? 0) > 0)
    .sort((a, b) => ((b.utility?.regressions ?? 0) * 2 + (b.utility?.failed_applications ?? 0)) -
                    ((a.utility?.regressions ?? 0) * 2 + (a.utility?.failed_applications ?? 0)))
    .slice(0, 10)
    .map((e) => ({
      id: e.id,
      title: e.title,
      failCount: e.utility!.failed_applications,
      regressions: e.utility!.regressions,
    }));

  return {
    totalMemories: entries.length,
    totalRetrievals,
    totalApplications,
    totalSuccessfulApplications,
    totalFailedApplications,
    totalRegressions,
    overallReuseSuccessRate,
    topPerformingMemories,
    concerningMemories,
  };
}
