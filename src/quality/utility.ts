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
      regression_strikes: 0,
      clean_runs_since_regression: 0,
    };
  } else {
    if (entry.utility.regression_strikes === undefined) {
      entry.utility.regression_strikes = 0;
    }
    if (entry.utility.clean_runs_since_regression === undefined) {
      entry.utility.clean_runs_since_regression = 0;
    }
  }
  return entry.utility;
}

/**
 * Records that one or more memories were retrieved for an agent prompt context.
 */
export function recordRetrievals(store: Store, memoryIds: string[]): void {
  const uniqueIds = Array.from(new Set(memoryIds));
  for (const id of uniqueIds) {
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
  sessionId?: string;
  now?: number;
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
  const now = options.now ?? Date.now();
  const nowIso = new Date(now).toISOString();

  utility.application_count++;
  utility.last_applied_at = nowIso;

  if (options.success) {
    utility.successful_applications++;
    entry.reinforcement = (entry.reinforcement ?? 0) + 1;

    // T-313: Decay strikes via 2 clean runs
    utility.clean_runs_since_regression = (utility.clean_runs_since_regression ?? 0) + 1;
    if (utility.clean_runs_since_regression >= 2 && (utility.regression_strikes ?? 0) > 0) {
      utility.regression_strikes = Math.max(0, (utility.regression_strikes ?? 0) - 1);
      utility.clean_runs_since_regression = 0;
      if (store.memoryDir) {
        recordAuditEvent(store.memoryDir, {
          operation: "strike_decay",
          entry_id: entry.id,
          project: entry.project,
          actor: options.actor ?? "agent",
          details: {
            reason: "clean_runs",
            remaining_strikes: utility.regression_strikes,
          },
        });
      }
    }

    // T-313: Decay strikes via 30 days elapsed without recurring failure
    if (utility.last_regression_at && (utility.regression_strikes ?? 0) > 0) {
      const daysSinceRegression = (now - Date.parse(utility.last_regression_at)) / 86_400_000;
      if (daysSinceRegression >= 30) {
        utility.regression_strikes = Math.max(0, (utility.regression_strikes ?? 0) - 1);
        utility.last_regression_at = nowIso;
        if (store.memoryDir) {
          recordAuditEvent(store.memoryDir, {
            operation: "strike_decay",
            entry_id: entry.id,
            project: entry.project,
            actor: options.actor ?? "agent",
            details: {
              reason: "time_elapsed",
              days: daysSinceRegression,
              remaining_strikes: utility.regression_strikes,
            },
          });
        }
      }
    }
  } else {
    utility.failed_applications++;
    entry.reinforcement = Math.max(-5, (entry.reinforcement ?? 0) - 1);
  }

  if (options.regression) {
    utility.regressions++;
    entry.reinforcement = Math.max(-10, (entry.reinforcement ?? 0) - 2);

    // T-313: Session deduplication: at most 1 strike per session
    const isNewSession = !options.sessionId || utility.last_regression_session !== options.sessionId;
    if (isNewSession) {
      utility.regression_strikes = (utility.regression_strikes ?? 0) + 1;
      utility.last_regression_session = options.sessionId;
      utility.last_regression_at = nowIso;
      utility.clean_runs_since_regression = 0;

      if (store.memoryDir) {
        recordAuditEvent(store.memoryDir, {
          operation: "regression_strike",
          entry_id: entry.id,
          project: entry.project,
          actor: options.actor ?? "agent",
          details: {
            strikes: utility.regression_strikes,
            sessionId: options.sessionId,
            notes: options.notes,
          },
        });
      }
    }

    // T-313: Demotion check: 3 corroborated strikes required + constitutional immunity
    const isImmune =
      entry.type === "constraint" ||
      entry.temporal_mode === "timeless" ||
      (entry.salience ?? 0) >= 0.95;

    if ((utility.regression_strikes ?? 0) >= 3 && !isImmune && entry.status === "confirmed") {
      entry.status = "disputed";
      const disputer = options.actor ?? "automated_regression_sentry";
      entry.disputed_by = Array.isArray(entry.disputed_by)
        ? [...new Set([...entry.disputed_by, disputer])]
        : [disputer];
      if (store.memoryDir) {
        recordAuditEvent(store.memoryDir, {
          operation: "dispute_triggered",
          entry_id: entry.id,
          project: entry.project,
          actor: options.actor ?? "automated_regression_sentry",
          details: {
            strikes: utility.regression_strikes,
            regressions: utility.regressions,
            notes: options.notes,
          },
        });
      }
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
