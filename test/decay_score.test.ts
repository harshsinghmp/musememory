import { describe, it, expect } from "bun:test";
import { computeHalfLife, computeDecayScore } from "../src/retention.ts";
import { openStore, propose, get, list } from "../src/store.ts";
import { computeFactors } from "../src/retrieval.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";
import { join } from "node:path";

describe("T-074: Materialized decay_score column and importance-gated half-lives", () => {
  it("scales half-life according to importance / salience gating", () => {
    // Base fix half-life is 120 days, verificationLevel: reproducible (mult: 1.0)
    const neutralHalfLife = computeHalfLife("fix", {
      accessCount: 0,
      verificationLevel: "reproducible",
      reinforcement: 0,
    });
    expect(neutralHalfLife).toBe(120);

    // Low salience (0.1) shrinks half-life
    const lowImportanceHalfLife = computeHalfLife("fix", {
      accessCount: 0,
      verificationLevel: "reproducible",
      reinforcement: 0,
      salience: 0.1,
    });
    expect(lowImportanceHalfLife).toBeLessThan(neutralHalfLife!);

    // High salience (0.95) expands half-life
    const highImportanceHalfLife = computeHalfLife("fix", {
      accessCount: 0,
      verificationLevel: "reproducible",
      reinforcement: 0,
      salience: 0.95,
    });
    expect(highImportanceHalfLife).toBeGreaterThan(neutralHalfLife!);
  });

  it("computes standardized exponential retention scores with computeDecayScore", () => {
    const now = Date.now();
    const entry = {
      type: "fix",
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
      verification: { level: "reproducible" },
      access_count: 0,
      salience: 0.25, // importance factor = 0.5 + 0.25*2 = 1.0 => halfLife = 120 days
    };

    // Day 0: fully fresh = 1.0
    expect(computeDecayScore(entry, now)).toBe(1.0);

    // At exactly half-life (120 days later): decay_score should be 0.50
    const halfLifeLater = now + 120 * 86_400_000;
    const halfScore = computeDecayScore(entry, halfLifeLater);
    expect(halfScore).toBeCloseTo(0.5, 2);

    // At 2 half-lives (240 days later): decay_score should be 0.25
    const doubleHalfLifeLater = now + 240 * 86_400_000;
    const quarterScore = computeDecayScore(entry, doubleHalfLifeLater);
    expect(quarterScore).toBeCloseTo(0.25, 2);

    // Timeless rules and constraints never decay (always 1.0)
    const timelessEntry = {
      type: "constraint",
      temporal_mode: "timeless",
      created_at: new Date(now - 365 * 86_400_000).toISOString(),
      updated_at: new Date(now - 365 * 86_400_000).toISOString(),
    };
    expect(computeDecayScore(timelessEntry, now)).toBe(1.0);
  });

  it("materializes decay_score into SQLite memories table and indexes it", () => {
    const root = makeTempRoot();
    const memoryDir = join(root, ".memory");
    const store = openStore(memoryDir);

    expect(store.db).toBeDefined();

    // Verify migration 4 created the column
    const cols = store.db!.query<{ name: string }>("PRAGMA table_info(memories)").all().map((c) => c.name);
    expect(cols).toContain("decay_score");

    // Propose an entry and verify decay_score is materialized
    const entry = propose(store, {
      title: "Materialized Decay Test",
      content: "Verifying SQLite storage of decay_score column.",
      project: "retention",
      confirmed: true,
      salience: 0.8,
    });

    expect(typeof entry.decay_score).toBe("number");
    expect(entry.decay_score).toBe(1.0);

    // Query directly from SQLite
    const row = store.db!.query<{ decay_score: number }>("SELECT decay_score FROM memories WHERE id = ?").get([entry.id]);
    expect(row?.decay_score).toBe(1.0);

    // Retrieve via store get and list
    const fetched = get(store, entry.id);
    expect(fetched?.decay_score).toBe(1.0);

    const all = list(store);
    const found = all.find((m) => m.id === entry.id);
    expect(found?.decay_score).toBe(1.0);

    cleanup(root);
  });

  it("includes decayScore in retrieval factor breakdown", () => {
    const now = Date.now();
    const entry = {
      id: "mem_test_decay",
      title: "Authentication Token Lifecycle",
      content: "Refresh token rotation policy.",
      project: "auth",
      status: "confirmed" as const,
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
      decay_score: 0.85,
    };

    const factors = computeFactors(entry, ["token"], { now });
    expect(factors.decayScore).toBe(0.85);
  });
});
