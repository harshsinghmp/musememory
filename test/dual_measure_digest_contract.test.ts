import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.ts";
import {
  dualMeasureTokens,
  validateDigestIntegrity,
} from "../src/compaction/tokens.ts";
import { resolveMuseContext } from "../src/orchestrator/context.ts";

describe("Wave 4 - Task 4: Honest Dual-Measure Token Accounting & Refuse-Incomplete Digest", () => {
  let testDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "musememory-wave4-task4-test-"));
    memoryDir = join(testDir, ".memory");
    store = openStore(memoryDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("T-053: Honest dual-measure token accounting", () => {
    test("computes standard and pessimistic tokens for plain text", () => {
      const text = "This is a simple plain text message describing architectural goals.";
      const res = dualMeasureTokens(text);
      expect(res.standardTokens).toBeGreaterThan(0);
      expect(res.pessimisticTokens).toBeGreaterThan(0);
      expect(res.conservativeTokens).toBe(Math.max(res.standardTokens, res.pessimisticTokens));
      expect(res.inflationRatio).toBeGreaterThanOrEqual(1.0);
    });

    test("accurately penalizes dense code syntax, symbols, and non-ASCII characters in pessimistic count", () => {
      const denseCode = `
        const payload = { "user_id": 12345, "token": "sk-proj-xyz", "flags": [true, false, null] };
        function compute(a: number, b: number): number { return (a * b) / (a + b); }
        // 🚀 Unicode comment: äöü Grüße
      `;
      const res = dualMeasureTokens(denseCode);
      // Code syntax and punctuation should yield higher pessimistic tokens than naive chars / 4
      expect(res.pessimisticTokens).toBeGreaterThan(res.standardTokens);
      expect(res.conservativeTokens).toBe(res.pessimisticTokens);
      expect(res.inflationRatio).toBeGreaterThan(1.1);
    });
  });

  describe("T-054: Refuse-incomplete digest contract", () => {
    test("validateDigestIntegrity validates complete structured CURRENT.md", () => {
      const validDigest = [
        "# 📍 Active Workspace Context & Invariants (CURRENT.md)",
        "## 🔒 1. Active Working Constraints & Invariants",
        "- Zero credential leaks",
        "## 🎯 2. High-Level Goal",
        "Deliver reliable cognitive memory engine",
        "## 🏗️ 3. Current Architecture & Data Flow",
        "Dual-scope SQLite engine",
        "## ✅ 4. Implemented & Done",
        "- [x] Feature 1",
        "## ⏳ 5. Explicitly Not Done Yet",
        "- [ ] Feature 2",
        "## 🚀 6. Next Concrete Task",
        "> **Next Up**: Complete Feature 2",
      ].join("\n");

      const result = validateDigestIntegrity(validDigest);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    test("validateDigestIntegrity rejects truncated or corrupted digests with explicit reason", () => {
      // 1. Missing required section
      const missingGoal = [
        "# 📍 Active Workspace Context & Invariants (CURRENT.md)",
        "## 🔒 1. Active Working Constraints & Invariants",
        "- Zero credential leaks",
        "## 🏗️ 3. Current Architecture & Data Flow",
      ].join("\n");
      const res1 = validateDigestIntegrity(missingGoal);
      expect(res1.valid).toBe(false);
      expect(res1.reason).toContain("missing mandatory section: 2. High-Level Goal");

      // 2. Explicit truncation marker
      const truncated = [
        "# 📍 Active Workspace Context & Invariants (CURRENT.md)",
        "## 🎯 2. High-Level Goal",
        "Fix bug",
        "## 🚀 6. Next Concrete Task",
        "> Next Up: Fix",
        "[INCOMPLETE_DIGEST: session truncated by token limit]",
      ].join("\n");
      const res2 = validateDigestIntegrity(truncated);
      expect(res2.valid).toBe(false);
      expect(res2.reason).toContain("contains incomplete digest marker");
    });

    test("resolveMuseContext refuses incomplete CURRENT.md digest and surfaces withheld notice", async () => {
      const corruptCurrentMd = [
        "# 📍 Active Workspace Context & Invariants (CURRENT.md)",
        "## 🔒 1. Active Working Constraints",
        "- Corrupted constraint",
        "[INCOMPLETE_DIGEST: turn cut off unexpectedly]",
      ].join("\n");

      writeFileSync(join(memoryDir, "CURRENT.md"), corruptCurrentMd, "utf8");

      const context = await resolveMuseContext(store, testDir, {
        query: "test corrupted digest handling",
      });

      // The corrupted CURRENT.md constraints should NOT be ingested as active constraints
      expect(context.active_constraints.some((c) => c.id === "current_md_constraints")).toBe(false);

      // Should be reported in withheld_memories
      expect(context.withheld_memories).toBeDefined();
      expect(
        context.withheld_memories?.some((w) => w.reason.includes("corrupted_or_incomplete_digest")),
      ).toBe(true);

      // Should be noted in suggested next steps
      expect(
        context.suggested_next_steps.some((s) => s.includes("Refused incomplete or corrupted CURRENT.md digest")),
      ).toBe(true);
    });
  });
});
