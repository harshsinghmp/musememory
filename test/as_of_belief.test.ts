import { describe, test, expect } from "bun:test";
import { evaluateAsOf } from "../src/retrieval.ts";
import type { MemoryEntry } from "../src/types.ts";

function entry(overrides: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: "m_1_test",
    title: "test",
    content: "test",
    project: "p",
    status: "confirmed",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as MemoryEntry;
}

describe("T-429: as_of respects belief time", () => {
  test("an assertion recorded later is undetermined at an earlier query time", () => {
    const e = entry({ asserted_at: "2026-04-01T00:00:00Z" });
    const result = evaluateAsOf(e, "2026-03-01T00:00:00Z");
    expect(result.status).toBe("undetermined");
    expect(result.reason).toBe("asserted_after_target");
  });

  test("an assertion known before the query time stays valid", () => {
    const e = entry({ asserted_at: "2026-01-01T00:00:00Z" });
    expect(evaluateAsOf(e, "2026-03-01T00:00:00Z").status).toBe("valid");
  });
});
