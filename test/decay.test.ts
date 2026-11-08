import { describe, test, expect } from "bun:test";
import { computeRetention, ebbinghausRetention, sortByRetention } from "../src/quality/decay.ts";

describe("T-430: Ebbinghaus retention with reinforcement", () => {
  test("halves at one half-life and respects the floor", () => {
    expect(ebbinghausRetention(0, 30)).toBe(1);
    expect(ebbinghausRetention(30, 30)).toBeCloseTo(0.5, 6);
    expect(ebbinghausRetention(60, 30)).toBeCloseTo(0.25, 6);
    expect(ebbinghausRetention(1000, 30, 0.1)).toBe(0.1);
  });

  test("unverified candidates decay faster than confirmed memories", () => {
    const candidate = computeRetention({ status: "candidate" }, 7);
    const confirmed = computeRetention({ status: "confirmed", verification: { level: "verified" } }, 7);
    expect(candidate.unverified).toBe(true);
    expect(confirmed.unverified).toBe(false);
    expect(candidate.retention).toBeCloseTo(0.5, 6);
    expect(confirmed.retention).toBeGreaterThan(0.9);
  });

  test("green-test reinforcement extends the half-life without resetting age", () => {
    const plain = computeRetention({ status: "confirmed" }, 90);
    const reinforced = computeRetention({ status: "confirmed" }, 90, { reinforcement: 1 });
    expect(plain.retention).toBeCloseTo(0.5, 6);
    expect(reinforced.retention).toBeCloseTo(Math.pow(0.5, 0.5), 6);
    expect(reinforced.halfLifeDays).toBe(180);
  });

  test("sorts by retention and preserves the entry", () => {
    const sorted = sortByRetention([
      { entry: { status: "candidate", id: "old" }, ageDays: 30 },
      { entry: { status: "confirmed", id: "new" }, ageDays: 1 },
    ]);
    expect(sorted[0].entry.id).toBe("new");
    expect(sorted[1].entry.id).toBe("old");
  });
});
