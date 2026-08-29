import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSettings,
  setSettings,
  getProjectSettings,
  setProjectSettings,
  resetSettings,
  exportSettings,
  importSettings,
  validateSettings,
  DEFAULT_SETTINGS,
} from "../src/settings.ts";

describe("Global & Project Settings Module", () => {
  let testDir: string;
  let memoryDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "musememory-settings-"));
    memoryDir = join(testDir, ".memory");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns default settings on initial load", () => {
    const s = getSettings(memoryDir);
    expect(s.retrieval.defaultMode).toBe("hybrid");
    expect(s.retrieval.defaultTokenBudget).toBe(2000);
    expect(s.ui.graphEngine).toBe("auto");
  });

  it("persists global updates and validates schema", () => {
    const updated = setSettings(memoryDir, {
      retrieval: {
        defaultMode: "tree",
        defaultTokenBudget: 3000,
        defaultDisclosureDepth: "L1",
        treeMaxDepth: 6,
        enableLLMReasoning: false,
        hybridVectorWeight: 0.4,
        hybridTreeWeight: 0.6,
      },
    });
    expect(updated.retrieval.defaultMode).toBe("tree");
    expect(updated.retrieval.defaultTokenBudget).toBe(3000);

    const reloaded = getSettings(memoryDir);
    expect(reloaded.retrieval.defaultMode).toBe("tree");
  });

  it("rejects invalid configuration values and path traversal", () => {
    expect(() => {
      setSettings(memoryDir, {
        retrieval: {
          defaultMode: "invalid-mode" as any,
          defaultTokenBudget: -100,
          defaultDisclosureDepth: "L2",
          treeMaxDepth: 5,
          enableLLMReasoning: false,
          hybridVectorWeight: 0.5,
          hybridTreeWeight: 0.5,
        },
      });
    }).toThrow();

    expect(() => {
      setSettings(memoryDir, {
        wiki: {
          ...DEFAULT_SETTINGS.wiki,
          outputDir: "../escape",
        },
      });
    }).toThrow(/traversal/i);
  });

  it("handles project-level overrides independently", () => {
    setProjectSettings(memoryDir, "client-a", {
      retrieval: {
        ...DEFAULT_SETTINGS.retrieval,
        defaultTokenBudget: 5000,
      },
    });

    const clientA = getProjectSettings(memoryDir, "client-a");
    const globalS = getSettings(memoryDir);

    expect(clientA.retrieval?.defaultTokenBudget).toBe(5000);
    expect(globalS.retrieval.defaultTokenBudget).toBe(2000);
  });

  it("exports and imports configuration", () => {
    setSettings(memoryDir, {
      ui: {
        ...DEFAULT_SETTINGS.ui,
        theme: "dark",
      },
    });

    const json = exportSettings(memoryDir);
    expect(json).toContain("dark");

    const newDir = join(testDir, "new-memory");
    importSettings(newDir, json);

    const imported = getSettings(newDir);
    expect(imported.ui.theme).toBe("dark");
  });
});
