import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, type Store } from "../src/store.ts";
import {
  deriveCandidateKeepReasons,
  deriveCandidateDropReason,
  evaluateCandidateDecisions,
  type CandidateKeepReason,
  type CandidateDropReason,
} from "../src/retrieval/candidate_reasons.ts";
import { calculateMultiFactorScore, rankAndRetrieveMemories } from "../src/retrieval/ranking.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("T-121: Typed drop/keep reasons per candidate in retrieval", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-reasons-test-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe("deriveCandidateKeepReasons", () => {
    const baseEntry: MemoryEntry = {
      id: "mem-test-1",
      title: "Test memory",
      content: "Test memory content",
      type: "decision",
      status: "active",
      confidence: 0.9,
      project: "test",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    it("derives kept:active_constraint and kept:within_budget for constraint entry", () => {
      const constraintEntry: MemoryEntry = {
        ...baseEntry,
        type: "constraint",
      };
      const reasons = deriveCandidateKeepReasons(constraintEntry);
      expect(reasons).toContain("kept:active_constraint");
      expect(reasons).toContain("kept:within_budget");
    });

    it("derives kept:timeless_rule for timeless memory", () => {
      const timelessEntry: MemoryEntry = {
        ...baseEntry,
        temporal_mode: "timeless",
      };
      const reasons = deriveCandidateKeepReasons(timelessEntry);
      expect(reasons).toContain("kept:timeless_rule");
    });

    it("derives kept:verified_memory for verified memory", () => {
      const verifiedEntry: MemoryEntry = {
        ...baseEntry,
        verification: { level: "user-confirmed" },
      };
      const reasons = deriveCandidateKeepReasons(verifiedEntry);
      expect(reasons).toContain("kept:verified_memory");
    });

    it("derives factor-based reasons from scoring factors", () => {
      const result = calculateMultiFactorScore(baseEntry, ["test", "memory"], {});
      expect(result.keep_reasons).toBeDefined();
      expect(result.keep_reasons).toContain("kept:within_budget");
      expect(result.keep_reasons).toContain("kept:high_relevance");
    });
  });

  describe("deriveCandidateDropReason", () => {
    it("maps keywords to canonical typed drop tokens", () => {
      expect(deriveCandidateDropReason("reinjection_suppressed")).toBe("dropped:reinjection_suppressed");
      expect(deriveCandidateDropReason("self_echo_suppressed")).toBe("dropped:self_echo_suppressed");
      expect(deriveCandidateDropReason("seen_chunk_suppressed")).toBe("dropped:seen_chunk_suppressed");
      expect(deriveCandidateDropReason("token_budget_exceeded")).toBe("dropped:token_budget_exceeded");
      expect(deriveCandidateDropReason("below_min_threshold")).toBe("dropped:below_min_threshold");
      expect(deriveCandidateDropReason("limit_exceeded")).toBe("dropped:limit_exceeded");
      expect(deriveCandidateDropReason("superseded_or_rejected")).toBe("dropped:superseded_or_rejected");
      expect(deriveCandidateDropReason("untrusted_tier")).toBe("dropped:untrusted_tier");
      expect(deriveCandidateDropReason("drifted_anchor")).toBe("dropped:drifted_anchor");
      expect(deriveCandidateDropReason("dedup_prefer_observation")).toBe("dropped:dedup_prefer_observation");
    });
  });

  describe("evaluateCandidateDecisions", () => {
    it("evaluates keep and drop decisions across candidate array", () => {
      const candidate1: MemoryEntry = {
        id: "mem-keep-1",
        title: "Database index decision",
        content: "We use B-tree index for lookup",
        type: "decision",
        status: "active",
        confidence: 0.95,
        project: "test",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const candidate2: MemoryEntry = {
        id: "mem-drop-1",
        title: "Old scratchpad",
        content: "Outdated notes",
        type: "session",
        status: "active",
        confidence: 0.5,
        project: "test",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const evaluations = evaluateCandidateDecisions(
        [
          { entry: candidate1, score: 0.85 },
          { entry: candidate2, score: 0.20, drop_reason: "token_budget_exceeded" },
        ],
        new Set(["mem-keep-1"]),
      );

      expect(evaluations.length).toBe(2);
      expect(evaluations[0].decision).toBe("keep");
      expect(evaluations[0].id).toBe("mem-keep-1");
      expect(evaluations[0].reasons).toContain("kept:within_budget");

      expect(evaluations[1].decision).toBe("drop");
      expect(evaluations[1].id).toBe("mem-drop-1");
      expect(evaluations[1].reasons).toContain("dropped:token_budget_exceeded");
    });
  });

  describe("rankAndRetrieveMemories integration", async () => {
    it("attaches keep_reasons to all returned memories", async () => {
      propose(store, {
        title: "Critical architecture boundary",
        content: "Service mesh boundary enforcement and mTLS validation",
        type: "constraint",
        project: "test",
        tags: ["security"],
      });

      const results = await rankAndRetrieveMemories(store, "service mesh boundary constraint", {
        limit: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      const top = results[0];
      expect(top.keep_reasons).toBeDefined();
      expect(top.keep_reasons).toContain("kept:active_constraint");
      expect(top.keep_reasons).toContain("kept:within_budget");
    });
  });
});
