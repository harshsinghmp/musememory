import type { Store } from "../store.ts";
import { get, list, save, supersede, reject } from "../store.ts";
import { recordAuditEvent } from "../audit.ts";
import type { MemoryEntry, MemoryType } from "../types.ts";
import { computeJaccardSimilarity, normalizeText } from "./dedup.ts";

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
 */
export function flagConflict(
  store: Store,
  existingId: string,
  newId: string,
  reason: string,
): { existing: MemoryEntry; incoming: MemoryEntry } {
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

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "conflict_detected",
      entry_id: newId,
      project: incoming.project,
      details: {
        conflicted_with: existingId,
        reason,
      },
    });
  }

  return { existing, incoming };
}

export interface ConflictResolutionOptions {
  winningId: string;
  losingId: string;
  reason: string;
  strategy: "supersede" | "historical" | "reject" | "keep_both";
  actor?: string;
}

export interface ConflictResolutionResult {
  success: boolean;
  winning: MemoryEntry;
  losing?: MemoryEntry;
  message: string;
}

/**
 * Resolves a conflicted pair according to specified resolution protocol:
 * - 'supersede': Losing memory is superseded by winning memory.
 * - 'historical': Losing memory preserved as historical context ("used to..."), winning marked current.
 * - 'reject': Losing memory rejected as invalid/false assertion.
 * - 'keep_both': Both un-conflicted with resolved contextual notes.
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
      },
    });
  }

  return {
    success: true,
    winning,
    losing: get(store, options.losingId) ?? undefined,
    message,
  };
}
