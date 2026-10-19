import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeQueryTopicOverlap,
  SessionPrefetchCache,
  defaultPrefetchCache,
  DEFAULT_TOPIC_OVERLAP_THRESHOLD,
} from "../src/retrieval/prefetch.ts";
import { resolveMuseContext } from "../src/orchestrator/context.ts";
import { openStore, propose } from "../src/store.ts";
import type { Store } from "../src/store.ts";

describe("T-112: Topic-overlap >0.6 prefetch skip", () => {
  let cache: SessionPrefetchCache;

  beforeEach(() => {
    cache = new SessionPrefetchCache();
    defaultPrefetchCache.clearAll();
  });

  afterEach(() => {
    cache.clearAll();
    defaultPrefetchCache.clearAll();
  });

  describe("computeQueryTopicOverlap", () => {
    it("returns 1.0 for identical or case-insensitive query matches", () => {
      expect(computeQueryTopicOverlap("Postgres connection pool", "postgres connection pool")).toBe(1.0);
      expect(computeQueryTopicOverlap("   cache eviction   ", "cache eviction")).toBe(1.0);
    });

    it("returns 0 for empty or disjoint queries", () => {
      expect(computeQueryTopicOverlap("", "something")).toBe(0);
      expect(computeQueryTopicOverlap("postgres database connection", "react css styling layout")).toBe(0);
    });

    it("calculates accurate Jaccard token overlap for related queries", () => {
      const q1 = "postgres database connection pool sizing";
      const q2 = "postgres database connection pool timeout parameters";
      const overlap = computeQueryTopicOverlap(q1, q2);
      expect(overlap).toBeGreaterThan(0.5);
    });
  });

  describe("SessionPrefetchCache", () => {
    it("returns skip: false for initial query", () => {
      const decision = cache.checkPrefetchSkip("sess_1", "Optimize postgres indexing");
      expect(decision.skip).toBe(false);
      expect(decision.overlap).toBe(0);
    });

    it("skips prefetch when consecutive query overlap exceeds 0.6 threshold", () => {
      const session = "sess_overlap";
      const q1 = "redis cluster cache eviction volatile lru";
      const mockPayload = { id: "res_1", tokens: 120 };

      cache.recordPrefetch(session, q1, mockPayload);

      // High overlap query (> 0.6)
      const q2 = "redis cluster cache eviction volatile ttl policy";
      const decision = cache.checkPrefetchSkip(session, q2);
      expect(decision.skip).toBe(true);
      expect(decision.overlap).toBeGreaterThan(DEFAULT_TOPIC_OVERLAP_THRESHOLD);
      expect(decision.priorQuery).toBe(q1);
      expect(decision.reason).toContain("topic_overlap_skip");

      const cached = cache.getCached(session);
      expect(cached).toEqual(mockPayload);
    });

    it("does not skip prefetch when query shifts to another topic", () => {
      const session = "sess_shift";
      cache.recordPrefetch(session, "database migration scripts", { data: 1 });

      const decision = cache.checkPrefetchSkip(session, "front-end accessibility audits");
      expect(decision.skip).toBe(false);
      expect(decision.overlap).toBeLessThan(0.6);
    });

    it("respects custom threshold and TTL expiration", () => {
      const session = "sess_ttl";
      const baseTime = 1000000;
      cache.recordPrefetch(session, "auth token refresh logic", { data: 2 }, { now: baseTime, ttlMs: 30_000 });

      // Within TTL: skips if overlap > 0.5 with custom threshold
      const check1 = cache.checkPrefetchSkip(session, "auth token refresh expiration", {
        now: baseTime + 10_000,
        threshold: 0.5,
        ttlMs: 30_000,
      });
      expect(check1.skip).toBe(true);

      // After TTL: cache expires, skip is false
      const check2 = cache.checkPrefetchSkip(session, "auth token refresh expiration", {
        now: baseTime + 35_000,
        threshold: 0.5,
        ttlMs: 30_000,
      });
      expect(check2.skip).toBe(false);
    });

    it("maintains session isolation and allows invalidation", () => {
      cache.recordPrefetch("sess_a", "worker pool thread count", { sess: "a" });

      // Session B has no prior query
      expect(cache.checkPrefetchSkip("sess_b", "worker pool thread count").skip).toBe(false);

      // Invalidate session A
      cache.invalidate("sess_a");
      expect(cache.checkPrefetchSkip("sess_a", "worker pool thread count").skip).toBe(false);
    });
  });

  describe("resolveMuseContext integration", () => {
    let tmpDir: string;
    let store: Store;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "muse-topic-overlap-test-"));
      store = openStore(tmpDir);
    });

    afterEach(() => {
      if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("skips prefetch and reuses cached context on high topic overlap", async () => {
      propose(store, {
        id: "mem_kafka_cluster",
        title: "Kafka consumer group lag monitoring",
        content: "Monitor consumer group lag using burrow with alerts at 1000 messages",
        project: "streaming",
        type: "architecture",
        confirmed: true,
      });

      const session = "sess_ctx_overlap";

      // Call 1: Initial query
      const q1 = "kafka consumer group lag monitoring";
      const ctx1 = await resolveMuseContext(store, tmpDir, {
        query: q1,
        project: "streaming",
        session_id: session,
        check_topic_overlap: true,
      });
      expect(ctx1.prefetch_skipped).toBeFalsy();
      expect(ctx1.relevant_memories.some((m) => m.id === "mem_kafka_cluster")).toBe(true);

      // Call 2: Consecutive high-overlap query (> 0.6)
      const q2 = "kafka consumer group lag alerts monitoring";
      const ctx2 = await resolveMuseContext(store, tmpDir, {
        query: q2,
        project: "streaming",
        session_id: session,
        check_topic_overlap: true,
      });
      expect(ctx2.prefetch_skipped).toBe(true);
      expect(ctx2.topic_overlap).toBeGreaterThan(0.6);
      expect(ctx2.topic_overlap_prior_query).toBe(q1);
      expect(ctx2.relevant_memories.some((m) => m.id === "mem_kafka_cluster")).toBe(true);

      // Call 3: Disjoint query -> fresh retrieval
      const q3 = "docker container memory limits cgroups";
      const ctx3 = await resolveMuseContext(store, tmpDir, {
        query: q3,
        project: "streaming",
        session_id: session,
        check_topic_overlap: true,
      });
      expect(ctx3.prefetch_skipped).toBeFalsy();
    });
  });
});
