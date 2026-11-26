import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import type { Store } from "../store.ts";
import { list, get, save, supersede } from "../store.ts";
import { getAuditTrail } from "../audit.ts";
import { parseCurrentFile, writeCurrentFile } from "../governor.ts";
import { scanSecrets } from "../secrets.ts";
import { detectConflict, flagConflict } from "../quality/contradiction.ts";
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
import {
  verifyAttestation,
  verifyAttestationChain,
  type Attestation,
} from "./attestation.ts";

/** Env var holding a PEM public key trusted to sign incoming gossip packets. */
const ATTESTATION_TRUST_KEY_ENV = "MUSE_ATTESTATION_PUBLIC_KEY";

/** `<memory_dir>/sync/attestation.pub`, the file `memory attest keygen` writes. */
const TRUSTED_PUBLIC_KEY_FILE = "attestation.pub";

/**
 * Loads the operator-configured attestation trust anchor, if any.
 *
 * Order: the inline `MUSE_ATTESTATION_PUBLIC_KEY` PEM, then
 * `<memory_dir>/sync/attestation.pub`. A packet's own key material is never
 * consulted — a signature verifies against what the operator installed.
 */
function loadAttestationTrustAnchor(memoryDir: string): string | undefined {
  const inline = process.env[ATTESTATION_TRUST_KEY_ENV];
  if (inline && inline.trim()) return inline.trim();
  const file = join(memoryDir, "sync", TRUSTED_PUBLIC_KEY_FILE);
  if (!existsSync(file)) return undefined;
  try {
    const pem = readFileSync(file, "utf-8").trim();
    return pem || undefined;
  } catch {
    return undefined;
  }
}

/** A packet may carry a single attestation or a full chain. */
type PacketWithAttestation = SyncPacket & {
  attestation?: Attestation | Attestation[] | null;
};

/** The signed body: the packet as it stood before the attestation was attached. */
function attestedBody(packet: PacketWithAttestation): unknown {
  const { attestation: _attestation, ...body } = packet;
  return body;
}

/**
 * Verifies a packet's embedded attestation against the operator trust anchor.
 *
 * `attested` reports whether the packet claimed authenticity at all; `error` is
 * set when that claim could not be verified (bad signature, tampered payload, or
 * no trust anchor configured — an unverifiable claim is not evidence).
 */
function verifyPacketAttestation(
  packet: SyncPacket,
  memoryDir: string
): { attested: boolean; error?: string } {
  const attestation = (packet as PacketWithAttestation).attestation;
  if (attestation === undefined || attestation === null) return { attested: false };

  const trustAnchor = loadAttestationTrustAnchor(memoryDir);
  if (!trustAnchor) {
    return {
      attested: true,
      error:
        `Rejected packet from ${packet.sender_id}: it carries an attestation but no trusted key is configured ` +
        `(set ${ATTESTATION_TRUST_KEY_ENV} or install <memory_dir>/sync/${TRUSTED_PUBLIC_KEY_FILE})`,
    };
  }

  const body = attestedBody(packet as PacketWithAttestation);
  let valid = false;
  try {
    valid = Array.isArray(attestation)
      ? verifyAttestationChain(attestation, trustAnchor)
      : verifyAttestation(body, attestation, trustAnchor);
  } catch {
    // Malformed attestation (bad base64, bad PEM, wrong shape) is a failed check.
    valid = false;
  }

  if (!valid) {
    return {
      attested: true,
      error: `Rejected packet from ${packet.sender_id}: attestation verification failed against the configured trust anchor`,
    };
  }
  return { attested: true };
}


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
  if (!existsSync(file)) return Object.create(null);
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as Record<string, PeerRecord>;
    // A peer id is attacker-supplied: it arrives inside a packet. A plain object
    // inherits Object.prototype, so `peers["__proto__"]`, `["constructor"]` and
    // `["toString"]` are truthy even when no such peer exists — which made every
    // unsigned packet look like a known peer and skipped the #456 overwrite
    // guard. A null prototype removes the inherited names; callers also use
    // Object.hasOwn, so neither defence depends on the other.
    return Object.assign(Object.create(null), parsed) as Record<string, PeerRecord>;
  } catch {
    return Object.create(null);
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
 * Preserves an incoming copy that may not overwrite the stored one.
 *
 * Both versions collide on the same id, so the incoming copy is filed under a
 * derived id — deterministic, so re-ingesting the same packet does not pile up
 * duplicate conflict rows — and the pair is flagged as a conflict. The stored
 * entry keeps its content; only its conflict bookkeeping changes.
 */
function preserveAsConflict(
  store: Store,
  existing: MemoryEntry,
  incoming: MemoryEntry,
  packet: SyncPacket,
  reason: string,
  options: { conflict_type: string; confidence: number },
): void {
  const disputedId = `${incoming.id}__conflict_${packet.sender_id}`;
  if (!get(store, disputedId)) {
    save(store, {
      ...incoming,
      id: disputedId,
      // Mark it disputed rather than confirmed: it is evidence of a divergence,
      // not an established fact.
      status: "candidate",
    });
  }
  flagConflict(store, existing.id, disputedId, reason, options);
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

  const memoryDir = store.memoryDir || join(workspaceRoot, ".memory");

  // 2. Fix #456: authenticate the sender before a single byte is written. A
  //    packet that claims authenticity must prove it against the operator's
  //    trust anchor; if it cannot, the whole packet is rejected untouched.
  const attestation = verifyPacketAttestation(packet, memoryDir);
  if (attestation.error) {
    result.success = false;
    result.errors.push(attestation.error);
    return result;
  }

  // 3. Vibeguard secret scan across incoming memories
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

  // R31: the peer's last-sync timestamp is the concurrency signal below, so
  // it must be read before this packet updates it.
  const senderPeers = loadPeers(memoryDir);
  // A known peer, or a packet whose signature we just verified, is trusted to
  // use newer-wins. Everyone else may only add knowledge, never rewrite ours.
  // `Object.hasOwn` — not a truthiness lookup — because the id is attacker-
  // supplied and inherited names ("__proto__", "toString") are not peers.
  const senderIsKnownPeer = Object.hasOwn(senderPeers, packet.sender_id);
  const trustedSender = attestation.attested || senderIsKnownPeer;

  // 4. Process each incoming memory
  for (const incoming of packet.payload.memories) {
    const existing = get(store, incoming.id);

    // Exact ID match
    if (existing) {
      // R31: do not treat a concurrent write as a stale one. Comparing
      // wall-clock timestamps alone silently drops whichever side lost the
      // race, and the roadmap forbids that: memory-level conflicts are
      // flagged, never clobbered.
      //
      // MemoryEntry carries no per-entry vector clock, so a true causal
      // comparison is not available. The defensible signal from real data is
      // the peer's last sync time: if BOTH the stored copy and the incoming
      // copy were modified after we last synced with this sender, neither can
      // have seen the other's edit — that is a concurrent write.
      const lastSync = senderIsKnownPeer ? senderPeers[packet.sender_id]?.last_seen_at : undefined;
      const concurrent =
        Boolean(lastSync) &&
        existing.updated_at > lastSync! &&
        incoming.updated_at > lastSync! &&
        existing.content.trim() !== incoming.content.trim();

      if (concurrent) {
        preserveAsConflict(
          store,
          existing,
          incoming,
          packet,
          `Concurrent write during sync from ${packet.sender_id}: both sides changed this memory after the last sync`,
          { conflict_type: "concurrent_write", confidence: 0.9 },
        );
        result.conflict_count++;
        result.details.conflicted_ids.push(incoming.id);
        continue;
      }

      if (existing.updated_at >= incoming.updated_at) {
        result.duplicate_count++;
        result.details.duplicate_ids.push(incoming.id);
        continue;
      }

      // Fix #456: "incoming is newer" is only a licence to overwrite when the
      // sender has earned it. An unattested packet from an agent we have never
      // synced with cannot rewrite a confirmed memory just by claiming a later
      // timestamp — it is quarantined as a conflict and the stored content
      // stands. Known peers and verified packets keep newer-wins unchanged.
      if (existing.status === "confirmed" && !trustedSender) {
        preserveAsConflict(
          store,
          existing,
          incoming,
          packet,
          `Untrusted sync overwrite from ${packet.sender_id}: unattested packet from an unknown peer targeted a confirmed memory`,
          { conflict_type: "untrusted_overwrite", confidence: 0.9 },
        );
        result.conflict_count++;
        result.details.conflicted_ids.push(incoming.id);
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
      save(store, incoming);
      flagConflict(
        store,
        conflict.conflictingEntry.id,
        incoming.id,
        conflict.reason || "Gossiped contradiction detected during sync",
      );

      result.conflict_count++;
      result.details.conflicted_ids.push(incoming.id);
      continue;
    }

    // Clean entry: save
    save(store, incoming);
    result.ingested_count++;
    result.details.ingested_ids.push(incoming.id);
  }

  // 5. Ingest constraints
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

  // 6. Ingest supersessions
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

  // 7. Update peer registry
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
