import { createHash, randomUUID } from "node:crypto";
import type { Store } from "../store.ts";
import { get, save, supersede, reject, listConflicts, getConflict, recordConflict } from "../store.ts";
import { insertOrUpdateConflict, findConflictBetween, type ConflictRecord } from "../sqlite.ts";
import type { FederationHandshakePacket, FederationHandshakeResult, VectorClock } from "./types.ts";
import { resolveLocalAgentId } from "./engine.ts";

/**
 * Computes a deterministic canonical dedup key for a pair of conflicting memories.
 * Guarantees [A, B] and [B, A] resolve to the exact same canonical string.
 */
export function getConflictDedupKey(memA: string, memB: string): string {
  return [memA, memB].sort().join("::");
}

/**
 * Computes SHA-256 checksum for a list of conflict records.
 */
export function computeConflictsChecksum(conflicts: ConflictRecord[]): string {
  const normalized = conflicts
    .map((c) => ({
      pairKey: getConflictDedupKey(c.memory_a_id, c.memory_b_id),
      status: c.status,
      strategy: c.resolution_strategy || "",
      resolved_at: c.resolved_at || "",
    }))
    .sort((a, b) => a.pairKey.localeCompare(b.pairKey));

  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

/**
 * Initiates an outgoing federation handshake packet containing local conflict state.
 */
export function initiateFederationHandshake(
  store: Store,
  options: {
    senderId?: string;
    targetId?: string;
    meshId?: string;
    vectorClock?: VectorClock;
  } = {},
): FederationHandshakePacket {
  const senderId = resolveLocalAgentId(options.senderId);
  const localConflicts = listConflicts(store);
  const checksum = computeConflictsChecksum(localConflicts);
  const handshakeId = `fhs_${senderId}_${Date.now()}_${randomUUID().slice(0, 6)}`;

  return {
    protocol_version: "2.0.0",
    handshake_id: handshakeId,
    sender_id: senderId,
    target_id: options.targetId,
    mesh_id: options.meshId || "mesh-global",
    created_at: new Date().toISOString(),
    vector_clock: options.vectorClock || {},
    conflicts: localConflicts,
    checksum,
  };
}

/**
 * Validates the checksum and structure of an incoming federation handshake packet.
 */
export function validateHandshakePacket(packet: FederationHandshakePacket): { valid: boolean; error?: string } {
  if (packet.protocol_version !== "2.0.0") {
    return { valid: false, error: `Unsupported protocol version: ${packet.protocol_version}` };
  }
  if (!packet.sender_id || !packet.handshake_id) {
    return { valid: false, error: "Missing required sender_id or handshake_id" };
  }
  if (!Array.isArray(packet.conflicts)) {
    return { valid: false, error: "Missing conflicts array in handshake payload" };
  }

  const expectedChecksum = computeConflictsChecksum(packet.conflicts as ConflictRecord[]);
  if (packet.checksum !== expectedChecksum) {
    return { valid: false, error: `Handshake checksum verification failed: expected ${expectedChecksum}, got ${packet.checksum}` };
  }

  return { valid: true };
}

/**
 * Applies a resolved conflict strategy to local memory entries if present in local store.
 */
function applyResolutionToLocalMemories(
  store: Store,
  winningId: string,
  losingId: string,
  strategy?: string,
  reason?: string,
): void {
  const win = get(store, winningId);
  const lose = get(store, losingId);
  if (!win && !lose) return;

  const desc = reason || "Reconciled via mesh federation handshake";

  if (strategy === "supersede") {
    if (win) {
      win.status = "confirmed";
      win.conflict_ids = (win.conflict_ids || []).filter((id) => id !== losingId);
      win.updated_at = new Date().toISOString();
      save(store, win);
    }
    if (lose) {
      if (win) {
        supersede(store, losingId, winningId);
      } else {
        lose.status = "superseded";
        lose.superseded_by = winningId;
        lose.conflict_ids = (lose.conflict_ids || []).filter((id) => id !== winningId);
        lose.updated_at = new Date().toISOString();
        save(store, lose);
      }
    }
  } else if (strategy === "keep_both") {
    if (win) {
      win.status = "confirmed";
      win.conflict_ids = (win.conflict_ids || []).filter((id) => id !== losingId);
      save(store, win);
    }
    if (lose) {
      lose.status = "confirmed";
      lose.conflict_ids = (lose.conflict_ids || []).filter((id) => id !== winningId);
      save(store, lose);
    }
  } else if (strategy === "historical") {
    if (win) {
      win.status = "confirmed";
      save(store, win);
    }
    if (lose) {
      lose.status = "active";
      lose.temporal_mode = "historical";
      if (!lose.title.startsWith("[HISTORICAL]")) {
        lose.title = `[HISTORICAL] ${lose.title}`;
      }
      lose.content = `${lose.content}\n\n*Historical Context: Superseded by ${winningId} due to: ${desc}*`;
      save(store, lose);
    }
  } else if (strategy === "reject") {
    if (win) {
      win.status = "confirmed";
      save(store, win);
    }
    if (lose) {
      reject(store, losingId);
    }
  }
}

/**
 * Processes an incoming federation handshake packet, deduplicating conflicts by canonical
 * pair key, reconciling resolutions, and updating the local SQLite conflicts table.
 */
export function processFederationHandshake(
  localStore: Store,
  packet: FederationHandshakePacket,
  options: { localAgentId?: string } = {},
): FederationHandshakeResult {
  const validation = validateHandshakePacket(packet);
  if (!validation.valid) {
    return {
      success: false,
      handshake_id: packet.handshake_id,
      sender_id: packet.sender_id,
      total_remote_conflicts: packet.conflicts?.length || 0,
      deduplicated_conflicts: 0,
      imported_conflicts: 0,
      reconciled_resolutions: 0,
      conflicts: listConflicts(localStore),
      errors: [validation.error || "Invalid handshake"],
    };
  }

  let deduplicatedCount = 0;
  let importedCount = 0;
  let reconciledResolutions = 0;
  const errors: string[] = [];

  for (const remoteC of packet.conflicts) {
    if (!remoteC.memory_a_id || !remoteC.memory_b_id) continue;

    // Search local database for existing conflict between this pair
    const localC = localStore.db
      ? findConflictBetween(localStore.db, remoteC.memory_a_id, remoteC.memory_b_id)
      : null;

    if (!localC) {
      // 1. Not present locally: import remote conflict record intact
      if (localStore.db) {
        insertOrUpdateConflict(localStore.db, remoteC as ConflictRecord);
      }
      importedCount++;

      // If remote record was already resolved, propagate resolution to local memories if present
      if (remoteC.status === "resolved" && remoteC.resolution_strategy) {
        applyResolutionToLocalMemories(
          localStore,
          remoteC.memory_a_id,
          remoteC.memory_b_id,
          remoteC.resolution_strategy,
          remoteC.reason,
        );
      }
    } else {
      // 2. Pair already exists locally: deduplicate and reconcile
      deduplicatedCount++;

      if (localC.status === "open" && remoteC.status === "resolved") {
        // Remote resolution wins over open local conflict
        localC.status = "resolved";
        localC.resolved_at = remoteC.resolved_at || new Date().toISOString();
        localC.resolution_strategy = remoteC.resolution_strategy;
        localC.resolved_by = `${remoteC.resolved_by || remoteC.data?.resolved_by || packet.sender_id} (mesh-handshake)`;
        localC.reason = remoteC.reason || localC.reason;
        localC.updated_at = new Date().toISOString();

        if (localStore.db) {
          insertOrUpdateConflict(localStore.db, localC);
        }

        applyResolutionToLocalMemories(
          localStore,
          remoteC.memory_a_id,
          remoteC.memory_b_id,
          remoteC.resolution_strategy,
          remoteC.reason,
        );
        reconciledResolutions++;
      } else if (localC.status === "resolved" && remoteC.status === "open") {
        // Local resolution preserved; no change needed
      } else if (localC.status === "resolved" && remoteC.status === "resolved") {
        // Both resolved: compare timestamps
        const localTime = localC.resolved_at || localC.updated_at;
        const remoteTime = remoteC.resolved_at || remoteC.updated_at;
        if (remoteTime > localTime) {
          localC.resolution_strategy = remoteC.resolution_strategy;
          localC.resolved_at = remoteC.resolved_at;
          localC.resolved_by = remoteC.resolved_by;
          localC.updated_at = new Date().toISOString();
          if (localStore.db) {
            insertOrUpdateConflict(localStore.db, localC);
          }
          applyResolutionToLocalMemories(
            localStore,
            remoteC.memory_a_id,
            remoteC.memory_b_id,
            remoteC.resolution_strategy,
            remoteC.reason,
          );
          reconciledResolutions++;
        }
      } else {
        // Both open: merge metadata without creating duplicate rows
        const earliestDetected = remoteC.detected_at < localC.detected_at ? remoteC.detected_at : localC.detected_at;
        const highestConfidence = Math.max(localC.confidence, remoteC.confidence);
        localC.detected_at = earliestDetected;
        localC.confidence = highestConfidence;
        localC.updated_at = new Date().toISOString();
        if (localStore.db) {
          insertOrUpdateConflict(localStore.db, localC);
        }
      }
    }
  }

  return {
    success: true,
    handshake_id: packet.handshake_id,
    sender_id: packet.sender_id,
    total_remote_conflicts: packet.conflicts.length,
    deduplicated_conflicts: deduplicatedCount,
    imported_conflicts: importedCount,
    reconciled_resolutions: reconciledResolutions,
    conflicts: listConflicts(localStore),
    errors,
  };
}
