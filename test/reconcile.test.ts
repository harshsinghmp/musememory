import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, save, get } from "../src/store.ts";
import { createCodeAnchor } from "../src/anchors/resolver.ts";
import { reconcileCodeAnchors, formatReconcileReport } from "../src/health/reconcile.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("Interactive Code Anchor Reconciler", () => {
  let tempDir: string;
  let storeDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "muse-reconcile-test-"));
    storeDir = join(tempDir, ".memory");
    mkdirSync(storeDir, { recursive: true });
    mkdirSync(join(storeDir, "memories"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("identifies valid, drifted, and orphaned code anchors and respects dry-run mode", async () => {
    const store = openStore(storeDir);

    // 1. Create source files
    const srcDir = join(tempDir, "src");
    mkdirSync(srcDir, { recursive: true });
    const liveFile = join(srcDir, "live.ts");
    writeFileSync(liveFile, "export function liveFn() { return 1; }\n", "utf8");

    // Create anchor for live file
    const validAnchor = createCodeAnchor(tempDir, {
      kind: "symbol",
      filePath: "src/live.ts",
      symbolName: "liveFn",
    });

    // Create anchor for non-existent file
    const orphanedAnchor = {
      id: "anc_dead_1",
      kind: "file" as const,
      file_path: "src/deleted.ts",
      created_at: new Date().toISOString(),
    };

    // Save memory with both anchors
    const entry: MemoryEntry = {
      id: "m_reconcile_1",
      title: "Test memory with mixed anchors",
      content: "This memory anchors both a valid and an orphaned file.",
      project: "reconcile-test",
      status: "confirmed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      anchors: [validAnchor, orphanedAnchor],
    };
    save(store, entry);

    // 2. Run Dry Run
    const dryReport = await reconcileCodeAnchors(store, {
      prune: true,
      markStale: true,
      dryRun: true,
      workspaceRoot: tempDir,
    });

    expect(dryReport.totalAuditedEntries).toBe(1);
    expect(dryReport.totalAnchors).toBe(2);
    expect(dryReport.validCount).toBe(1);
    expect(dryReport.orphanedCount).toBe(1);
    expect(dryReport.prunedAnchorsCount).toBe(1); // 1 anchor flagged to prune

    // Verify entry in store was NOT modified during dry run
    const entryAfterDry = get(store, "m_reconcile_1");
    expect(entryAfterDry?.anchors?.length).toBe(2);

    // 3. Run Live Reconcile with pruning
    const liveReport = await reconcileCodeAnchors(store, {
      prune: true,
      markStale: false,
      dryRun: false,
      workspaceRoot: tempDir,
    });

    expect(liveReport.prunedAnchorsCount).toBe(1);

    // Verify orphaned anchor was pruned from memory in store
    const entryAfterPrune = get(store, "m_reconcile_1");
    expect(entryAfterPrune?.anchors?.length).toBe(1);
    expect(entryAfterPrune?.anchors?.[0].file_path).toBe("src/live.ts");

    // Format report
    const formatted = formatReconcileReport(liveReport, false);
    expect(formatted).toContain("CODE ANCHOR RECONCILIATION & ORPHAN SWEEPER");
    expect(formatted).toContain("Pruned Anchors:   1");
  });

  it("marks memory stale when all anchors are orphaned and markStale is true", async () => {
    const store = openStore(storeDir);

    const deadAnchor = {
      id: "anc_dead_only",
      kind: "file" as const,
      file_path: "src/completely_removed.ts",
      created_at: new Date().toISOString(),
    };

    const entry: MemoryEntry = {
      id: "m_all_dead",
      title: "Memory whose file was deleted",
      content: "This whole feature was decommissioned.",
      project: "reconcile-test",
      status: "confirmed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      anchors: [deadAnchor],
    };
    save(store, entry);

    const report = await reconcileCodeAnchors(store, {
      prune: true,
      markStale: true,
      dryRun: false,
      workspaceRoot: tempDir,
    });

    expect(report.staleEntriesCount).toBe(1);

    const entryAfterStale = get(store, "m_all_dead");
    expect(entryAfterStale?.status).toBe("stale");
    expect(entryAfterStale?.anchors ?? []).toHaveLength(0);
  });
});
