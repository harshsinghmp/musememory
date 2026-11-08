import { describe, test, expect } from "bun:test";
import { filterBiTemporal, isBiTemporallyVisible } from "../src/temporal.ts";
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

describe("T-429: bi-temporal windows", () => {
  test("filters on world-time validity", () => {
    const e = entry({ valid_from: "2026-02-01T00:00:00Z", valid_to: "2026-03-01T00:00:00Z" });
    expect(isBiTemporallyVisible(e, { validAt: "2026-01-15T00:00:00Z" })).toBe(false);
    expect(isBiTemporallyVisible(e, { validAt: "2026-02-15T00:00:00Z" })).toBe(true);
    expect(isBiTemporallyVisible(e, { validAt: "2026-03-01T00:00:00Z" })).toBe(false);
  });

  test("filters on belief time independently of world time", () => {
    const e = entry({ asserted_at: "2026-04-01T00:00:00Z", valid_from: "2026-01-01T00:00:00Z" });
    expect(isBiTemporallyVisible(e, { assertedAt: "2026-03-01T00:00:00Z" })).toBe(false);
    expect(isBiTemporallyVisible(e, { assertedAt: "2026-04-02T00:00:00Z" })).toBe(true);
  });

  test("compares epochs, not strings, and rejects invalid timestamps", () => {
    const e = entry({ created_at: "2026-03-01T09:00:00+05:30" });
    expect(isBiTemporallyVisible(e, { validAt: "2026-03-01T05:00:00Z" })).toBe(true);
    expect(() => isBiTemporallyVisible(e, { validAt: "yesterday" })).toThrow(/Invalid validAt/);
  });

  test("both clocks must agree and empty queries pass through", () => {
    const e = entry({ asserted_at: "2026-04-01T00:00:00Z", valid_to: "2026-02-01T00:00:00Z" });
    expect(isBiTemporallyVisible(e, { validAt: "2026-01-01T00:00:00Z", assertedAt: "2026-01-01T00:00:00Z" })).toBe(false);
    expect(filterBiTemporal([e], {})).toEqual([e]);
  });
});
