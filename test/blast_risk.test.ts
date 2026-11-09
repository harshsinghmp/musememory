import { describe, test, expect } from "bun:test";
import { scoreBlastRadius } from "../src/intelligence/blast_risk.ts";

describe("T-434: blast-radius risk scoring", () => {
  test("scales with files, symbols, lines and penalties", () => {
    const small = scoreBlastRadius({ files: ["src/a.ts"], symbols: ["a"], changedLines: 10, hasTests: true });
    expect(small.level).toBe("low");

    const wide = scoreBlastRadius({ files: ["src/a.ts", "cli/b.ts", "test/c.ts", "db/d.ts"], symbols: ["a", "b", "c", "d", "e"], changedLines: 800, hasTests: false, crossModule: true });
    expect(wide.level).toBe("critical");
    expect(wide.score).toBe(100);
    expect(wide.factors.noTests).toBe(15);
  });

  test("is deterministic for identical input", () => {
    const input = { files: ["src/a.ts", "src/b.ts"], symbols: ["x"], changedLines: 120, hasTests: true };
    expect(scoreBlastRadius(input)).toEqual(scoreBlastRadius(input));
  });
});
