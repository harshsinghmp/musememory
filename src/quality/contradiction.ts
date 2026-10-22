import { randomUUID } from "node:crypto";
import type { Store } from "../store.ts";
import { get, list, save, supersede, reject } from "../store.ts";
import { recordAuditEvent } from "../audit.ts";
import type { MemoryEntry, MemoryType } from "../types.ts";
import { computeJaccardSimilarity, normalizeText } from "./dedup.ts";
import {
  type ConflictRecord,
  insertOrUpdateConflict,
  getConflictById,
  findConflictBetween,
  listConflictsFromDb,
} from "../sqlite.ts";
import {
  evaluateScopedInvalidation,
  extractFactTriples,
  evaluateScopedAlignment,
  type SemanticFactTriple,
  type ScopedInvalidationResult,
} from "./invalidation.ts";
import { comparePolarityClaims, extractPolarityClaims } from "./polarity.ts";
export {
  evaluateScopedInvalidation,
  extractFactTriples,
  evaluateScopedAlignment,
  type SemanticFactTriple,
  type ScopedInvalidationResult,
};
export type { ConflictRecord };

export interface ConflictDetection {
  conflicted: boolean;
  conflictingEntry?: MemoryEntry;
  confidence: number;
  reason?: string;
  /** T-320: true when the detection was produced in dry-run mode (no mutation applied). */
  dryRun?: boolean;
}

export interface ConflictDetectionOptions {
  /**
   * T-320: detect without applying any mutation. Detection itself is pure;
   * the flag is echoed on the result so callers can prove no state changed.
   */
  dryRun?: boolean;
}

/**
 * Minimum confidence a detection must reach before it is allowed to poison
 * both sides of a memory pair. Flagging costs 25 health points per memory and
 * removes both from every future sync broadcast, so the bar is deliberately
 * high.
 */
export const MIN_CONFLICT_CONFIDENCE = 0.8;

/**
 * Detects if a candidate memory contradicts an existing active or confirmed memory.
 *
 * T-320: a contradiction now requires a *claim-level* opposition — the same
 * subject, the same relation, opposite target values, in a compatible scope.
 * The previous implementation compared two memories by testing seven bare
 * regex pairs against their concatenated title and content, so any two
 * memories that happened to contain an "enable"-ish and a "disable"-ish word
 * were flagged as contradictory regardless of what they were about.
 */
export function detectConflict(
  store: Store,
  candidate: {
    title: string;
    content: string;
    project?: string;
    type?: MemoryType;
    id?: string;
    triples?: SemanticFactTriple[];
    tags?: string[];
  },
  options?: ConflictDetectionOptions,
): ConflictDetection {
  const dryRun = options?.dryRun === true;
  const candidateText = `${candidate.title || ""} ${candidate.content || ""}`;
  const candidateClaims = extractPolarityClaims(candidateText);
  const entries = list(store, candidate.project ? { project: candidate.project } : undefined);

  for (const entry of entries) {
    // Skip self
    if (candidate.id && entry.id === candidate.id) continue;
    // Only check active or confirmed memories
    if (entry.status !== "active" && entry.status !== "confirmed" && entry.status !== "conflicted") {
      continue;
    }

    // T-087/T-320: semantic (entity, relation, target) alignment. Only
    // author-supplied triples take this path: the heuristic fact extractor
    // binds subjects loosely (a port is always "gateway", a database is
    // always "database"), which produced false positives between unrelated
    // memories. Heuristic facts are handled by the claim comparison below,
    // which binds the subject explicitly.
    const existingTriples = entry.triples && entry.triples.length > 0 ? extractFactTriples(entry) : [];
    const candidateTriples =
      candidate.triples && candidate.triples.length > 0 ? extractFactTriples(candidate) : [];
    if (existingTriples.length > 0 && candidateTriples.length > 0) {
      for (const existingTriple of existingTriples) {
        for (const candidateTriple of candidateTriples) {
          const alignment = evaluateScopedAlignment(existingTriple, candidateTriple);
          if (alignment.aligned && alignment.conflicting) {
            return {
              conflicted: true,
              conflictingEntry: entry,
              confidence: 0.95,
              reason: alignment.reason,
              dryRun,
            };
          }
        }
      }
    }

    // T-320: subject-bound, scope-aware polarity comparison. Distinct scopes
    // are distinct contextual truths, not contradictions.
    const entryText = `${entry.title || ""} ${entry.content || ""}`;
    const entryClaims = extractPolarityClaims(entryText);
    for (const candidateClaim of candidateClaims) {
      for (const entryClaim of entryClaims) {
        const comparison = comparePolarityClaims(candidateClaim, entryClaim);
        if (comparison.conflicting) {
          return {
            conflicted: true,
            conflictingEntry: entry,
            confidence: 0.85,
            reason: comparison.reason,
            dryRun,
          };
        }
      }
    }

    // Direct negation: "never X" vs "X" or "do not X" vs "X" on the same topic.
    const candidateLower = candidateText.toLowerCase();
    const entryLower = entryText.toLowerCase();
    const topicSimilarity = computeJaccardSimilarity(candidate.title || "", entry.title || "");
    if (
      topicSimilarity > 0.6 &&
      ((candidateLower.includes("do not") && !entryLower.includes("do not")) ||
        (!candidateLower.includes("do not") && entryLower.includes("do not")))
    ) {
      return {
        conflicted: true,
        conflictingEntry: entry,
        confidence: 0.8,
        reason: `Direct negation detected on topic "${entry.title}" (${entry.id})`,
        dryRun,
      };
    }
  }

  return { conflicted: false, confidence: 0, dryRun };
}

/**
 * T-320: Scans a store for memory pairs that the contradiction engine WOULD
 * flag, without mutating anything.
 *
 * This is the dry-run surface: an operator can measure the blast radius of
 * automatic conflict flagging on a real store before enabling it, instead of
 * discovering it as a health-gate failure afterwards.
 */
export interface PotentialConflict {
  entry_a_id: string;
  entry_a_title: string;
  entry_b_id: string;
  entry_b_title: string;
  confidence: number;
  reason?: string;
}

export function scanPotentialConflicts(
  store: Store,
  options?: { project?: string; limit?: number },
): PotentialConflict[] {
  const entries = list(store, options?.project ? { project: options.project } : undefined).filter(
    (entry) => entry.status === "active" || entry.status === "confirmed",
  );

  const claimsById = new Map<string, ReturnType<typeof extractPolarityClaims>>();
  for (const entry of entries) {
    claimsById.set(entry.id, extractPolarityClaims(`${entry.title || ""} ${entry.content || ""}`));
  }

  const found: PotentialConflict[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      const aClaims = claimsById.get(a.id) ?? [];
      const bClaims = claimsById.get(b.id) ?? [];
      let conflict: { conflicting: boolean; reason?: string } | null = null;
      for (const aClaim of aClaims) {
        for (const bClaim of bClaims) {
          const comparison = comparePolarityClaims(aClaim, bClaim);
          if (comparison.conflicting) {
            conflict = comparison;
            break;
          }
        }
        if (conflict) break;
      }
      if (conflict) {
        found.push({
          entry_a_id: a.id,
          entry_a_title: a.title,
          entry_b_id: b.id,
          entry_b_title: b.title,
          confidence: 0.85,
          reason: conflict.reason,
        });
      }
    }
  }

  return options?.limit !== undefined ? found.slice(0, options.limit) : found;
}

/**
 * Flags both memories into CONFLICTED state with mutual cross-references.
 * Preserves BOTH memories in the store and records the conflict into the
 * persistent SQLite conflicts table (keep-both, never delete).
 */
export function flagConflict(
  store: Store,
  existingId: string,
  newId: string,
  reason: string,
  options?: {
    conflict_type?: string;
    confidence?: number;
    data?: Record<string, any>;
    conflictId?: string;
  },
): { existing: MemoryEntry; incoming: MemoryEntry; conflict?: ConflictRecord } {
  const existing = get(store, existingId);
  const incoming = get(store, newId);

  if (!existing || !incoming) {
    throw new Error(`Cannot flag conflict: memory not found (existing: ${existingId}, incoming: ${newId})`);
  }

  // Update existing
  const existingConflicts = new Set(existing.conflict_ids || []);
  existingConflicts.add(newId);
  existing.conflict_ids = [...existingConflicts];
  if (!existing.conflicts_with_id) {
    existing.conflicts_with_id = newId;
  }
  existing.status = "conflicted";
  existing.quality = "CONFLICTED";
  existing.updated_at = new Date().toISOString();
  save(store, existing);

  // Update incoming
  const incomingConflicts = new Set(incoming.conflict_ids || []);
  incomingConflicts.add(existingId);
  incoming.conflict_ids = [...incomingConflicts];
  incoming.conflicts_with_id = existingId;
  incoming.status = "conflicted";
  incoming.quality = "CONFLICTED";
  incoming.updated_at = new Date().toISOString();
  save(store, incoming);

  // Record into persistent conflicts table (keep-both, never delete)
  let conflictRecord: ConflictRecord | undefined;
  if (store.db) {
    const existingCfl = findConflictBetween(store.db, existingId, newId);
    const now = new Date().toISOString();
    if (existingCfl) {
      conflictRecord = {
        ...existingCfl,
        status: "open",
        reason: reason || existingCfl.reason,
        updated_at: now,
      };
      insertOrUpdateConflict(store.db, conflictRecord);
    } else {
      conflictRecord = {
        id: options?.conflictId || `cfl_${randomUUID().slice(0, 8)}`,
        memory_a_id: existingId,
        memory_b_id: newId,
        status: "open",
        conflict_type: options?.conflict_type ?? "opposing_polarity",
        confidence: options?.confidence ?? 0.85,
        reason,
        detected_at: now,
        data: options?.data,
        created_at: now,
        updated_at: now,
      };
      insertOrUpdateConflict(store.db, conflictRecord);
    }
  }

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "conflict_detected",
      entry_id: newId,
      project: incoming.project,
      details: {
        conflicted_with: existingId,
        reason,
        conflict_id: conflictRecord?.id,
      },
    });
  }

  return { existing, incoming, conflict: conflictRecord };
}

export interface ConflictResolutionOptions {
  winningId: string;
  losingId: string;
  reason: string;
  strategy: "supersede" | "historical" | "reject" | "keep_both";
  actor?: string;
  conflictId?: string;
}

export interface ConflictResolutionResult {
  success: boolean;
  winning: MemoryEntry;
  losing?: MemoryEntry;
  conflict?: ConflictRecord;
  message: string;
}

/**
 * Resolves a conflicted pair according to specified resolution protocol:
 * - 'supersede': Losing memory is superseded by winning memory.
 * - 'historical': Losing memory preserved as historical context ("used to..."), winning marked current.
 * - 'reject': Losing memory rejected as invalid/false assertion.
 * - 'keep_both': Both un-conflicted with resolved contextual notes.
 *
 * Crucially: Neither memory nor the conflict row is ever deleted. The conflict row
 * is updated to status: 'resolved' with full resolution strategy attribution.
 */
export function resolveConflict(
  store: Store,
  options: ConflictResolutionOptions,
): ConflictResolutionResult {
  const winning = get(store, options.winningId);
  const losing = get(store, options.losingId);

  if (!winning || !losing) {
    throw new Error(`Cannot resolve conflict: entries not found (${options.winningId}, ${options.losingId})`);
  }

  // Remove mutual conflict IDs
  winning.conflict_ids = (winning.conflict_ids || []).filter((id) => id !== options.losingId);
  losing.conflict_ids = (losing.conflict_ids || []).filter((id) => id !== options.winningId);

  // Winning is confirmed and current
  winning.status = "confirmed";
  winning.temporal_mode = winning.temporal_mode === "timeless" ? "timeless" : "current";
  winning.updated_at = new Date().toISOString();
  save(store, winning);

  let message = "";

  if (options.strategy === "supersede") {
    supersede(store, options.losingId, options.winningId);
    message = `Memory ${options.losingId} superseded by ${options.winningId}: ${options.reason}`;
  } else if (options.strategy === "historical") {
    losing.status = "active";
    losing.temporal_mode = "historical";
    losing.title = losing.title.startsWith("[HISTORICAL]") ? losing.title : `[HISTORICAL] ${losing.title}`;
    losing.content = `${losing.content}\n\n*Historical Context: Superseded by ${options.winningId} (${winning.title}) due to: ${options.reason}*`;
    losing.updated_at = new Date().toISOString();
    save(store, losing);
    message = `Preserved ${options.losingId} as historical record, established ${options.winningId} as current: ${options.reason}`;
  } else if (options.strategy === "reject") {
    reject(store, options.losingId);
    message = `Rejected invalid memory ${options.losingId}, confirmed ${options.winningId}: ${options.reason}`;
  } else {
    // keep_both
    losing.status = "confirmed";
    save(store, losing);
    message = `Retained both memories ${options.winningId} and ${options.losingId} as distinct contextual truths: ${options.reason}`;
  }

  // Update conflicts table in SQLite (never delete!)
  let resolvedConflict: ConflictRecord | undefined;
  if (store.db) {
    let conflictRecord = options.conflictId ? getConflictById(store.db, options.conflictId) : null;
    if (!conflictRecord) {
      conflictRecord = findConflictBetween(store.db, options.winningId, options.losingId);
    }
    const now = new Date().toISOString();
    if (conflictRecord) {
      conflictRecord.status = "resolved";
      conflictRecord.resolved_at = now;
      conflictRecord.resolution_strategy = options.strategy;
      conflictRecord.resolved_by = options.actor ?? "system";
      conflictRecord.updated_at = now;
      insertOrUpdateConflict(store.db, conflictRecord);
      resolvedConflict = conflictRecord;
    } else {
      resolvedConflict = {
        id: options.conflictId ?? `cfl_${randomUUID().slice(0, 8)}`,
        memory_a_id: options.winningId,
        memory_b_id: options.losingId,
        status: "resolved",
        conflict_type: "manual_resolution",
        confidence: 1.0,
        reason: options.reason,
        detected_at: now,
        resolved_at: now,
        resolution_strategy: options.strategy,
        resolved_by: options.actor ?? "system",
        created_at: now,
        updated_at: now,
      };
      insertOrUpdateConflict(store.db, resolvedConflict);
    }
  }

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "conflict_resolved",
      entry_id: options.winningId,
      project: winning.project,
      actor: options.actor ?? "system",
      details: {
        strategy: options.strategy,
        winning_id: options.winningId,
        losing_id: options.losingId,
        reason: options.reason,
        conflict_id: resolvedConflict?.id,
      },
    });
  }

  return {
    success: true,
    winning,
    losing: get(store, options.losingId) ?? undefined,
    conflict: resolvedConflict,
    message,
  };
}

/**
 * Lists conflicts from the persistent SQLite conflicts table.
 */
export function listConflicts(
  store: Store,
  options?: { status?: string; memoryId?: string; limit?: number },
): ConflictRecord[] {
  if (!store.db) return [];
  return listConflictsFromDb(store.db, options);
}

/**
 * Retrieves a conflict record by ID from SQLite.
 */
export function getConflict(store: Store, id: string): ConflictRecord | null {
  if (!store.db) return null;
  return getConflictById(store.db, id);
}

/**
 * Records a conflict directly into the SQLite conflicts table without deleting any memories.
 */
export function recordConflict(
  store: Store,
  conflict: Partial<ConflictRecord> & { memory_a_id: string; memory_b_id: string },
): ConflictRecord {
  const now = new Date().toISOString();
  const record: ConflictRecord = {
    id: conflict.id || `cfl_${randomUUID().slice(0, 8)}`,
    memory_a_id: conflict.memory_a_id,
    memory_b_id: conflict.memory_b_id,
    status: conflict.status ?? "open",
    conflict_type: conflict.conflict_type ?? "opposing_assertion",
    confidence: conflict.confidence ?? 1.0,
    reason: conflict.reason,
    detected_at: conflict.detected_at ?? now,
    resolved_at: conflict.resolved_at,
    resolution_strategy: conflict.resolution_strategy,
    resolved_by: conflict.resolved_by,
    data: conflict.data,
    created_at: conflict.created_at ?? now,
    updated_at: now,
  };
  if (store.db) {
    insertOrUpdateConflict(store.db, record);
  }
  return record;
}
