import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openStore,
  propose,
  save,
  type Store,
  getSidecarStaleness,
  refreshSidecarsRatioBatched,
  loadAbstractSidecar,
  loadAbstractSidecarFromDb,
} from "../src/store.ts";

describe("T-123: Ratio-batched sidecar refresh", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-sidecar-batch-test-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  function seedEntries(count: number) {
    const entries = [];
    for (let i = 1; i <= count; i++) {
      const entry = propose(store, {
        title: `Architectural invariant #${i} regarding distributed consensus`,
        content: `Detailed documentation for consensus node #${i}. High availability requires quorum of n/2 + 1 nodes.`,
        type: "decision",
        project: "test",
        tags: ["consensus", "raft", `node-${i}`],
      });
      entries.push(entry);
    }
    return entries;
  }

  describe("getSidecarStaleness", () => {
    it("reports all entries as missing when no sidecars exist", () => {
      seedEntries(5);
      const report = getSidecarStaleness(store);

      expect(report.total).toBe(5);
      expect(report.missing_count).toBe(5);
      expect(report.hash_mismatch_count).toBe(0);
      expect(report.stale_count).toBe(5);
      expect(report.fresh_count).toBe(0);
      expect(report.stale_ratio).toBe(1.0);
      expect(report.stale_candidates.length).toBe(5);
      expect(report.stale_candidates[0].reason).toBe("missing");
    });

    it("detects content hash mismatches when entry is modified", () => {
      const [entry] = seedEntries(1);
      // Refresh to generate sidecar
      const refreshResult = refreshSidecarsRatioBatched(store, { ratio: 1.0 });
      expect(refreshResult.refreshed_count).toBe(1);

      // Now it's 100% fresh
      const freshReport = getSidecarStaleness(store);
      expect(freshReport.stale_count).toBe(0);
      expect(freshReport.fresh_count).toBe(1);
      expect(freshReport.stale_ratio).toBe(0);

      // Modify the memory entry content
      const modified = {
        ...entry,
        content: "Updated consensus rule: Now requires 2/3 supermajority instead of simple majority.",
        updated_at: new Date().toISOString(),
      };
      save(store, modified);

      // Now staleness should detect hash_mismatch
      const staleReport = getSidecarStaleness(store);
      expect(staleReport.stale_count).toBe(1);
      expect(staleReport.hash_mismatch_count).toBe(1);
      expect(staleReport.missing_count).toBe(0);
      expect(staleReport.stale_candidates[0].reason).toBe("hash_mismatch");
    });
  });

  describe("refreshSidecarsRatioBatched", () => {
    it("returns zero refreshed when all sidecars are already fresh", () => {
      seedEntries(3);
      refreshSidecarsRatioBatched(store, { ratio: 1.0 });

      const secondRun = refreshSidecarsRatioBatched(store, { ratio: 0.5 });
      expect(secondRun.refreshed_count).toBe(0);
      expect(secondRun.stale_count).toBe(0);
      expect(secondRun.stale_ratio).toBe(0);
      expect(secondRun.skipped_count).toBe(0);
    });

    it("respects ratio bounding on stale candidates", () => {
      seedEntries(10);

      // 10 stale entries, ratio = 0.3 -> refreshes ceil(10 * 0.3) = 3
      const batch1 = refreshSidecarsRatioBatched(store, { ratio: 0.3, maxBatch: 20 });
      expect(batch1.total_entries).toBe(10);
      expect(batch1.stale_count).toBe(10);
      expect(batch1.refreshed_count).toBe(3);
      expect(batch1.skipped_count).toBe(7);
      expect(batch1.refreshed_ids.length).toBe(3);

      // Next run: 7 stale entries remain, ratio = 0.5 -> refreshes ceil(7 * 0.5) = 4
      const batch2 = refreshSidecarsRatioBatched(store, { ratio: 0.5, maxBatch: 20 });
      expect(batch2.stale_count).toBe(7);
      expect(batch2.refreshed_count).toBe(4);
      expect(batch2.skipped_count).toBe(3);

      // Next run: 3 stale entries remain, ratio = 1.0 -> refreshes 3
      const batch3 = refreshSidecarsRatioBatched(store, { ratio: 1.0 });
      expect(batch3.stale_count).toBe(3);
      expect(batch3.refreshed_count).toBe(3);
      expect(batch3.skipped_count).toBe(0);

      // Store is now completely refreshed
      const finalReport = getSidecarStaleness(store);
      expect(finalReport.fresh_count).toBe(10);
      expect(finalReport.stale_count).toBe(0);
    });

    it("respects maxBatch hard cap", () => {
      seedEntries(20);

      // ratio = 0.5 would want ceil(20 * 0.5) = 10, but maxBatch = 4 limits to 4
      const res = refreshSidecarsRatioBatched(store, { ratio: 0.5, maxBatch: 4 });
      expect(res.stale_count).toBe(20);
      expect(res.refreshed_count).toBe(4);
      expect(res.batch_size_applied).toBe(4);
      expect(res.skipped_count).toBe(16);
    });

    it("forces refresh when force: true is specified", () => {
      const [entry] = seedEntries(1);
      refreshSidecarsRatioBatched(store, { ratio: 1.0 });

      // Even though sidecar is fresh, force: true refreshes it
      const forceRes = refreshSidecarsRatioBatched(store, { ratio: 1.0, force: true });
      expect(forceRes.refreshed_count).toBe(1);
      expect(forceRes.refreshed_ids[0]).toBe(entry.id);
    });

    it("persists sidecars into both disk files and SQLite table", () => {
      const [entry] = seedEntries(1);
      refreshSidecarsRatioBatched(store, { ratio: 1.0 });

      // Verify on disk
      const diskSidecar = loadAbstractSidecar(store.memoryDir!, entry.id);
      expect(diskSidecar).not.toBeNull();
      expect(diskSidecar!.l0).toContain("Architectural invariant #1");

      // Verify in SQLite
      const dbSidecar = loadAbstractSidecarFromDb(store.db!, entry.id);
      expect(dbSidecar).not.toBeNull();
      expect(dbSidecar!.l0).toBe(diskSidecar!.l0);
      expect(dbSidecar!.l1.summary).toBe(diskSidecar!.l1.summary);
    });
  });
});
