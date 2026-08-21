import { describe, test, expect } from "bun:test";
import { scoreEntry, sortCandidates, tokenize, stalePolicyDays } from "../src/rank.ts";
import { DEFAULT_STALE_DAYS } from "../src/types.ts";
import type { MemoryEntry } from "../src/types.ts";

const NOW = Date.parse("2026-08-20T00:00:00Z");

function entry(over: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: "m_1_x",
    title: "t",
    content: "alpha beta gamma",
    project: "p",
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

describe("ranking", () => {
  test("superseded < disputed < active with same applicability", () => {
    const active = entry({ status: "active" });
    const disputed = entry({ status: "disputed" });
    const superseded = entry({ status: "superseded" });
    const tokens = tokenize("alpha beta gamma");
    const sa = scoreEntry(active, tokens, NOW);
    const sd = scoreEntry(disputed, tokens, NOW);
    const ss = scoreEntry(superseded, tokens, NOW);
    expect(ss).toBeLessThan(sd);
    expect(sd).toBeLessThan(sa);
  });

  test("confirmed ranks above active with same applicability", () => {
    const active = entry({ status: "active" });
    const confirmed = entry({ status: "confirmed" });
    const tokens = tokenize("alpha beta gamma");
    const sa = scoreEntry(active, tokens, NOW);
    const sc = scoreEntry(confirmed, tokens, NOW);
    expect(sc).toBeGreaterThan(sa);
  });

  test("independently-verified gets verification bonus", () => {
    const unverified = entry({ status: "active", verification: { level: "unverified" } });
    const verified = entry({ status: "active", verification: { level: "independently-verified" } });
    const tokens = tokenize("alpha beta gamma");
    const su = scoreEntry(unverified, tokens, NOW);
    const sv = scoreEntry(verified, tokens, NOW);
    expect(sv).toBeGreaterThan(su);
  });

  test("graph symbols add capped bonus but never override supersession", () => {
    const activeWithGraph = entry({
      status: "active",
      graph: { provider: "codegraph", symbol_names: ["GammaHandler"] },
    });
    const supersededWithGraph = entry({
      status: "superseded",
      graph: { provider: "codegraph", symbol_names: ["GammaHandler"] },
    });
    const tokens = tokenize("gammahandler");
    const sa = scoreEntry(activeWithGraph, tokens, NOW);
    const ss = scoreEntry(supersededWithGraph, tokens, NOW);
    expect(sa).toBeGreaterThan(ss);
  });

  test("newer updated_at ranks above older (tau=90d decay)", () => {
    const newer = entry({ id: "m_2_new", updated_at: "2026-08-01T00:00:00Z" });
    const older = entry({ id: "m_3_old", updated_at: "2026-01-01T00:00:00Z" });
    const ranked = sortCandidates([older, newer], tokenize("alpha beta gamma"), NOW);
    expect(ranked[0].entry.id).toBe("m_2_new");
  });

  test("tokenize is lowercase alphanumeric-only", () => {
    expect(tokenize("Foo-Bar 123 baz!")).toEqual(["foo", "bar", "123", "baz"]);
  });

  test("stalePolicyDays per type", () => {
    expect(stalePolicyDays("fix")).toBe(90);
    expect(stalePolicyDays("operation")).toBe(180);
    expect(stalePolicyDays("architecture")).toBe(365);
    expect(stalePolicyDays("discovery")).toBe(30);
    expect(stalePolicyDays("preference")).toBeNull();
    expect(stalePolicyDays(undefined)).toBe(DEFAULT_STALE_DAYS);
  });
});