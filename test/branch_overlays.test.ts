import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, list, get } from "../src/store.ts";
import {
  createBranchOverlay,
  writeBranchEntry,
  listBranchMemories,
  mergeBranchOverlay,
  dropBranchOverlay,
  loadBranchOverlay,
} from "../src/store/branch.ts";

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
