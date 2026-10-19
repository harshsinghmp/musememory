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
export type { ConflictRecord };

export interface ConflictDetection {
  conflicted: boolean;
  conflictingEntry?: MemoryEntry;
  confidence: number;
  reason?: string;
}

// Common competing technology pairs / opposite polarities
const CONTRADICTORY_PAIRS: [RegExp, RegExp, string][] = [
  [/\b(enable|enabled|true)\b/i, /\b(disable|disabled|false)\b/i, "Opposing configuration polarity"],
  [/\b(allow|allowed)\b/i, /\b(deny|denied|disallow|disallowed|forbidden)\b/i, "Opposing permission rule"],
  [/\b(uses?\s+postgresql|postgres)\b/i, /\b(uses?\s+mysql|uses?\s+sqlite|uses?\s+mongodb)\b/i, "Conflicting primary database choice"],
  [/\b(port\s+3000)\b/i, /\b(port\s+8080|port\s+5000|port\s+4000)\b/i, "Conflicting port binding"],
  [/\b(rest\s+api)\b/i, /\b(graphql\s+only|grpc\s+only)\b/i, "Conflicting communication protocol"],
  [/\b(bun\s+runtime)\b/i, /\b(node\s+runtime\s+only|deno\s+only)\b/i, "Conflicting runtime engine"],
  [/\b(always)\b/i, /\b(never)\b/i, "Contradictory universal policy"],
];

/**
 * Detects if a candidate memory contradicts an existing active or confirmed memory.
 */
export function detectConflict(
  store: Store,
  candidate: { title: string; content: string; project?: string; type?: MemoryType; id?: string },
): ConflictDetection {
  const candidateText = `${candidate.title} ${candidate.content}`.toLowerCase();
  const entries = list(store, candidate.project ? { project: candidate.project } : undefined);

  for (const entry of entries) {
    // Skip self
    if (candidate.id && entry.id === candidate.id) continue;
    // Only check active or confirmed memories
    if (entry.status !== "active" && entry.status !== "confirmed" && entry.status !== "conflicted") {
      continue;
    }

    const entryText = `${entry.title} ${entry.content}`.toLowerCase();
    const topicSimilarity = computeJaccardSimilarity(candidate.title, entry.title);

    // 1. High title/topic similarity with polarity opposition
    if (topicSimilarity >= 0.4 || (entry.type && candidate.type && entry.type === candidate.type && topicSimilarity >= 0.3)) {
      for (const [patternA, patternB, reason] of CONTRADICTORY_PAIRS) {
        const aInCand = patternA.test(candidateText);
        const bInCand = patternB.test(candidateText);
        const aInEntry = patternA.test(entryText);
        const bInEntry = patternB.test(entryText);

        if ((aInCand && bInEntry) || (bInCand && aInEntry)) {
          return {
            conflicted: true,
            conflictingEntry: entry,
            confidence: 0.85,
            reason: `${reason} between candidate and "${entry.title}" (${entry.id})`,
          };
        }
      }

      // Direct negation: "never X" vs "always X" or "do not X" vs "X"
      if (
        (candidateText.includes("do not") && !entryText.includes("do not") && topicSimilarity > 0.6) ||
        (!candidateText.includes("do not") && entryText.includes("do not") && topicSimilarity > 0.6)
      ) {
        return {
          conflicted: true,
          conflictingEntry: entry,
          confidence: 0.8,
          reason: `Direct negation detected on topic "${entry.title}" (${entry.id})`,
        };
      }
    }
  }

  return { conflicted: false, confidence: 0 };
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
  existing.status = "conflicted";
  existing.quality = "CONFLICTED";
  existing.updated_at = new Date().toISOString();
  save(store, existing);

  // Update incoming
  const incomingConflicts = new Set(incoming.conflict_ids || []);
  incomingConflicts.add(existingId);
  incoming.conflict_ids = [...incomingConflicts];
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
