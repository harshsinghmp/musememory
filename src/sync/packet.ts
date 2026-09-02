import { createHash } from "node:crypto";
import type { MemoryEntry } from "../types.ts";
import type { SyncPacket, GossipSupersession, VectorClock } from "./types.ts";

/**
 * Computes deterministic SHA-256 fingerprint for a memory entry payload.
 */
export function computeEntryHash(entry: MemoryEntry): string {
  const normalized = JSON.stringify({
    title: entry.title.trim().toLowerCase(),
    content: entry.content.trim(),
    project: entry.project,
    type: entry.type || "unknown",
  });
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Computes SHA-256 checksum for an entire SyncPacket payload.
 */
export function computePacketChecksum(payload: SyncPacket["payload"]): string {
  const content = JSON.stringify({
    memories: payload.memories.map((m) => m.id).sort(),
    constraints: payload.constraints.slice().sort(),
    supersessions: payload.supersessions.map((s) => `${s.old_id}->${s.new_id}`).sort(),
    hashes: payload.hashes,
  });
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Assembles a valid SyncPacket.
 */
export function buildSyncPacket(params: {
  senderId: string;
  project: string;
  memories: MemoryEntry[];
  constraints: string[];
  supersessions: GossipSupersession[];
  vectorClock: VectorClock;
}): SyncPacket {
  const hashes: Record<string, string> = {};
  for (const mem of params.memories) {
    hashes[mem.id] = computeEntryHash(mem);
  }

  const payload = {
    memories: params.memories,
    constraints: params.constraints,
    supersessions: params.supersessions,
    hashes,
  };

  const packetId = `packet_${params.senderId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const checksum = computePacketChecksum(payload);

  return {
    protocol_version: "2.0.0",
    sender_id: params.senderId,
    packet_id: packetId,
    created_at: new Date().toISOString(),
    vector_clock: params.vectorClock,
    project: params.project,
    payload,
    checksum,
  };
}

/**
 * Validates integrity and structure of a SyncPacket.
 */
export function validateSyncPacket(packet: unknown): { valid: boolean; error?: string } {
  if (!packet || typeof packet !== "object") {
    return { valid: false, error: "Packet must be a non-null JSON object" };
  }

  const p = packet as Partial<SyncPacket>;
  if (p.protocol_version !== "2.0.0") {
    return { valid: false, error: `Incompatible protocol version: expected 2.0.0, received ${p.protocol_version}` };
  }

  if (!p.sender_id || typeof p.sender_id !== "string") {
    return { valid: false, error: "Missing or invalid sender_id" };
  }

  if (!p.packet_id || typeof p.packet_id !== "string") {
    return { valid: false, error: "Missing or invalid packet_id" };
  }

  if (!p.payload || typeof p.payload !== "object") {
    return { valid: false, error: "Missing or invalid payload object" };
  }

  if (!Array.isArray(p.payload.memories)) {
    return { valid: false, error: "payload.memories must be an array" };
  }

  const expectedChecksum = computePacketChecksum(p.payload);
  if (p.checksum && p.checksum !== expectedChecksum) {
    return { valid: false, error: "Packet checksum mismatch: payload may have been corrupted or modified" };
  }

  return { valid: true };
}
