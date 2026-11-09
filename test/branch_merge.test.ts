import { describe, test, expect } from "bun:test";
import { mergeMemories3Way } from "../src/quality/branch_merge.ts";
import type { MemoryEntry } from "../src/types.ts";

function entry(id: string, content: string, overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id,
    title: id,
    content,
    project: "p",
    type: "discovery",
    status: "confirmed",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    tags: [],
    ...overrides,
  } as MemoryEntry;
}

describe("T-439: three-way semantic memory merge", () => {
  test("takes the changed side when the other is unchanged", () => {
    const result = mergeMemories3Way(
      [entry("m_1_a", "v1"), entry("m_2_b", "keep")],
      [entry("m_1_a", "v2"), entry("m_2_b", "keep")],
      [entry("m_1_a", "v1"), entry("m_2_b", "keep")],
    );
    expect(result.conflicts).toEqual([]);
    expect(result.merged.find((item) => item.id === "m_1_a")?.content).toBe("v2");
    expect(result.merged.some((item) => item.id === "m_2_b")).toBe(true);
  });

  test("reports modify/modify and honours ours/theirs", () => {
    const base = [entry("m_1_a", "base")];
    const ours = [entry("m_1_a", "ours")];
    const theirs = [entry("m_1_a", "theirs")];
    const semantic = mergeMemories3Way(base, ours, theirs, { strategy: "semantic" });
    expect(semantic.conflicts.map((c) => c.reason)).toEqual(["modify/modify"]);
    expect(mergeMemories3Way(base, ours, theirs, { strategy: "theirs" }).merged[0].content).toBe("theirs");
  });

  test("semantic containment and delete/modify resolution", () => {
    const contained = mergeMemories3Way(
      [entry("m_1_a", "base")],
      [entry("m_1_a", "base plus more context")],
      [entry("m_1_a", "base")],
    );
    expect(contained.merged[0].content).toBe("base plus more context");

    const deleted = mergeMemories3Way(
      [entry("m_1_a", "base")],
      [entry("m_1_a", "changed")],
      [],
      { strategy: "theirs" },
    );
    expect(deleted.conflicts).toEqual([]);
    expect(deleted.resolutions["m_1_a"]).toBe("dropped");
    expect(deleted.merged).toEqual([]);
  });

  test("add/add conflicts and manual decisions", () => {
    const base: MemoryEntry[] = [];
    const ours = [entry("m_1_a", "ours")];
    const theirs = [entry("m_1_a", "theirs")];
    expect(mergeMemories3Way(base, ours, theirs).conflicts[0].reason).toBe("add/add");
    const decided = mergeMemories3Way(base, ours, theirs, {
      strategy: "manual",
      decide: () => "ours",
    });
    expect(decided.merged[0].content).toBe("ours");
  });
});
