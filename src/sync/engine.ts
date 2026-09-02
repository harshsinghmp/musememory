import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import type { Store } from "../store.ts";
import { list, get, save, supersede } from "../store.ts";
import { getAuditTrail } from "../audit.ts";
import { parseCurrentFile, writeCurrentFile } from "../governor.ts";
import { scanSecrets } from "../secrets.ts";
import { detectConflict } from "../quality/contradiction.ts";
import { findDuplicates } from "../quality/dedup.ts";
import type { MemoryEntry } from "../types.ts";
import type {
  SyncPacket,
  BroadcastOptions,
  SyncResult,
  PeerRecord,
  SyncStatusReport,
  VectorClock,
  GossipSupersession,
} from "./types.ts";
import { buildSyncPacket, validateSyncPacket } from "./packet.ts";

/**
 * Returns the default agent ID based on environment or machine context.
 */
export function resolveLocalAgentId(providedId?: string): string {
  if (providedId && providedId.trim()) return providedId.trim();
  if (process.env.MUSE_AGENT_ID && process.env.MUSE_AGENT_ID.trim()) {
    return process.env.MUSE_AGENT_ID.trim();
  }
  const user = process.env.USER || process.env.USERNAME || "agent";
  return `${user}@${hostname()}`;
}

/**
 * Returns path to peers registry file (.memory/sync/peers.json).
 */
function peersFilePath(memoryDir: string): string {
  return join(memoryDir, "sync", "peers.json");
}

/**
 * Loads registered peers from disk.
 */
export function loadPeers(memoryDir: string): Record<string, PeerRecord> {
  const file = peersFilePath(memoryDir);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Persists registered peers to disk.
 */
export function savePeers(memoryDir: string, peers: Record<string, PeerRecord>): void {
  const dir = join(memoryDir, "sync");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(peersFilePath(memoryDir), JSON.stringify(peers, null, 2), "utf-8");
}

/**
 * Assembles a portable SyncPacket of confirmed memories, constraints, and supersessions.
 */
export function broadcastKnowledge(
  store: Store,
  workspaceRoot: string,
  options: BroadcastOptions = {}
): SyncPacket {
  const agentId = resolveLocalAgentId(options.agentId);
  const project = options.project || "default";

  // 1. Gather memories
  const allEntries = list(store);
  const eligible = allEntries.filter((m) => {
    if (options.project && m.project !== options.project) return false;
    if (options.sinceTimestamp && m.updated_at < options.sinceTimestamp) return false;
    if (m.status !== "confirmed" && m.status !== "active") return false;
    if (m.temporal_mode === "historical" && options.includeHistorical === false) return false;
    return true;
  });

  const uniqueMap = new Map<string, MemoryEntry>();
  for (const m of eligible) {
    uniqueMap.set(m.id, m);
  }
  const dedupedEligible = Array.from(uniqueMap.values());
  const memories = options.limit ? dedupedEligible.slice(0, options.limit) : dedupedEligible;

  // 2. Gather active constraints
  const memoryDir = store.memoryDir || join(workspaceRoot, ".memory");
  const currentData = parseCurrentFile(memoryDir);
  const constraints = currentData.constraints;

  // 3. Gather recent supersessions from audit log
  const supersessions: GossipSupersession[] = [];
  if (store.memoryDir) {
    const auditEvents = getAuditTrail(store.memoryDir, { operation: "supersede", limit: 50 });
    for (const ev of auditEvents) {
      if (ev.details && ev.details.superseded_by) {
        supersessions.push({
          old_id: ev.entry_id,
          new_id: ev.details.superseded_by,
          reason: ev.reason || "Superseded by confirmed memory",
          actor: ev.actor || agentId,
          timestamp: ev.timestamp,
        });
      }
    }
  }

  // 4. Build local vector clock
  const peers = loadPeers(memoryDir);
  const localClock: VectorClock = {
    [agentId]: memories.length + supersessions.length + Date.now(),
  };
  for (const [peerId, record] of Object.entries(peers)) {
    if (record.vector_clock && record.vector_clock[peerId]) {
      localClock[peerId] = record.vector_clock[peerId];
    }
  }

  return buildSyncPacket({
    senderId: agentId,
    project,
    memories,
    constraints,
    supersessions,
    vectorClock: localClock,
  });
}

/**
 * Ingests a peer gossip packet with Vibeguard secret inspection, deduplication, and contradiction resolution.
 */
export function ingestKnowledge(
  store: Store,
  workspaceRoot: string,
  packet: SyncPacket,
  localAgentId?: string
): SyncResult {
  const localId = resolveLocalAgentId(localAgentId);
  const result: SyncResult = {
    success: true,
    sender_id: packet.sender_id,
    packet_id: packet.packet_id,
    ingested_count: 0,
    duplicate_count: 0,
    conflict_count: 0,
    superseded_count: 0,
    details: {
      ingested_ids: [],
      duplicate_ids: [],
      conflicted_ids: [],
      superseded_ids: [],
    },
    errors: [],
  };

  // 1. Validate packet
  const validation = validateSyncPacket(packet);
  if (!validation.valid) {
    result.success = false;
    result.errors.push(validation.error || "Invalid packet");
    return result;
  }

  // 2. Vibeguard secret scan across incoming memories
  for (const mem of packet.payload.memories) {
    const combined = `${mem.title} ${mem.content}`;
    const secrets = scanSecrets(combined);
    if (secrets.length > 0) {
      result.success = false;
      result.errors.push(
        `Vibeguard rejected packet from ${packet.sender_id}: detected secret pattern '${secrets[0]}' in memory '${mem.id}'`
      );
      return result;
    }
  }

  const memoryDir = store.memoryDir || join(workspaceRoot, ".memory");

  // 3. Process each incoming memory
  for (const incoming of packet.payload.memories) {
    const existing = get(store, incoming.id);

    // Exact ID match
    if (existing) {
      if (existing.updated_at >= incoming.updated_at) {
        result.duplicate_count++;
        result.details.duplicate_ids.push(incoming.id);
        continue;
      }
      // Incoming is strictly newer: update
      save(store, incoming);
      result.ingested_count++;
      result.details.ingested_ids.push(incoming.id);
      continue;
    }

    // Content deduplication check
    const dupes = findDuplicates(store, {
      title: incoming.title,
      content: incoming.content,
      project: incoming.project,
      threshold: 0.95,
    });
    if (dupes.exact || dupes.similar.length > 0) {
      result.duplicate_count++;
      result.details.duplicate_ids.push(incoming.id);
      continue;
    }

    // Semantic Contradiction Check
    const conflict = detectConflict(store, incoming);
    if (conflict.conflicted && conflict.conflictingEntry && conflict.confidence > 0.75) {
      const conflicting = conflict.conflictingEntry;
      conflicting.status = "conflicted";
      conflicting.conflict_ids = Array.from(new Set([...(conflicting.conflict_ids || []), incoming.id]));
      save(store, conflicting);

      incoming.status = "conflicted";
      incoming.conflict_ids = [conflicting.id];
      save(store, incoming);

      result.conflict_count++;
      result.details.conflicted_ids.push(incoming.id);
      continue;
    }

    // Clean entry: save
    save(store, incoming);
    result.ingested_count++;
    result.details.ingested_ids.push(incoming.id);
  }

  // 4. Ingest constraints
  if (Array.isArray(packet.payload.constraints)) {
    const currentData = parseCurrentFile(memoryDir);
    let constraintsModified = false;
    for (const c of packet.payload.constraints) {
      if (!currentData.constraints.includes(c)) {
        currentData.constraints.push(c);
        constraintsModified = true;
      }
    }
    if (constraintsModified) {
      writeCurrentFile(memoryDir, currentData);
    }
  }

  // 5. Ingest supersessions
  if (Array.isArray(packet.payload.supersessions)) {
    for (const s of packet.payload.supersessions) {
      const oldMem = get(store, s.old_id);
      const newMem = get(store, s.new_id);
      if (oldMem && newMem && oldMem.status !== "superseded") {
        supersede(store, s.old_id, s.new_id);
        result.superseded_count++;
        result.details.superseded_ids.push(s.old_id);
      }
    }
  }

  // 6. Update peer registry
  const peers = loadPeers(memoryDir);
  const peerRecord: PeerRecord = peers[packet.sender_id] || {
    agent_id: packet.sender_id,
    last_seen_at: new Date().toISOString(),
    last_packet_id: packet.packet_id,
    vector_clock: {},
    total_packets_received: 0,
    total_memories_ingested: 0,
  };

  peerRecord.last_seen_at = new Date().toISOString();
  peerRecord.last_packet_id = packet.packet_id;
  peerRecord.total_packets_received++;
  peerRecord.total_memories_ingested += result.ingested_count;
  peerRecord.vector_clock = {
    ...peerRecord.vector_clock,
    ...packet.vector_clock,
  };

  peers[packet.sender_id] = peerRecord;
  savePeers(memoryDir, peers);

  return result;
}

/**
 * Compiles a comprehensive peer sync status report.
 */
export function getSyncStatus(
  store: Store,
  workspaceRoot: string,
  localAgentId?: string
): SyncStatusReport {
  const agentId = resolveLocalAgentId(localAgentId);
  const memoryDir = store.memoryDir || join(workspaceRoot, ".memory");
  const peers = loadPeers(memoryDir);
  const entries = list(store);

  const localClock: VectorClock = {
    [agentId]: entries.length,
  };

  const peerList = Object.values(peers);
  let lastSyncAt: string | undefined;

  for (const p of peerList) {
    if (p.last_seen_at) {
      if (!lastSyncAt || p.last_seen_at > lastSyncAt) {
        lastSyncAt = p.last_seen_at;
      }
    }
    if (p.vector_clock[p.agent_id]) {
      localClock[p.agent_id] = p.vector_clock[p.agent_id];
    }
  }

  return {
    local_agent_id: agentId,
    local_vector_clock: localClock,
    known_peers: peerList,
    total_peers: peerList.length,
    pending_outgoing_memories: entries.filter((m) => m.status === "confirmed" || m.status === "active").length,
    last_sync_at: lastSyncAt,
    shared_pool_path: join(memoryDir, "sync", "pool"),
  };
}
