import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../store.ts";
import type { PoolSyncReport, SyncPacket } from "./types.ts";
import { broadcastKnowledge, ingestKnowledge, resolveLocalAgentId, loadPeers } from "./engine.ts";

/**
 * Synchronizes with an in-process / filesystem shared gossip pool directory.
 * Multiple subagents (e.g. Sol, Jasper, Nexus, Crew) can drop and read packets here.
 */
export function syncWithSharedPool(
  store: Store,
  workspaceRoot: string,
  customPoolDir?: string,
  localAgentId?: string
): PoolSyncReport {
  const agentId = resolveLocalAgentId(localAgentId);
  const memoryDir = store.memoryDir || join(workspaceRoot, ".memory");
  const poolDir = customPoolDir || join(memoryDir, "sync", "pool");

  if (!existsSync(poolDir)) {
    mkdirSync(poolDir, { recursive: true });
  }

  const peers = loadPeers(memoryDir);
  const peersContacted = new Set<string>();
  let packetsProcessed = 0;
  let totalIngested = 0;
  let totalDuplicates = 0;
  let totalConflicts = 0;

  // 1. Ingest packets from all peers in the pool
  const files = readdirSync(poolDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const filePath = join(poolDir, file);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const packet: SyncPacket = JSON.parse(raw);

      // Skip own broadcast packets
      if (packet.sender_id === agentId) continue;

      // Skip already processed packets from this peer
      const knownPeer = peers[packet.sender_id];
      if (knownPeer && knownPeer.last_packet_id === packet.packet_id) {
        continue;
      }

      peersContacted.add(packet.sender_id);
      packetsProcessed++;

      const res = ingestKnowledge(store, workspaceRoot, packet, agentId);
      totalIngested += res.ingested_count;
      totalDuplicates += res.duplicate_count;
      totalConflicts += res.conflict_count;
    } catch {
      // Ignore unparseable or corrupted pool files gracefully
    }
  }

  // 2. Broadcast own updated knowledge packet into the pool
  const broadcastPacket = broadcastKnowledge(store, workspaceRoot, { agentId });
  const myPacketPath = join(poolDir, `packet_${agentId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  writeFileSync(myPacketPath, JSON.stringify(broadcastPacket, null, 2), "utf-8");

  return {
    pool_dir: poolDir,
    agent_id: agentId,
    peers_contacted: Array.from(peersContacted),
    packets_processed: packetsProcessed,
    total_ingested: totalIngested,
    total_duplicates: totalDuplicates,
    total_conflicts: totalConflicts,
    broadcast_packet_id: broadcastPacket.packet_id,
    timestamp: new Date().toISOString(),
  };
}
