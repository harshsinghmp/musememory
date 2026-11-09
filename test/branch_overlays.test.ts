import { describe, test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, list, get, save } from "../src/store.ts";
import {
  createBranchOverlay,
  writeBranchEntry,
  listBranchMemories,
  mergeBranchOverlay,
  dropBranchOverlay,
  loadBranchOverlay,
  branchOverlayPath,
} from "../src/store/branch.ts";
import { getAuditTrail } from "../src/audit.ts";

describe("T-436: branchable memory overlays", () => {
  test("isolates branch writes from the base store and merges them back", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-branch-"));
    try {
      const store = openStore(memoryDir);
      const base = propose(store, { content: "base rule", project: "p", type: "constraint", confirmed: true });
      createBranchOverlay(store, { branch: "feat/x", baseBranch: "dev" });
      const overlayEntry = {
        ...base,
        id: "m_9999999999999_overlayrule",
        content: "overlay rule",
        title: "overlay rule",
      };
      writeBranchEntry(store, "feat/x", overlayEntry);

      expect(list(store).map((entry) => entry.id)).toEqual([base.id]);
      expect(listBranchMemories(store, "feat/x").map((entry) => entry.id).sort()).toEqual([base.id, overlayEntry.id].sort());

      const report = mergeBranchOverlay(store, "feat/x");
      expect(report.applied).toEqual([overlayEntry.id]);
      expect(get(store, overlayEntry.id)?.content).toBe("overlay rule");
      expect(loadBranchOverlay(memoryDir, "feat/x")).toBeNull();
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  test("keeps colliding branch names separate and rejects identity mismatch", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-branch-names-"));
    try {
      const store = openStore(memoryDir);
      createBranchOverlay(store, { branch: "feat/x" });
      expect(loadBranchOverlay(memoryDir, "feat_x")).toBeNull();
      expect(branchOverlayPath(memoryDir, "feat/x")).not.toBe(branchOverlayPath(memoryDir, "feat_x"));
      const path = branchOverlayPath(memoryDir, "feat/x");
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      parsed.meta.branch = "feat/y";
      writeFileSync(path, JSON.stringify(parsed));
      expect(() => loadBranchOverlay(memoryDir, "feat/x")).toThrow(/identity mismatch/);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  test("merges through the three-way resolver and surfaces conflicts", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-branch-merge3-"));
    try {
      const store = openStore(memoryDir);
      const base = propose(store, { content: "base rule", project: "p", type: "constraint", confirmed: true });
      createBranchOverlay(store, { branch: "feat/merge" });
      writeBranchEntry(store, "feat/merge", { ...get(store, base.id)!, content: "ours" });
      save(store, { ...get(store, base.id)!, content: "theirs" });

      const blocked = mergeBranchOverlay(store, "feat/merge", { strategy: "semantic" });
      expect(blocked.conflicts.map((c) => c.reason)).toEqual(["modify/modify"]);
      expect(loadBranchOverlay(memoryDir, "feat/merge")).not.toBeNull();

      const merged = mergeBranchOverlay(store, "feat/merge", { strategy: "ours" });
      expect(merged.applied).toContain(base.id);
      expect(get(store, base.id)?.content).toBe("ours");
      expect(getAuditTrail(memoryDir, { operation: "overlay_merge" }).length).toBeGreaterThan(0);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  test("drops an overlay without touching the base store", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-branch-drop-"));
    try {
      const store = openStore(memoryDir);
      createBranchOverlay(store, { branch: "feat/y" });
      expect(dropBranchOverlay(store, "feat/y")).toBe(true);
      expect(loadBranchOverlay(memoryDir, "feat/y")).toBeNull();
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });
});
