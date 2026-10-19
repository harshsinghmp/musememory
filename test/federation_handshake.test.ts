import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openStore,
  save,
  get,
  propose,
  flagConflict,
  resolveConflict,
  listConflicts,
  getConflict,
  initiateFederationHandshake,
  processFederationHandshake,
  getConflictDedupKey,
  type Store,
} from "../src/store.ts";
import { broadcastKnowledge, ingestKnowledge } from "../src/sync/index.ts";

describe("T-088: Federation Handshake for Mesh-Mode Conflict Dedup", () => {
  let tmpRootA: string;
  let tmpRootB: string;
  let storeA: Store;
  let storeB: Store;

  beforeEach(() => {
    tmpRootA = mkdtempSync(join(tmpdir(), "muse-fed-agentA-"));
    tmpRootB = mkdtempSync(join(tmpdir(), "muse-fed-agentB-"));

    storeA = openStore(join(tmpRootA, ".memory"));
    storeB = openStore(join(tmpRootB, ".memory"));
  });

  afterEach(() => {
    if (storeA.db) storeA.db.close();
    if (storeB.db) storeB.db.close();
    rmSync(tmpRootA, { recursive: true, force: true });
    rmSync(tmpRootB, { recursive: true, force: true });
  });

  describe("Conflict Dedup Key Canonicalization", () => {
    it("produces identical dedup key regardless of memory ID ordering", () => {
      const key1 = getConflictDedupKey("mem_alpha", "mem_beta");
      const key2 = getConflictDedupKey("mem_beta", "mem_alpha");
      expect(key1).toBe("mem_alpha::mem_beta");
      expect(key1).toBe(key2);
    });
  });

  describe("Handshake Packet Assembly and Integrity", () => {
    it("assembles a sealed FederationHandshakePacket with local conflicts", () => {
      const memA = propose(storeA, {
        title: "Database Choice: PostgreSQL",
        content: "System uses PostgreSQL.",
        project: "app",
        confirmed: true,
      });
      const memB = propose(storeA, {
        title: "Database Choice: MySQL",
        content: "System uses MySQL.",
        project: "app",
        confirmed: true,
      });

      flagConflict(storeA, memA.id, memB.id, "Conflicting primary database choice");

      const handshake = initiateFederationHandshake(storeA, { senderId: "agent_sol" });

      expect(handshake.protocol_version).toBe("2.0.0");
      expect(handshake.sender_id).toBe("agent_sol");
      expect(handshake.conflicts.length).toBe(1);
      expect(handshake.conflicts[0].memory_a_id).toBe(memA.id);
      expect(handshake.checksum).toBeDefined();
    });

    it("rejects handshake packet with tampered checksum", () => {
      const handshake = initiateFederationHandshake(storeA, { senderId: "agent_sol" });
      const tampered = { ...handshake, checksum: "tampered_bad_checksum" };

      const result = processFederationHandshake(storeB, tampered);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("checksum verification failed");
    });
  });

  describe("Mesh Conflict Deduplication", () => {
    it("deduplicates conflict records when both peers flagged the same pair in opposing directions", () => {
      // Peer A records (mem1, mem2)
      save(storeA, {
        id: "m_runtime_node",
        title: "Runtime Engine: Node.js",
        content: "Use Node.js runtime.",
        project: "core",
        status: "conflicted",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      save(storeA, {
        id: "m_runtime_bun",
        title: "Runtime Engine: Bun",
        content: "Use Bun runtime.",
        project: "core",
        status: "conflicted",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      flagConflict(storeA, "m_runtime_node", "m_runtime_bun", "Runtime engine conflict");

      // Peer B records the same conflict in reverse order: (mem2, mem1)
      save(storeB, {
        id: "m_runtime_node",
        title: "Runtime Engine: Node.js",
        content: "Use Node.js runtime.",
        project: "core",
        status: "conflicted",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      save(storeB, {
        id: "m_runtime_bun",
        title: "Runtime Engine: Bun",
        content: "Use Bun runtime.",
        project: "core",
        status: "conflicted",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      flagConflict(storeB, "m_runtime_bun", "m_runtime_node", "Runtime engine conflict reversed");

      // Now Peer A initiates federation handshake to Peer B
      const handshake = initiateFederationHandshake(storeA, { senderId: "agent_sol" });
      const result = processFederationHandshake(storeB, handshake);

      expect(result.success).toBe(true);
      expect(result.total_remote_conflicts).toBe(1);
      expect(result.deduplicated_conflicts).toBe(1);
      expect(result.imported_conflicts).toBe(0);

      // Total conflicts in Store B must remain exactly 1 (no duplicate row created!)
      const conflictsInB = listConflicts(storeB);
      expect(conflictsInB.length).toBe(1);
    });
  });

  describe("Resolution Propagation Across Mesh Handshake", () => {
    it("propagates 'supersede' resolution to remote peer with open conflict", () => {
      // Both nodes have the two memories
      const nodeMem = {
        id: "m_jwt_auth",
        title: "Auth: JWT",
        content: "Use JWT tokens.",
        project: "auth",
        status: "conflicted" as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const cookieMem = {
        id: "m_cookie_auth",
        title: "Auth: Cookies",
        content: "Use Session Cookies.",
        project: "auth",
        status: "conflicted" as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      save(storeA, { ...nodeMem });
      save(storeA, { ...cookieMem });
      flagConflict(storeA, nodeMem.id, cookieMem.id, "Auth mechanism conflict");

      save(storeB, { ...nodeMem });
      save(storeB, { ...cookieMem });
      flagConflict(storeB, nodeMem.id, cookieMem.id, "Auth mechanism conflict");

      // Node A resolves the conflict: JWT supersedes Cookies
      resolveConflict(storeA, {
        winningId: nodeMem.id,
        losingId: cookieMem.id,
        strategy: "supersede",
        reason: "JWT approved across all API clients",
        actor: "sec-lead",
      });

      // Node B still has it open
      const initialB = listConflicts(storeB, { status: "open" });
      expect(initialB.length).toBe(1);

      // Node A sends federation handshake to Node B
      const handshakeA = initiateFederationHandshake(storeA, { senderId: "agent_sol" });
      const syncResult = processFederationHandshake(storeB, handshakeA);

      expect(syncResult.success).toBe(true);
      expect(syncResult.reconciled_resolutions).toBe(1);

      // Node B's conflict table is now marked resolved
      const resolvedB = listConflicts(storeB, { status: "resolved" });
      expect(resolvedB.length).toBe(1);
      expect(resolvedB[0].resolution_strategy).toBe("supersede");

      // Node B's local memories reflect the propagated resolution
      const localJwt = get(storeB, nodeMem.id);
      const localCookie = get(storeB, cookieMem.id);
      expect(localJwt?.status).toBe("confirmed");
      expect(localCookie?.status).toBe("superseded");
    });

    it("propagates 'keep_both' resolution un-conflicting both memories", () => {
      const memA = {
        id: "m_dark_theme",
        title: "Theme: Dark Mode",
        content: "Dark mode for desktop.",
        project: "ui",
        status: "conflicted" as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const memB = {
        id: "m_light_theme",
        title: "Theme: Light Mode",
        content: "Light mode for mobile.",
        project: "ui",
        status: "conflicted" as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      save(storeA, { ...memA });
      save(storeA, { ...memB });
      flagConflict(storeA, memA.id, memB.id, "Theme polarity conflict");

      save(storeB, { ...memA });
      save(storeB, { ...memB });
      flagConflict(storeB, memA.id, memB.id, "Theme polarity conflict");

      // Node A resolves as keep_both
      resolveConflict(storeA, {
        winningId: memA.id,
        losingId: memB.id,
        strategy: "keep_both",
        reason: "Both are valid on different device form factors",
        actor: "ui-lead",
      });

      const handshake = initiateFederationHandshake(storeA, { senderId: "agent_jasper" });
      const result = processFederationHandshake(storeB, handshake);

      expect(result.success).toBe(true);
      expect(result.reconciled_resolutions).toBe(1);

      // In Store B, both memories are now confirmed and conflict is resolved
      const localA = get(storeB, memA.id);
      const localB = get(storeB, memB.id);
      expect(localA?.status).toBe("confirmed");
      expect(localB?.status).toBe("confirmed");

      const resolvedCfl = listConflicts(storeB, { status: "resolved" });
      expect(resolvedCfl.length).toBe(1);
      expect(resolvedCfl[0].resolution_strategy).toBe("keep_both");
    });
  });

  describe("Gossip Ingestion Integration", () => {
    it("persists gossiped contradictions into SQLite conflicts table during ingestKnowledge", () => {
      save(storeB, {
        id: "m_db_choice_b",
        title: "Database Choice: PostgreSQL",
        content: "The system uses PostgreSQL for primary storage.",
        project: "app",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      save(storeA, {
        id: "m_db_choice_a",
        title: "Database Choice: MySQL",
        content: "The system uses MySQL for primary storage.",
        project: "app",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const packet = broadcastKnowledge(storeA, tmpRootA, { agentId: "agent_sol" });
      const result = ingestKnowledge(storeB, tmpRootB, packet, "agent_nexus");

      expect(result.conflict_count).toBe(1);

      // Verified: Automatically registered in Store B's SQLite conflicts table
      const conflictsInB = listConflicts(storeB, { status: "open" });
      expect(conflictsInB.length).toBe(1);
      expect(conflictsInB[0].memory_a_id).toBe("m_db_choice_b");
      expect(conflictsInB[0].memory_b_id).toBe("m_db_choice_a");
    });
  });
});
