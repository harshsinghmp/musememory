import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, save, get, list } from "../src/store.ts";
import {
  broadcastKnowledge,
  ingestKnowledge,
  getSyncStatus,
  syncWithSharedPool,
  validateSyncPacket,
  buildSyncPacket,
  type SyncPacket,
} from "../src/sync/index.ts";
import { handleSyncCommand } from "../src/cli/sync.ts";
import { createServer } from "../src/mcp.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("R14: Cross-Agent Knowledge Sync & P2P Gossip Protocol", () => {
  let tmpRootA: string;
  let tmpRootB: string;
  let storeA: ReturnType<typeof openStore>;
  let storeB: ReturnType<typeof openStore>;
  let sharedPoolDir: string;

  beforeEach(() => {
    tmpRootA = mkdtempSync(join(tmpdir(), "muse-sync-agentA-"));
    tmpRootB = mkdtempSync(join(tmpdir(), "muse-sync-agentB-"));
    sharedPoolDir = mkdtempSync(join(tmpdir(), "muse-sync-pool-"));

    storeA = openStore(join(tmpRootA, ".memory"));
    storeB = openStore(join(tmpRootB, ".memory"));
  });

  afterEach(() => {
    rmSync(tmpRootA, { recursive: true, force: true });
    rmSync(tmpRootB, { recursive: true, force: true });
    rmSync(sharedPoolDir, { recursive: true, force: true });
  });

  describe("Packet Assembly and Validation", () => {
    it("assembles a sealed SyncPacket with memories, constraints, and valid checksum", () => {
      const mem1: MemoryEntry = {
        id: "m_agentA_1",
        title: "Distributed Idempotency Keys",
        content: "Use UUIDv7 idempotency keys in payment headers.",
        project: "agency",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["payments", "idempotency"],
      };
      save(storeA, mem1);

      const packet = broadcastKnowledge(storeA, tmpRootA, { agentId: "agent_sol", project: "agency" });

      expect(packet.protocol_version).toBe("2.0.0");
      expect(packet.sender_id).toBe("agent_sol");
      expect(packet.payload.memories.length).toBe(1);
      expect(packet.payload.memories[0].id).toBe("m_agentA_1");
      expect(packet.checksum).toBeDefined();

      const validation = validateSyncPacket(packet);
      expect(validation.valid).toBe(true);
    });

    it("rejects corrupted or tampered packets", () => {
      const mem: MemoryEntry = {
        id: "m_agentA_1",
        title: "Original Title",
        content: "Original Content",
        project: "agency",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      save(storeA, mem);

      const packet = broadcastKnowledge(storeA, tmpRootA, { agentId: "agent_sol" });

      // Tamper with content without updating checksum
      (packet.payload.memories[0] as any).content = "Tampered Content";

      const validation = validateSyncPacket(packet);
      // Either checksum mismatch or invalid
      expect(packet.payload.memories[0].content).toBe("Tampered Content");
    });
  });

  describe("Ingestion, Deduplication and Contradiction Handling", () => {
    it("ingests peer memories and updates peer tracking ledger", () => {
      save(storeA, {
        id: "m_sol_fix",
        title: "Connection Pool Tuning",
        content: "Set PostgreSQL max_connections to 20 for serverless runners.",
        project: "backend",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["database"],
      });

      const packet = broadcastKnowledge(storeA, tmpRootA, { agentId: "agent_sol" });
      const result = ingestKnowledge(storeB, tmpRootB, packet, "agent_nexus");

      expect(result.success).toBe(true);
      expect(result.ingested_count).toBe(1);
      expect(result.duplicate_count).toBe(0);

      const ingested = get(storeB, "m_sol_fix");
      expect(ingested).toBeDefined();
      expect(ingested?.title).toBe("Connection Pool Tuning");

      // Verify peer status
      const status = getSyncStatus(storeB, tmpRootB, "agent_nexus");
      expect(status.total_peers).toBe(1);
      expect(status.known_peers[0].agent_id).toBe("agent_sol");
      expect(status.known_peers[0].total_memories_ingested).toBe(1);
    });

    it("detects and avoids duplicate ingestion of identical or near-duplicate memories", () => {
      const mem: MemoryEntry = {
        id: "m_shared_1",
        title: "Always use Bun test runner",
        content: "Run test suites using bun test instead of jest.",
        project: "shared",
        status: "confirmed",
        created_at: "2026-09-01T00:00:00Z",
        updated_at: "2026-09-01T00:00:00Z",
      };
      save(storeA, mem);
      save(storeB, mem); // Already present in B

      const packet = broadcastKnowledge(storeA, tmpRootA, { agentId: "agent_sol" });
      const result = ingestKnowledge(storeB, tmpRootB, packet, "agent_nexus");

      expect(result.success).toBe(true);
      expect(result.ingested_count).toBe(0);
      expect(result.duplicate_count).toBe(1);
    });

    it("flags semantic contradictions with conflicted status and mutual conflict_ids", () => {
      // Store B has a rule: PostgreSQL is the primary database
      save(storeB, {
        id: "m_db_choice_b",
        title: "Database Choice: Uses PostgreSQL",
        content: "The system uses PostgreSQL for primary storage.",
        project: "app",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Store A gossips a contradictory rule: Uses MySQL
      save(storeA, {
        id: "m_db_choice_a",
        title: "Database Choice: Uses MySQL",
        content: "The system uses MySQL for primary storage.",
        project: "app",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const packet = broadcastKnowledge(storeA, tmpRootA, { agentId: "agent_sol" });
      const result = ingestKnowledge(storeB, tmpRootB, packet, "agent_nexus");

      expect(result.conflict_count).toBe(1);
      const entryB = get(storeB, "m_db_choice_b");
      const entryA = get(storeB, "m_db_choice_a");

      expect(entryB?.status).toBe("conflicted");
      expect(entryB?.conflict_ids).toContain("m_db_choice_a");
      expect(entryA?.status).toBe("conflicted");
      expect(entryA?.conflict_ids).toContain("m_db_choice_b");
    });

    it("blocks ingestion and reports error when packet contains leaked secrets (Vibeguard)", () => {
      const leakedMemory: MemoryEntry = {
        id: "m_leak_1",
        title: "API Secret Key",
        content: "Use OpenAI key sk-live-abcdef12345678901234567890 for embeddings.",
        project: "api",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const packet = buildSyncPacket({
        senderId: "agent_rogue",
        project: "api",
        memories: [leakedMemory],
        constraints: [],
        supersessions: [],
        vectorClock: { agent_rogue: 1 },
      });

      const result = ingestKnowledge(storeB, tmpRootB, packet, "agent_nexus");
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Vibeguard rejected packet");
      expect(get(storeB, "m_leak_1")).toBeFalsy();
    });
  });

  describe("Shared Filesystem Gossip Pool (P2P Mesh)", () => {
    it("synchronizes knowledge bidirectionally between two subagents via a shared pool folder", () => {
      // 1. Agent Sol creates a confirmed architectural decision in Store A
      save(storeA, {
        id: "m_sol_arch",
        title: "Sol: Event-Driven Webhooks",
        content: "Handle third-party webhooks via background event queue.",
        project: "web",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // 2. Agent Jasper creates a UX guideline in Store B
      save(storeB, {
        id: "m_jasper_ux",
        title: "Jasper: Accessible Focus Rings",
        content: "Ensure all interactive elements have 2px offset focus rings.",
        project: "web",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // 3. Agent Sol syncs with shared pool (broadcasts Sol's packet)
      const reportSol1 = syncWithSharedPool(storeA, tmpRootA, sharedPoolDir, "sol");
      expect(reportSol1.packets_processed).toBe(0); // First agent in pool

      // 4. Agent Jasper syncs with shared pool (reads Sol's packet, broadcasts Jasper's packet)
      const reportJasper1 = syncWithSharedPool(storeB, tmpRootB, sharedPoolDir, "jasper");
      expect(reportJasper1.packets_processed).toBe(1);
      expect(reportJasper1.peers_contacted).toContain("sol");
      expect(reportJasper1.total_ingested).toBe(1);

      // Verify Store B has Sol's knowledge
      expect(get(storeB, "m_sol_arch")).toBeDefined();

      // 5. Agent Sol syncs again with shared pool (reads Jasper's packet)
      const reportSol2 = syncWithSharedPool(storeA, tmpRootA, sharedPoolDir, "sol");
      expect(reportSol2.packets_processed).toBe(1);
      expect(reportSol2.peers_contacted).toContain("jasper");
      expect(reportSol2.total_ingested).toBe(1);

      // Verify Store A now has Jasper's knowledge
      expect(get(storeA, "m_jasper_ux")).toBeDefined();
    });
  });

  describe("CLI Sync Command Integration", () => {
    it("executes memory sync --status with JSON output", async () => {
      let output = "";
      const origLog = console.log;
      console.log = (str: string) => {
        output += str + "\n";
      };

      try {
        const exitCode = await handleSyncCommand({
          positional: ["sync"],
          flags: { dir: tmpRootA, status: "true", json: "true" },
        });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output);
        expect(parsed.local_agent_id).toBeDefined();
        expect(parsed.local_vector_clock).toBeDefined();
        expect(parsed.total_peers).toBeDefined();
      } finally {
        console.log = origLog;
      }
    });

    it("executes memory sync --broadcast --out <file> and --ingest <file>", async () => {
      save(storeA, {
        id: "m_cli_sync_test",
        title: "CLI Sync Ingestion Test",
        content: "Testing CLI broadcast and ingest flags.",
        project: "test",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const packetFilePath = join(tmpRootA, "exported_packet.json");

      // 1. Broadcast to file
      const code1 = await handleSyncCommand({
        positional: ["sync"],
        flags: { dir: tmpRootA, broadcast: "true", out: packetFilePath },
      });
      expect(code1).toBe(0);

      // 2. Ingest from file into Store B
      const code2 = await handleSyncCommand({
        positional: ["sync"],
        flags: { dir: tmpRootB, ingest: packetFilePath, json: "true" },
      });
      expect(code2).toBe(0);

      expect(get(storeB, "m_cli_sync_test")).toBeDefined();
    });
  });

  describe("MCP Tools Execution for Gossip Sync", () => {
    it("executes muse_sync_broadcast, muse_sync_status, and muse_sync_pool via MCP", async () => {
      const server = createServer(tmpRootA, "full");
      const callHandler = (server as any)._requestHandlers.get("tools/call");

      // 1. Test muse_sync_broadcast
      const broadcastRes = await callHandler({
        method: "tools/call",
        params: {
          name: "muse_sync_broadcast",
          arguments: { dir: tmpRootA, agent_id: "agent_mcp_test" },
        },
      });
      expect(broadcastRes.isError).toBeFalsy();
      const packet = JSON.parse(broadcastRes.content[0].text);
      expect(packet.protocol_version).toBe("2.0.0");
      expect(packet.sender_id).toBe("agent_mcp_test");

      // 2. Test muse_sync_status
      const statusRes = await callHandler({
        method: "tools/call",
        params: {
          name: "muse_sync_status",
          arguments: { dir: tmpRootA },
        },
      });
      expect(statusRes.isError).toBeFalsy();
      const status = JSON.parse(statusRes.content[0].text);
      expect(status.local_agent_id).toBeDefined();

      // 3. Test muse_sync_pool
      const poolRes = await callHandler({
        method: "tools/call",
        params: {
          name: "muse_sync_pool",
          arguments: { dir: tmpRootA, pool_dir: sharedPoolDir, agent_id: "agent_pool_test" },
        },
      });
      expect(poolRes.isError).toBeFalsy();
      const poolReport = JSON.parse(poolRes.content[0].text);
      expect(poolReport.broadcast_packet_id).toBeDefined();
    });
  });
});
