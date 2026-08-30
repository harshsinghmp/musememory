import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyRuntimeFiles, getRuntimeTrustVerdict } from "../src/graph.ts";
import type { MemoryEntry } from "../src/types.ts";

const testDir = join(process.cwd(), ".tmp-test-sow200");

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

describe("SOW-201: Live Runtime File & Symbol Verification Gate", () => {

  it("returns STRONG when all affected paths exist on live disk", () => {
    writeFileSync(join(testDir, "auth.ts"), "export function verifyToken() {}");
    const entry: MemoryEntry = {
      id: "m_1",
      title: "Auth helper",
      content: "Use verifyToken for authentication",
      project: "test",
      status: "confirmed",
      type: "architecture",
      tags: ["auth"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      graph: {
        provider: "codegraph",
        symbol_names: ["verifyToken"],
        affected_paths: ["auth.ts"],
      },
    };

    const verdict = verifyRuntimeFiles(entry, testDir);
    expect(verdict.verdict).toBe("STRONG");
    expect(verdict.missingPaths).toEqual([]);
    expect(verdict.existingPaths).toEqual(["auth.ts"]);
  });

  it("returns STALE when referenced affected paths do not exist on disk", () => {
    const entry: MemoryEntry = {
      id: "m_2",
      title: "Deleted module memory",
      content: "Old helper in deleted file",
      project: "test",
      status: "confirmed",
      type: "fix",
      tags: ["legacy"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      graph: {
        provider: "codegraph",
        symbol_names: ["oldHelper"],
        affected_paths: ["deleted_service.ts"],
      },
    };

    const verdict = verifyRuntimeFiles(entry, testDir);
    expect(verdict.verdict).toBe("STALE");
    expect(verdict.missingPaths).toEqual(["deleted_service.ts"]);
  });

  it("returns STRONG when entry has no affected_paths attached", () => {
    const entry: MemoryEntry = {
      id: "m_3",
      title: "General preference",
      content: "Always use strict typing",
      project: "test",
      status: "confirmed",
      type: "preference",
      tags: ["typescript"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const verdict = verifyRuntimeFiles(entry, testDir);
    expect(verdict.verdict).toBe("STRONG");
  });
});

describe("SOW-202: Deterministic Relevance Cutoff Gate", () => {
  it("filters out low-scoring entries below minScoreThreshold (default 0.45)", async () => {
    const { scoreEntry } = await import("../src/retrieval.ts");
    const irrelevantEntry: MemoryEntry = {
      id: "m_irrelevant",
      title: "CSS gradient color styling",
      content: "Use linear-gradient for buttons",
      project: "test",
      status: "confirmed",
      type: "preference",
      tags: ["css", "styling"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Query completely unrelated to CSS styling
    const score = scoreEntry(irrelevantEntry, ["postgres", "migration", "database"]);
    expect(score).toBeLessThan(0.45);
  });

  it("queryContext drops entries below minScoreThreshold when configured", async () => {
    const { filterByRelevanceThreshold } = await import("../src/retrieval.ts");
    const scoredEntries = [
      { entry: { id: "m_1" } as any, score: 0.85 },
      { entry: { id: "m_2" } as any, score: 0.52 },
      { entry: { id: "m_3" } as any, score: 0.31 }, // below threshold
      { entry: { id: "m_4" } as any, score: 0.12 }, // below threshold
    ];

    const filtered = filterByRelevanceThreshold(scoredEntries, 0.45);
    expect(filtered.length).toBe(2);
    expect(filtered.map(f => f.entry.id)).toEqual(["m_1", "m_2"]);
  });
});

describe("SOW-203: Git Code-Drift Scanner", () => {
  it("detects drifted memories when referenced files are modified or deleted in git diff", async () => {
    const { scanCodeDriftFromDiff } = await import("../src/drift.ts");
    const entries: MemoryEntry[] = [
      {
        id: "m_drift_1",
        title: "Auth service memory",
        content: "Uses AuthService in src/auth.ts",
        project: "test",
        status: "confirmed",
        type: "architecture",
        tags: ["auth"],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        graph: {
          provider: "codegraph",
          symbol_names: ["AuthService"],
          affected_paths: ["src/auth.ts"],
        },
      },
      {
        id: "m_stable_2",
        title: "Database pool",
        content: "Uses pool in src/db.ts",
        project: "test",
        status: "confirmed",
        type: "architecture",
        tags: ["db"],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        graph: {
          provider: "codegraph",
          symbol_names: ["createPool"],
          affected_paths: ["src/db.ts"],
        },
      },
    ];

    mkdirSync(join(testDir, "src"), { recursive: true });
    writeFileSync(join(testDir, "src", "auth.ts"), "export class AuthService {}");

    const gitChangedFiles = ["src/auth.ts"];
    const report = scanCodeDriftFromDiff(entries, gitChangedFiles, testDir);

    expect(report.isDrifted).toBe(true);
    expect(report.driftCount).toBe(1);
    expect(report.driftedMemories[0].memoryId).toBe("m_drift_1");
    expect(report.driftedMemories[0].affectedPath).toBe("src/auth.ts");
    expect(report.driftedMemories[0].suggestedAction).toBe("verify");
  });

  it("returns isDrifted: false when no memory references changed files", async () => {
    const { scanCodeDriftFromDiff } = await import("../src/drift.ts");
    const entries: MemoryEntry[] = [
      {
        id: "m_stable",
        title: "Database pool",
        content: "Uses pool in src/db.ts",
        project: "test",
        status: "confirmed",
        type: "architecture",
        tags: ["db"],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        graph: {
          provider: "codegraph",
          symbol_names: ["createPool"],
          affected_paths: ["src/db.ts"],
        },
      },
    ];

    const report = scanCodeDriftFromDiff(entries, ["src/unrelated.ts"]);
    expect(report.isDrifted).toBe(false);
    expect(report.driftCount).toBe(0);
    expect(report.driftedMemories).toEqual([]);
  });
});

describe("SOW-204: Gradient-Free Hebbian Co-Activation Plasticity", () => {
  it("increments co-occurrence edge weight when memories are co-activated", async () => {
    const { recordCoActivation, getHebbianAssociationWeight } = await import("../src/plasticity.ts");
    const memoryDir = join(testDir, ".memory");
    mkdirSync(memoryDir, { recursive: true });

    // Initial weight is 0
    expect(getHebbianAssociationWeight("m_alpha", "m_beta", memoryDir)).toBe(0);

    // Co-activate m_alpha and m_beta once
    recordCoActivation(["m_alpha", "m_beta"], memoryDir);
    expect(getHebbianAssociationWeight("m_alpha", "m_beta", memoryDir)).toBeCloseTo(0.05, 2);
    expect(getHebbianAssociationWeight("m_beta", "m_alpha", memoryDir)).toBeCloseTo(0.05, 2); // symmetric

    // Co-activate again
    recordCoActivation(["m_alpha", "m_beta"], memoryDir);
    expect(getHebbianAssociationWeight("m_alpha", "m_beta", memoryDir)).toBeCloseTo(0.10, 2);
  });

  it("retrieves top associative memories for a given anchor memory", async () => {
    const { recordCoActivation, getAssociatedMemories } = await import("../src/plasticity.ts");
    const memoryDir = join(testDir, ".memory_plasticity");
    mkdirSync(memoryDir, { recursive: true });

    recordCoActivation(["m_auth", "m_jwt"], memoryDir);
    recordCoActivation(["m_auth", "m_jwt"], memoryDir);
    recordCoActivation(["m_auth", "m_cookies"], memoryDir);

    const associations = getAssociatedMemories("m_auth", memoryDir);
    expect(associations.length).toBe(2);
    expect(associations[0].targetId).toBe("m_jwt");
    expect(associations[0].weight).toBeCloseTo(0.10, 2);
    expect(associations[1].targetId).toBe("m_cookies");
    expect(associations[1].weight).toBeCloseTo(0.05, 2);
  });
});

describe("SOW-205: Semantic Memory Prompt Compression", () => {
  it("compresses prompt markdown text, removing whitespace fluff and reducing tokens", async () => {
    const { compressPromptContext } = await import("../src/compress.ts");
    const verboseMarkdown = `
### Active Working Constraints (CURRENT.md)

- Constraint 1: Always use strict TypeScript.


- Constraint 2: Never commit .env files.


### Relevant Memories & Learned Patterns

#### Auth Token Refresh [ARCHITECTURE] (Confirmed)

We use JWT refresh tokens stored in secure httpOnly cookies.

*Tags: auth, jwt, security*

---

*Memory Directive: When learning durable facts, bug resolutions, or user preferences, call memory_capture immediately.*
`;

    const result = compressPromptContext(verboseMarkdown);

    expect(result.compressedTokens).toBeLessThan(result.originalTokens);
    expect(result.savingsPercent).toBeGreaterThan(15);
    expect(result.compressed).toContain("Constraint 1: Always use strict TypeScript");
    expect(result.compressed).toContain("Auth Token Refresh");
    expect(result.compressed).not.toContain("\n\n\n");
  });

  it("handles empty or single-line text without error", async () => {
    const { compressPromptContext } = await import("../src/compress.ts");
    const result = compressPromptContext("");
    expect(result.compressed).toBe("");
    expect(result.compressedTokens).toBe(0);
    expect(result.savingsPercent).toBe(0);
  });
});




