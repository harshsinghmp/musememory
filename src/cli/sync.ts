import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { requireRoot, type ParsedArgs } from "./shared.ts";
import {
  broadcastKnowledge,
  ingestKnowledge,
  getSyncStatus,
  syncWithSharedPool,
  type SyncPacket,
} from "../sync/index.ts";

export async function handleSyncCommand(parsed: ParsedArgs): Promise<number> {
  const ctx = requireRoot(parsed.flags);
  if (!ctx) {
    console.error("Error: Could not resolve project root or initialize .memory directory.");
    return 1;
  }
  const { root, store } = ctx;
  const agentId = parsed.flags.peer || parsed.flags.agent;

  // 1. Broadcast action
  if (parsed.flags.broadcast) {
    const packet = broadcastKnowledge(store, root, {
      agentId,
      project: parsed.flags.project,
    });

    if (parsed.flags.out) {
      const outPath = resolve(process.cwd(), parsed.flags.out);
      writeFileSync(outPath, JSON.stringify(packet, null, 2), "utf-8");
      console.log(`\x1b[32m✓ Broadcast packet saved to '${outPath}' (${packet.payload.memories.length} memories)\x1b[0m`);
    } else {
      console.log(JSON.stringify(packet, null, 2));
    }
    return 0;
  }

  // 2. Ingest action
  if (parsed.flags.ingest) {
    const inPath = resolve(process.cwd(), parsed.flags.ingest);
    try {
      const raw = readFileSync(inPath, "utf-8");
      const packet: SyncPacket = JSON.parse(raw);
      const res = ingestKnowledge(store, root, packet, agentId);

      if (parsed.flags.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        if (!res.success) {
          console.error(`\x1b[31m✗ Ingestion failed:\x1b[0m ${res.errors.join(", ")}`);
          return 1;
        }
        console.log(`\x1b[32m✓ Successfully ingested gossip packet '${res.packet_id}' from '${res.sender_id}':\x1b[0m`);
        console.log(`  - Ingested:    ${res.ingested_count}`);
        console.log(`  - Duplicates:  ${res.duplicate_count}`);
        console.log(`  - Conflicts:   ${res.conflict_count}`);
        console.log(`  - Superseded:  ${res.superseded_count}`);
      }
      return 0;
    } catch (err: unknown) {
      console.error(`Error reading or ingesting packet from '${inPath}': ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  // 3. Shared pool sync action
  if (parsed.flags.pool || (!parsed.flags.status && !parsed.flags.broadcast && !parsed.flags.ingest)) {
    const poolDir = typeof parsed.flags.pool === "string" ? resolve(process.cwd(), parsed.flags.pool) : undefined;
    const report = syncWithSharedPool(store, root, poolDir, agentId);

    if (parsed.flags.json) {
      console.log(JSON.stringify(report, null, 2));
      return 0;
    }

    console.log(`\x1b[36m🤝 MUSE MEMORY CROSS-AGENT P2P GOSSIP SYNC\x1b[0m`);
    console.log(`Agent ID:        \x1b[1m${report.agent_id}\x1b[0m`);
    console.log(`Shared Pool:     ${report.pool_dir}`);
    console.log(`Peers Contacted: ${report.peers_contacted.length > 0 ? report.peers_contacted.join(", ") : "none (first agent in pool)"}`);
    console.log(`Packets Read:    ${report.packets_processed}`);
    console.log(`New Ingested:    ${report.total_ingested}`);
    console.log(`Duplicates:      ${report.total_duplicates}`);
    console.log(`Conflicts:       ${report.total_conflicts}`);
    console.log(`Broadcasted As:  ${report.broadcast_packet_id}`);
    return 0;
  }

  // 4. Status action
  const status = getSyncStatus(store, root, agentId);
  if (parsed.flags.json) {
    console.log(JSON.stringify(status, null, 2));
    return 0;
  }

  console.log(`\x1b[36m🌐 MUSE MEMORY PEER TOPOLOGY & SYNC STATUS\x1b[0m`);
  console.log(`Local Agent:     \x1b[1m${status.local_agent_id}\x1b[0m`);
  console.log(`Total Peers:     ${status.total_peers}`);
  console.log(`Outgoing Ready:  ${status.pending_outgoing_memories}`);
  if (status.last_sync_at) {
    console.log(`Last Sync:       ${status.last_sync_at}`);
  }

  if (status.known_peers.length > 0) {
    console.log(`\nKnown Peer Agents:`);
    for (const p of status.known_peers) {
      console.log(`  • \x1b[1m${p.agent_id}\x1b[0m (last seen: ${p.last_seen_at})`);
      console.log(`    Packets: ${p.total_packets_received}, Memories Ingested: ${p.total_memories_ingested}`);
    }
  } else {
    console.log(`\nNo peer agents recorded yet. Run 'memory sync' with a shared pool or ingest a peer packet.`);
  }

  return 0;
}
