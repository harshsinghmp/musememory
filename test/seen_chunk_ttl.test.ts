import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SeenChunkTracker,
  defaultSeenChunkTracker,
  computeChunkKey,
  DEFAULT_SEEN_CHUNK_TTL_MS,
} from "../src/retrieval/suppression.ts";
import { rankAndRetrieveMemories } from "../src/retrieval/ranking.ts";
import { resolveMuseContext } from "../src/orchestrator/context.ts";
import { openStore, propose } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("T-111: Seen-chunk TTL in retrieval", () => {
  let testTracker: SeenChunkTracker;

  beforeEach(() => {
    testTracker = new SeenChunkTracker(300_000); // 5 min default
    defaultSeenChunkTracker.clearAll();
  });

  afterEach(() => {
    testTracker.clearAll();
    defaultSeenChunkTracker.clearAll();
  });

  it("computes deterministic chunk keys from content_hash, content, or id", () => {
    const withHash = { id: "m_1", content: "hello world", content_hash: "hash_abc123" };
    expect(computeChunkKey(withHash)).toBe("hash_abc123");

    const withContent = { id: "m_2", content: "Deterministic chunk content representation" };
    expect(computeChunkKey(withContent)).toBe("m_2:Deterministic chunk content representation");

    const idOnly = { id: "m_3" };
    expect(computeChunkKey(idOnly)).toBe("m_3");
  });

  it("records seen chunks and verifies TTL suppression within active window", () => {
    const baseTime = 1000000;
    const session = "sess_1";
    const item = { id: "m_1", content: "Database pool configuration", content_hash: "h_db_pool" };

    testTracker.recordSeen(session, [item], { now: baseTime, ttlMs: 60_000 });

    // 10s later: should be seen
    const check1 = testTracker.isSeen(session, item, { now: baseTime + 10_000, ttlMs: 60_000 });
    expect(check1.seen).toBe(true);
    expect(check1.remainingTtlMs).toBe(50_000);

    // 61s later: should expire
    const check2 = testTracker.isSeen(session, item, { now: baseTime + 61_000, ttlMs: 60_000 });
    expect(check2.seen).toBe(false);
  });

  it("filters seen chunks and preserves session isolation and exemptions", () => {
    const baseTime = 2000000;
    const sessionA = "sess_a";
    const sessionB = "sess_b";

    const memRegular: any = {
      id: "mem_regular",
      title: "Worker retry policy",
      content: "Exponential backoff up to 5 attempts",
      type: "decision",
      content_hash: "h_reg",
    };
    const memConstraint: any = {
      id: "mem_constraint",
      title: "Secret isolation invariant",
      content: "Never log raw bearer tokens",
      type: "constraint",
      content_hash: "h_const",
    };
    const memTimeless: any = {
      id: "mem_timeless",
      title: "Architecture boundary",
      content: "Store operations must be idempotent",
      type: "architecture",
      temporal_mode: "timeless",
      content_hash: "h_time",
    };

    // Record seen for session A
    testTracker.recordSeen(sessionA, [memRegular, memConstraint, memTimeless], {
      now: baseTime,
      ttlMs: 120_000,
    });

    // Filter for session A at baseTime + 30s
    const filteredA = testTracker.filterSeen(
      sessionA,
      [memRegular, memConstraint, memTimeless],
      { now: baseTime + 30_000, ttlMs: 120_000 }
    );

    // Regular memory is suppressed; constraint and timeless are exempt
    expect(filteredA.allowed.map((m) => m.id)).toEqual(["mem_constraint", "mem_timeless"]);
    expect(filteredA.suppressed.length).toBe(1);
    expect(filteredA.suppressed[0].item.id).toBe("mem_regular");
    expect(filteredA.suppressed[0].reason).toContain("seen_chunk_suppressed");
    expect(filteredA.suppressed[0].reason).toContain("90s TTL remaining");

    // Session B is independent: regular memory should NOT be suppressed
    const filteredB = testTracker.filterSeen(
      sessionB,
      [memRegular, memConstraint, memTimeless],
      { now: baseTime + 30_000, ttlMs: 120_000 }
    );
    expect(filteredB.allowed.length).toBe(3);
    expect(filteredB.suppressed.length).toBe(0);

    // After resetSession for session A, regular memory is allowed again
    testTracker.resetSession(sessionA);
    const filteredAfterReset = testTracker.filterSeen(
      sessionA,
      [memRegular],
      { now: baseTime + 30_000, ttlMs: 120_000 }
    );
    expect(filteredAfterReset.allowed.length).toBe(1);
  });

  describe("retrieval & orchestrator integration", () => {
    let tmpDir: string;
    let store: Store;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "muse-seen-chunk-test-"));
      store = openStore(tmpDir);
    });

    afterEach(() => {
      if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("rankAndRetrieveMemories suppresses seen chunks within TTL window", async () => {
      propose(store, {
        id: "mem_cache_ttl",
        title: "Redis cluster cache eviction policy",
        content: "Cache eviction policy uses volatile-lru with 1GB memory limit",
        project: "infra",
        type: "decision",
        confirmed: true,
      });

      const session = "sess_retrieval_test";

      // 1. Initial retrieval records seen chunk
      const res1 = await rankAndRetrieveMemories(store, "Redis cluster cache", {
        sessionId: session,
        suppressSeenChunks: true,
        seenChunkTtlMs: 60_000,
        project: "infra",
      });
      expect(res1.length).toBe(1);
      expect(res1[0].entry.id).toBe("mem_cache_ttl");

      // 2. Second retrieval within TTL window suppresses the chunk
      const res2 = await rankAndRetrieveMemories(store, "Redis cluster cache", {
        sessionId: session,
        suppressSeenChunks: true,
        seenChunkTtlMs: 60_000,
        project: "infra",
      });
      expect(res2.length).toBe(0);

      // 3. Retrieval with suppressSeenChunks disabled still returns it
      const res3 = await rankAndRetrieveMemories(store, "Redis cluster cache", {
        sessionId: session,
        suppressSeenChunks: false,
        project: "infra",
      });
      expect(res3.length).toBe(1);
    });

    it("resolveMuseContext suppresses seen chunks, records telemetry, and reports in withheld_memories", async () => {
      propose(store, {
        id: "mem_db_pool",
        title: "Postgres Connection Pool Sizing",
        content: "Max pool size capped at 25 connections per replica to prevent connection saturation",
        project: "database",
        type: "architecture",
        confirmed: true,
      });

      const session = "sess_context_orch";

      // Turn 1: Retrieves memory and auto-records into seen-chunk tracker
      const ctx1 = await resolveMuseContext(store, tmpDir, {
        query: "Postgres connection pool",
        project: "database",
        session_id: session,
        suppress_seen_chunks: true,
        seen_chunk_ttl_ms: 100_000,
      });
      expect(ctx1.relevant_memories.some((m) => m.id === "mem_db_pool")).toBe(true);
      expect(ctx1.seen_chunk_suppressed_count).toBeUndefined();

      // Turn 2: Seen-chunk suppression withholds the item and reports in withheld_memories
      const ctx2 = await resolveMuseContext(store, tmpDir, {
        query: "Postgres connection pool",
        project: "database",
        session_id: session,
        suppress_reinjected: false,
        suppress_seen_chunks: true,
        seen_chunk_ttl_ms: 100_000,
      });
      expect(ctx2.relevant_memories.some((m) => m.id === "mem_db_pool")).toBe(false);
      expect(ctx2.seen_chunk_suppressed_count).toBe(1);
      expect(ctx2.withheld_memories).toBeDefined();
      const withheld = ctx2.withheld_memories!.find((w) => w.id === "mem_db_pool");
      expect(withheld).toBeDefined();
      expect(withheld!.reason).toContain("seen_chunk_suppressed");
    });
  });
});
