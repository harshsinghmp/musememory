import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, get, list, confirm, supersede } from "../src/store.ts";
import {
  computeFingerprint,
  computeJaccardSimilarity,
  findDuplicates,
  consolidateIntoCanonical,
  inferTemporalMode,
  determineQuality,
  detectConflict,
  flagConflict,
  resolveConflict,
  recordRetrievals,
  recordApplicationOutcome,
  computeMemoryRoi,
} from "../src/quality/index.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("R2 Memory Quality, Deduplication, Contradictions & ROI", () => {
  let testDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "musememory-quality-test-"));
    memoryDir = join(testDir, ".memory");
    store = openStore(memoryDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("Content Fingerprinting & Deduplication", () => {
    it("produces identical fingerprints for identical text despite markdown and whitespace differences", () => {
      const fp1 = computeFingerprint("Use Redis Cache", "We use Redis for session caching with a 1-hour TTL.");
      const fp2 = computeFingerprint(
        "### Use Redis Cache",
        "We use **Redis** for session caching with a   1-hour `TTL`.\n\n",
      );
      expect(fp1).toBe(fp2);
      expect(fp1.length).toBe(64);
    });

    it("detects exact fingerprint match and near-duplicate similarity", () => {
      propose(store, {
        title: "Docker Compose Development Setup",
        content: "Run docker compose up -d to spin up local postgres and redis services for development.",
        project: "infra",
        confirmed: true,
      });

      // Exact match check
      const match1 = findDuplicates(store, {
        title: "Docker Compose Development Setup",
        content: "Run docker compose up -d to spin up local postgres and redis services for development.",
        project: "infra",
      });
      expect(match1.exact).toBeDefined();
      expect(match1.exact?.title).toBe("Docker Compose Development Setup");

      // Similar match check
      const match2 = findDuplicates(store, {
        title: "Docker Compose Setup for Dev",
        content: "Execute docker compose up -d to start local postgres and redis services.",
        project: "infra",
        threshold: 0.5,
      });
      expect(match2.exact).toBeUndefined();
      expect(match2.similar.length).toBeGreaterThan(0);
      expect(match2.similar[0].similarity).toBeGreaterThan(0.5);
    });

    it("consolidates duplicate observations into canonical memory with evidence and reinforcement", () => {
      const canonical = propose(store, {
        title: "Postgres Connection Pool Limit",
        content: "Set max connections to 20 to prevent exhausting RDS instance memory.",
        project: "backend",
        confirmed: true,
      });
      expect(canonical.reinforcement ?? 0).toBe(0);

      // Propose exact duplicate with dedup: true
      const consolidated = propose(store, {
        title: "Postgres Connection Pool Limit",
        content: "Set max connections to 20 to prevent exhausting RDS instance memory.",
        project: "backend",
        source: "agent_transcript_session_12",
        dedup: true,
        evidence: [
          {
            id: "ev_session_12",
            type: "code",
            source: "knexfile.ts",
            timestamp: new Date().toISOString(),
            excerpt: "pool: { min: 2, max: 20 }",
          },
        ],
      });

      expect(consolidated.id).toBe(canonical.id);
      expect(consolidated.reinforcement).toBe(1);
      expect(consolidated.evidence?.length).toBe(1);
      expect(consolidated.evidence?.[0].id).toBe("ev_session_12");

      // Verify only 1 memory exists in the store
      const all = list(store);
      expect(all.length).toBe(1);
    });
  });

  describe("Temporal Modes & Quality Classification", () => {
    it("infers current, historical, and timeless temporal modes accurately", () => {
      expect(inferTemporalMode("Database Engine", "The application uses PostgreSQL 16.", "decision")).toBe("current");
      expect(
        inferTemporalMode(
          "Legacy Database",
          "The application used MySQL before migrating to Postgres.",
          "architecture",
        ),
      ).toBe("historical");
      expect(
        inferTemporalMode("Secret Scanning Policy", "Never commit unmasked API tokens to git.", "constraint"),
      ).toBe("timeless");
    });

    it("computes categorical quality states correctly across the lifecycle", () => {
      const entry = propose(store, {
        title: "Microservice Auth",
        content: "Authenticate via JWT bearer tokens.",
        project: "auth",
      });
      expect(entry.quality).toBe("LOW");

      const confirmed = confirm(store, entry.id)!;
      expect(confirmed.quality).toBe("MEDIUM");

      // Verify independently
      confirmed.verification = {
        level: "independently-verified",
        method: "test suite",
      };
      expect(determineQuality(confirmed)).toBe("VERIFIED");
    });
  });

  describe("Contradiction Engine & Conflict Resolution", () => {
    it("detects direct technological contradictions between incoming and existing memories", () => {
      propose(store, {
        title: "Database Architecture",
        content: "The primary database uses PostgreSQL for transactional persistence.",
        project: "core",
        confirmed: true,
      });

      const detection = detectConflict(store, {
        title: "Database Architecture",
        content: "The primary database uses MySQL with InnoDB storage engine.",
        project: "core",
      });

      expect(detection.conflicted).toBe(true);
      expect(detection.conflictingEntry?.title).toBe("Database Architecture");
      expect(detection.reason).toContain("Conflicting primary database choice");
    });

    it("flags conflicting memories with mutual conflict_ids and CONFLICTED status", () => {
      const memA = propose(store, {
        title: "Web Server Port Binding",
        content: "The API gateway binds to port 3000 in all environments.",
        project: "gateway",
        confirmed: true,
      });

      const memB = propose(store, {
        title: "Web Server Port Binding",
        content: "The API gateway binds to port 8080 in all environments.",
        project: "gateway",
        checkConflict: true,
      });

      expect(memB.status).toBe("conflicted");
      expect(memB.conflict_ids).toContain(memA.id);

      const refreshedA = get(store, memA.id)!;
      expect(refreshedA.status).toBe("conflicted");
      expect(refreshedA.conflict_ids).toContain(memB.id);
    });

    it("resolves conflict via 'historical' strategy, preserving past context", () => {
      const oldMem = propose(store, {
        title: "Primary Cache Store",
        content: "We use Memcached for distributed in-memory key-value caching.",
        project: "cache",
        confirmed: true,
      });

      const newMem = propose(store, {
        title: "Primary Cache Store",
        content: "We use Redis Cluster for distributed in-memory key-value caching.",
        project: "cache",
        confirmed: true,
      });

      flagConflict(store, oldMem.id, newMem.id, "Cache technology migrated from Memcached to Redis");

      const result = resolveConflict(store, {
        winningId: newMem.id,
        losingId: oldMem.id,
        strategy: "historical",
        reason: "Migrated infrastructure to Redis Cluster in Q3",
      });

      expect(result.success).toBe(true);
      expect(result.winning.status).toBe("confirmed");
      expect(result.winning.temporal_mode).toBe("current");
      expect(result.winning.conflict_ids?.length ?? 0).toBe(0);

      const refreshedOld = get(store, oldMem.id)!;
      expect(refreshedOld.status).toBe("active");
      expect(refreshedOld.temporal_mode).toBe("historical");
      expect(refreshedOld.title).toContain("[HISTORICAL]");
      expect(refreshedOld.content).toContain("Historical Context: Superseded by");
    });

    it("resolves conflict via 'supersede' strategy", () => {
      const oldMem = propose(store, {
        title: "Worker Thread Count",
        content: "enable 4 worker threads for background job execution.",
        project: "jobs",
        confirmed: true,
      });

      const newMem = propose(store, {
        title: "Worker Thread Count",
        content: "disable background workers and use serverless queue handlers.",
        project: "jobs",
        confirmed: true,
      });

      flagConflict(store, oldMem.id, newMem.id, "Workers configuration changed");

      const result = resolveConflict(store, {
        winningId: newMem.id,
        losingId: oldMem.id,
        strategy: "supersede",
        reason: "Moved to serverless architecture",
      });

      expect(result.success).toBe(true);
      expect(result.winning.status).toBe("confirmed");
      expect(get(store, oldMem.id)?.status).toBe("superseded");
    });
  });

  describe("Utility Tracking & Memory ROI", () => {
    it("tracks retrievals and increments retrieval_count and salience", () => {
      const mem = propose(store, {
        title: "Error Handling Standard",
        content: "All API endpoints must return structured RFC 7807 Problem Details JSON.",
        project: "api",
        confirmed: true,
      });

      expect(mem.utility?.retrieval_count ?? 0).toBe(0);
      const initialSalience = mem.salience ?? 0.5;

      recordRetrievals(store, [mem.id]);

      const refreshed = get(store, mem.id)!;
      expect(refreshed.utility?.retrieval_count).toBe(1);
      expect(refreshed.salience).toBeGreaterThanOrEqual(initialSalience);
    });

    it("records application outcomes, calculates success rate, and flags regressions", () => {
      const mem = propose(store, {
        title: "Webpack Deadlock Fix",
        content: "Increase worker memory limit to 4096MB.",
        project: "build",
        confirmed: true,
      });

      // 1. Record successful application
      recordApplicationOutcome(store, {
        memoryId: mem.id,
        success: true,
        notes: "Fixed build heap exhaustion",
      });

      let current = get(store, mem.id)!;
      expect(current.utility?.application_count).toBe(1);
      expect(current.utility?.successful_applications).toBe(1);
      expect(current.utility?.reuse_success_rate).toBe(1.0);
      expect(current.reinforcement).toBe(1);

      // 2. Record 3 consecutive regressions
      recordApplicationOutcome(store, { memoryId: mem.id, success: false, regression: true, notes: "OOM error 1" });
      recordApplicationOutcome(store, { memoryId: mem.id, success: false, regression: true, notes: "OOM error 2" });
      recordApplicationOutcome(store, { memoryId: mem.id, success: false, regression: true, notes: "OOM error 3" });

      current = get(store, mem.id)!;
      expect(current.utility?.application_count).toBe(4);
      expect(current.utility?.regressions).toBe(3);
      expect(current.utility?.reuse_success_rate).toBe(0.25);
      // Auto-flagged disputed upon 3 regressions
      expect(current.status).toBe("disputed");
    });

    it("computes comprehensive Memory ROI across the store", () => {
      const m1 = propose(store, { title: "M1", content: "c1", project: "app", confirmed: true });
      const m2 = propose(store, { title: "M2", content: "c2", project: "app", confirmed: true });

      recordApplicationOutcome(store, { memoryId: m1.id, success: true });
      recordApplicationOutcome(store, { memoryId: m1.id, success: true });
      recordApplicationOutcome(store, { memoryId: m2.id, success: false, regression: true });

      const roi = computeMemoryRoi(store, { project: "app" });
      expect(roi.totalMemories).toBe(2);
      expect(roi.totalApplications).toBe(3);
      expect(roi.totalSuccessfulApplications).toBe(2);
      expect(roi.totalFailedApplications).toBe(1);
      expect(roi.totalRegressions).toBe(1);
      expect(roi.overallReuseSuccessRate).toBeCloseTo(0.667, 2);
      expect(roi.topPerformingMemories.length).toBe(1);
      expect(roi.topPerformingMemories[0].id).toBe(m1.id);
      expect(roi.concerningMemories.length).toBe(1);
      expect(roi.concerningMemories[0].id).toBe(m2.id);
    });
  });
});
