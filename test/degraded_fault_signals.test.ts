import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, save, propose, type Store } from "../src/store.ts";
import {
  queryContext,
  formatPromptContext,
  queryTieredContext,
  createDegradedFaultSignal,
  mergeDegradedFaults,
  formatDegradedFaultNotice,
} from "../src/retrieval.ts";
import {
  resolveMuseContext,
  formatCompactContextPack,
} from "../src/orchestrator/context.ts";

describe("T-133: degraded − notes fault signal", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-degraded-faults-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Fault Signals Helpers (faults.ts)", () => {
    it("creates degraded fault signal accurately from diagnostic notes", () => {
      const emptySignal = createDegradedFaultSignal([]);
      expect(emptySignal.degraded).toBe(false);
      expect(emptySignal.degraded_notes).toBeUndefined();
      expect(emptySignal.fault_notes).toBeUndefined();

      const faultSignal = createDegradedFaultSignal([
        "fts5_degraded: lexical index unavailable",
        "cache_fallback: serving stale context",
      ]);
      expect(faultSignal.degraded).toBe(true);
      expect(faultSignal.degraded_notes).toEqual([
        "fts5_degraded: lexical index unavailable",
        "cache_fallback: serving stale context",
      ]);
      expect(faultSignal.fault_notes).toEqual(faultSignal.degraded_notes);
    });

    it("merges multiple fault signals and deduplicates diagnostic notes", () => {
      const sig1 = {
        degraded: true,
        degraded_notes: ["circuit_open: tripped after failures", "duplicate_note"],
      };
      const sig2 = {
        degraded: false,
        fault_notes: ["duplicate_note", "vector_down: embeddings unreachable"],
      };

      const merged = mergeDegradedFaults(sig1, sig2);
      expect(merged.degraded).toBe(true);
      expect(merged.degraded_notes?.length).toBe(3);
      expect(merged.degraded_notes).toContain("circuit_open: tripped after failures");
      expect(merged.degraded_notes).toContain("duplicate_note");
      expect(merged.degraded_notes).toContain("vector_down: embeddings unreachable");
    });

    it("renders formatted degraded markdown notice", () => {
      const notice = formatDegradedFaultNotice(["note A", "note B"]);
      expect(notice).toContain("> ⚠️ **Degraded Retrieval Fault**: Operating in degraded fallback mode due to:");
      expect(notice).toContain("> - note A");
      expect(notice).toContain("> - note B");
    });
  });

  describe("queryContext Degraded Fault Signal", () => {
    it("returns clean non-degraded signals during normal healthy operation", () => {
      save(
        store,
        propose(store, {
          title: "Healthy memory",
          content: "Clean execution without faults or subsystem failures.",
          project: "test",
          type: "fix",
          confirmed: true,
          skipRetentionGate: true,
        })
      );

      const res = queryContext(store, "execution");
      expect(res.source).toBe("live");
      expect(res.degraded).toBeUndefined();
      expect(res.degraded_notes).toBeUndefined();
    });

    it("surfaces degraded boolean and explicit fault notes when degraded", () => {
      const res = queryContext(store, "search query", {
        degraded: true,
        degraded_notes: ["fts5_failure: syntax error in tokenizer, fell back to scan"],
      });

      expect(res.source).toBe("degraded");
      expect(res.degraded).toBe(true);
      expect(res.degraded_notes).toBeDefined();
      expect(res.degraded_notes).toContain("fts5_failure: syntax error in tokenizer, fell back to scan");
      expect(res.fault_notes).toEqual(res.degraded_notes);
    });

    it("captures circuit breaker open state as degraded fault signal", () => {
      if (store.circuit) {
        // Force circuit breaker open
        for (let i = 0; i < 6; i++) {
          store.circuit.recordFailure();
        }
        expect(store.circuit.isDegraded()).toBe(true);
      }

      const res = queryContext(store, "test query");
      expect(res.source).toBe("degraded");
      expect(res.degraded).toBe(true);
      expect(res.degraded_notes?.some((n) => n.includes("circuit_breaker_open"))).toBe(true);
    });
  });

  describe("formatPromptContext & Tiered Retrieval Degraded Signal", () => {
    it("renders degraded fault notice in formatPromptContext markdown", () => {
      const formatted = formatPromptContext(store, tmpDir, "query", {
        degraded: true,
        degraded_notes: ["sqlite_busy: database locked, read from in-memory fallback"],
      });

      expect(formatted.degraded).toBe(true);
      expect(formatted.degraded_notes).toBeDefined();
      expect(formatted.degraded_notes?.[0]).toContain("sqlite_busy");
      expect(formatted.markdown).toContain("⚠️ **Degraded Retrieval Fault**");
      expect(formatted.markdown).toContain("sqlite_busy: database locked");
    });

    it("propagates degraded fault signals across Tier 0 and Tier 1", () => {
      const t0 = queryTieredContext(store, tmpDir, "query", {
        tier: 0,
        degraded: true,
        degraded_notes: ["tier0_degraded: manifest partial"],
      });
      expect(t0.degraded).toBe(true);
      expect(t0.degraded_notes).toEqual(["tier0_degraded: manifest partial"]);
      expect(t0.markdown).toContain("⚠️ **Degraded Retrieval Fault**");

      const t1 = queryTieredContext(store, tmpDir, "query", {
        tier: 1,
        degraded: true,
        degraded_notes: ["tier1_degraded: routing incomplete"],
      });
      expect(t1.degraded).toBe(true);
      expect(t1.degraded_notes).toEqual(["tier1_degraded: routing incomplete"]);
      expect(t1.markdown).toContain("⚠️ **Degraded Retrieval Fault**");
    });
  });

  describe("resolveMuseContext & formatCompactContextPack Integration", () => {
    it("aggregates degraded fault signals into FusedContextResult", async () => {
      // Simulate corrupted CURRENT.md
      const currentMdPath = join(tmpDir, "CURRENT.md");
      writeFileSync(currentMdPath, "[INCOMPLETE_DIGEST: turn terminated abruptly]");

      const fused = await resolveMuseContext(store, tmpDir, {
        query: "architecture",
        degraded_notes: ["custom_fault: simulated network lag"],
      });

      expect(fused.degraded).toBe(true);
      expect(fused.degraded_notes).toBeDefined();
      expect(fused.degraded_notes).toContain("custom_fault: simulated network lag");
      expect(fused.degraded_notes?.some((n) => n.includes("digest_corrupted"))).toBe(true);
      expect(fused.fault_notes).toEqual(fused.degraded_notes);

      const compactPack = formatCompactContextPack(fused);
      expect(compactPack).toContain("⚠️ **Degraded Retrieval Fault**");
      expect(compactPack).toContain("custom_fault: simulated network lag");
    });
  });
});
