import type { Store } from "../store.ts";
import { get, list, save } from "../store.ts";
import { recordAuditEvent } from "../audit.ts";
import type { MemoryEntry, MemoryStatus, MemoryScope } from "../types.ts";
import type { ArchivalEvaluation, ArchivalResult, RehydrationResult, LifecycleStats } from "./types.ts";
import { stalePolicyDays, daysSince } from "../retrieval.ts";
import { evaluatePromotion, getEntryScope } from "./engine.ts";

/**
 * Evaluates memory entry against the archival lifecycle:
 * ACTIVE -> COLD -> DORMANT -> ARCHIVED
 */
export function evaluateArchival(entry: MemoryEntry, now: number = Date.now()): ArchivalEvaluation {
  const ageDays = daysSince(entry.updated_at, now);
  const applicationCount = entry.utility?.application_count ?? 0;
  const successRate = entry.utility?.reuse_success_rate ?? 0;
  const utilityScore = (applicationCount * 0.7) + (successRate * 0.3);
  const isSuperseded = entry.status === "superseded" || Boolean(entry.superseded_by);

  // 1. Explicitly superseded or rejected memories should be fully archived
  if (isSuperseded || entry.status === "rejected") {
    return {
      id: entry.id,
      current_status: entry.status,
      recommended_status: "archived",
      reason: isSuperseded ? "Entry has been superseded by a newer verified memory" : "Entry was rejected during validation",
      age_days: ageDays,
      utility_score: utilityScore,
      is_superseded: isSuperseded,
    };
  }

  // 2. Already archived entries stay archived
  if (entry.status === "archived") {
    return {
      id: entry.id,
      current_status: entry.status,
      recommended_status: "archived",
      reason: entry.archive_reason || "Entry is currently archived",
      age_days: ageDays,
      utility_score: utilityScore,
      is_superseded: isSuperseded,
    };
  }

  // 3. Timeless entries (core architectural axioms) are never auto-archived
  if (entry.temporal_mode === "timeless" || entry.type === "constraint") {
    return {
      id: entry.id,
      current_status: entry.status,
      recommended_status: "active",
      reason: "Timeless constraint is exempt from archival decay",
      age_days: ageDays,
      utility_score: utilityScore,
      is_superseded: false,
    };
  }

  // 4. Stale policy evaluation
  const policyDays = stalePolicyDays(entry.type) ?? 90;

  // Transition: DORMANT -> ARCHIVED (no usage after 180 days in dormant)
  if (entry.status === "dormant" && ageDays > (policyDays * 2)) {
    return {
      id: entry.id,
      current_status: entry.status,
      recommended_status: "archived",
      reason: `Unused for ${ageDays.toFixed(0)} days while dormant; exceeding 2x staleness policy (${policyDays * 2}d)`,
      age_days: ageDays,
      utility_score: utilityScore,
      is_superseded: false,
    };
  }

  // Transition: COLD -> DORMANT (no usage after policy period in cold)
  if (entry.status === "cold" && ageDays > policyDays) {
    return {
      id: entry.id,
      current_status: entry.status,
      recommended_status: "dormant",
      reason: `No activity for ${ageDays.toFixed(0)} days in cold tier; transitioning to dormant`,
      age_days: ageDays,
      utility_score: utilityScore,
      is_superseded: false,
    };
  }

  // Transition: ACTIVE/CONFIRMED -> COLD (aging beyond policy with 0 usage)
  if ((entry.status === "active" || entry.status === "confirmed" || entry.status === "stale") && ageDays > policyDays && applicationCount === 0) {
    return {
      id: entry.id,
      current_status: entry.status,
      recommended_status: "cold",
      reason: `Age ${ageDays.toFixed(0)} days exceeds policy (${policyDays}d) with zero recorded utility applications`,
      age_days: ageDays,
      utility_score: utilityScore,
      is_superseded: false,
    };
  }

  return {
    id: entry.id,
    current_status: entry.status,
    recommended_status: "active",
    reason: "Memory remains active within policy windows or shows active utility",
    age_days: ageDays,
    utility_score: utilityScore,
    is_superseded: false,
  };
}

/**
 * Transitions memory entry to a cold, dormant, or archived tier.
 */
export function archiveMemory(
  store: Store,
  id: string,
  targetTier: "cold" | "dormant" | "archived",
  reason: string,
  actor: string = "agent"
): ArchivalResult {
  const entry = get(store, id);
  if (!entry) {
    return {
      archived: false,
      entry_id: id,
      previous_status: "stale",
      new_status: targetTier,
      reason,
      message: `Memory entry '${id}' not found in store`,
    };
  }

  const prevStatus = entry.status;
  const now = new Date().toISOString();

  entry.status = targetTier;
  entry.archive_reason = reason;
  entry.archived_at = now;
  if (!entry.valid_to && targetTier === "archived") {
    entry.valid_to = now;
  }
  entry.updated_at = now;

  save(store, entry);

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "archive",
      entry_id: id,
      project: entry.project,
      actor,
      reason,
      details: { previous_status: prevStatus, target_tier: targetTier },
    });
  }

  return {
    archived: true,
    entry_id: id,
    previous_status: prevStatus,
    new_status: targetTier,
    reason,
    message: `Transitioned memory '${id}' from '${prevStatus}' to '${targetTier}' tier (${reason})`,
  };
}

/**
 * Restores an archived, dormant, or cold memory back to active/confirmed status upon strong relevance match.
 */
export function rehydrateMemory(
  store: Store,
  id: string,
  queryScore: number,
  reason: string = "High relevance query detected during search retrieval",
  actor: string = "agent"
): RehydrationResult {
  const entry = get(store, id);
  if (!entry) {
    return {
      rehydrated: false,
      entry_id: id,
      previous_status: "archived",
      new_status: "active",
      rehydration_score: queryScore,
      message: `Memory entry '${id}' not found in store`,
    };
  }

  const prevStatus = entry.status;
  const now = new Date().toISOString();

  // Determine restored status
  const restoredStatus: MemoryStatus = entry.verification?.level && entry.verification.level !== "unverified"
    ? "confirmed"
    : "active";

  entry.status = restoredStatus;
  entry.updated_at = now;
  delete entry.valid_to;
  delete entry.archive_reason;

  // Bump utility retrieval count
  if (!entry.utility) {
    entry.utility = {
      retrieval_count: 1,
      application_count: 0,
      successful_applications: 0,
      failed_applications: 0,
      regressions: 0,
      contradictions: 0,
      last_applied_at: now,
    };
  } else {
    entry.utility.retrieval_count = (entry.utility.retrieval_count || 0) + 1;
  }

  save(store, entry);

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "rehydrate",
      entry_id: id,
      project: entry.project,
      actor,
      reason,
      details: {
        previous_status: prevStatus,
        restored_status: restoredStatus,
        rehydration_score: queryScore,
      },
    });
  }

  return {
    rehydrated: true,
    entry_id: id,
    previous_status: prevStatus,
    new_status: restoredStatus,
    rehydration_score: queryScore,
    message: `Rehydrated memory '${id}' from '${prevStatus}' to '${restoredStatus}' (score: ${queryScore.toFixed(3)})`,
  };
}

/**
 * Runs an archival evaluation sweep across all entries in the store.
 */
export function autoArchiveSweep(
  store: Store,
  now: number = Date.now()
): { swept: number; cold: string[]; dormant: string[]; archived: string[] } {
  const entries = list(store);
  const result = { swept: 0, cold: [] as string[], dormant: [] as string[], archived: [] as string[] };

  for (const entry of entries) {
    const evaluation = evaluateArchival(entry, now);
    if (evaluation.recommended_status !== entry.status && evaluation.recommended_status !== "active") {
      archiveMemory(store, entry.id, evaluation.recommended_status, evaluation.reason, "system_sweeper");
      result.swept++;
      result[evaluation.recommended_status].push(entry.id);
    }
  }

  return result;
}

/**
 * Compiles lifecycle statistics across all memories in the store.
 */
export function getLifecycleStats(store: Store): LifecycleStats {
  const entries = list(store);
  const byStatus: Record<string, number> = {};
  const byScope: Record<string, number> = {};
  let promotionCandidates = 0;
  let archivalCandidates = 0;

  for (const entry of entries) {
    byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
    const scope = getEntryScope(entry);
    byScope[scope] = (byScope[scope] || 0) + 1;

    const promEval = evaluatePromotion(entry);
    if (promEval.eligible && scope !== "global") {
      promotionCandidates++;
    }

    const archEval = evaluateArchival(entry);
    if (archEval.recommended_status !== entry.status && archEval.recommended_status !== "active") {
      archivalCandidates++;
    }
  }

  return {
    total: entries.length,
    by_status: byStatus,
    by_scope: byScope,
    promotion_candidates: promotionCandidates,
    archival_candidates: archivalCandidates,
  };
}
