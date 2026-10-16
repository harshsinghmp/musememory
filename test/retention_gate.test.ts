import { describe, it, expect } from "bun:test";
import { calculateRetentionScore } from "../src/quality/retention.ts";

describe("T-104: Retention Gate & Informational Density Scorer", () => {
  it("rejects conversational fillers with score < 0.30", () => {
    const fillers = [
      "ok",
      "thanks!",
      "Thank you",
      "noted.",
      "Got it",
      "done",
      "sounds good",
      "test",
      "hello",
      "thanks for the update",
      "sounds good to me",
    ];
    for (const f of fillers) {
      const res = calculateRetentionScore(f);
      expect(res.passed).toBe(false);
      expect(res.score).toBeLessThan(0.3);
      expect(res.reason).toMatch(/Conversational filler|greeting/i);
    }
  });

  it("rejects ultra-short content (< 3 chars) without title or confirmation", () => {
    const res = calculateRetentionScore("a");
    expect(res.passed).toBe(false);
    expect(res.score).toBeLessThan(0.3);
    expect(res.reason).toContain("below minimum admission threshold");
  });

  it("rejects repetitive junk with low diversity", () => {
    const res = calculateRetentionScore("dummy dummy dummy dummy dummy dummy dummy dummy");
    expect(res.passed).toBe(false);
    expect(res.score).toBeLessThan(0.3);
    expect(res.reason).toContain("diversity");
  });

  it("accepts substantive technical knowledge (> 0.30)", () => {
    const content = "SQLite database lock recovery timeout set to 300s to avoid stale outbox deadlocks.";
    const res = calculateRetentionScore(content);
    expect(res.passed).toBe(true);
    expect(res.score).toBeGreaterThanOrEqual(0.3);
  });

  it("rewards code blocks and markdown structure", () => {
    const content = `### Invariant Rule\n\nAlways use \`withTransaction()\` when modifying SQLite.\n\`\`\`ts\nconst x = 1;\n\`\`\``;
    const res = calculateRetentionScore(content);
    expect(res.passed).toBe(true);
    expect(res.score).toBeGreaterThanOrEqual(0.5);
    expect(res.breakdown.structureScore).toBeGreaterThan(0);
  });
});
