import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, save, get, listConflicts } from "../src/store.ts";
import { broadcastKnowledge, ingestKnowledge, loadPeers, savePeers } from "../src/sync/index.ts";

function entry(id: string, content: string, updatedAt = new Date().toISOString()) {
  return {
    id,
    title: `Memory ${id}`,
    content,
    project: "app",
    status: "confirmed" as const,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

describe("R31: concurrent write detection during sync ingest", () => {
  test("flags a concurrent write instead of silently dropping it", () => {
    const rootA = mkdtempSync(join(tmpdir(), "muse-r31-a-"));
    const rootB = mkdtempSync(join(tmpdir(), "muse-r31-b-"));
    try {
      const storeA = openStore(join(rootA, ".memory"));
      const storeB = openStore(join(rootB, ".memory"));

      // B already knows this memory from an earlier sync.
      const past = new Date(Date.now() - 60_000).toISOString();
      save(storeB, entry("m_shared", "original shared content", past));

      // Record a peer sync point in the past, so both later writes count as
      // having happened after the last exchange.
      const peers = loadPeers(join(rootB, ".memory"));
      peers["agent_sol"] = {
        agent_id: "agent_sol",
        last_seen_at: past,
        last_packet_id: "pkt_prev",
        vector_clock: { agent_sol: 1 },
        total_packets_received: 1,
        total_memories_ingested: 1,
      };
      savePeers(join(rootB, ".memory"), peers);

      // Both sides changed the same memory after that sync, independently.
      const now = new Date().toISOString();
      save(storeB, entry("m_shared", "LOCAL edit by agent_nexus", now));
      save(storeA, entry("m_shared", "PEER edit by agent_sol", now));

      const packet = broadcastKnowledge(storeA, rootA, { agentId: "agent_sol" });
      const result = ingestKnowledge(storeB, rootB, packet, "agent_nexus");

      // The concurrent write is reported as a conflict, not quietly ingested.
      expect(result.conflict_count).toBe(1);
      expect(result.details.conflicted_ids).toContain("m_shared");

      // The local version was NOT clobbered.
      const localAfter = get(storeB, "m_shared");
      expect(localAfter?.content).toContain("LOCAL edit");

      // And a conflict row exists for deliberate resolution.
      const conflicts = listConflicts(storeB, { status: "open" });
      expect(conflicts.length).toBeGreaterThan(0);
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  test("a strictly newer incoming write still applies cleanly", () => {
    const rootA = mkdtempSync(join(tmpdir(), "muse-r31-new-a-"));
    const rootB = mkdtempSync(join(tmpdir(), "muse-r31-new-b-"));
    try {
      const storeA = openStore(join(rootA, ".memory"));
      const storeB = openStore(join(rootB, ".memory"));

      // B's copy is older; A's is strictly newer. No concurrency here.
      save(storeB, entry("m_newer", "old content", new Date(Date.now() - 120_000).toISOString()));
      save(storeA, entry("m_newer", "newer content", new Date().toISOString()));

      const packet = broadcastKnowledge(storeA, rootA, { agentId: "agent_sol" });
      const result = ingestKnowledge(storeB, rootB, packet, "agent_nexus");

      expect(result.ingested_count).toBe(1);
      expect(get(storeB, "m_newer")?.content).toBe("newer content");
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  test("identical content is a duplicate, never a conflict", () => {
    const rootA = mkdtempSync(join(tmpdir(), "muse-r31-same-a-"));
    const rootB = mkdtempSync(join(tmpdir(), "muse-r31-same-b-"));
    try {
      const storeA = openStore(join(rootA, ".memory"));
      const storeB = openStore(join(rootB, ".memory"));

      const past = new Date(Date.now() - 60_000).toISOString();
      save(storeB, entry("m_same", "identical content", past));
      const peers = loadPeers(join(rootB, ".memory"));
      peers["agent_sol"] = {
        agent_id: "agent_sol",
        last_seen_at: past,
        last_packet_id: "pkt_prev",
        vector_clock: { agent_sol: 1 },
        total_packets_received: 1,
        total_memories_ingested: 1,
      };
      savePeers(join(rootB, ".memory"), peers);

      // Both "changed" after the sync but converged on the same bytes.
      const now = new Date().toISOString();
      save(storeB, entry("m_same", "identical content", now));
      save(storeA, entry("m_same", "identical content", now));

      const packet = broadcastKnowledge(storeA, rootA, { agentId: "agent_sol" });
      const result = ingestKnowledge(storeB, rootB, packet, "agent_nexus");

      expect(result.conflict_count).toBe(0);
      expect(result.details.duplicate_ids).toContain("m_same");
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });
});
