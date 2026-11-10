import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, get } from "../src/store.ts";
import { buildPreflightQuery, preflightContext } from "../src/hooks/preflight.ts";
import { estimateTokens } from "../src/compress.ts";

describe("T-433: speculative pre-flight context", () => {
  test("builds a file-derived query and a bounded context pack", () => {
    expect(buildPreflightQuery(["src/auth/session.ts"], "feat/login")).toBe("feat/login session");
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-preflight-"));
    try {
      const store = openStore(memoryDir);
      const entry = propose(store, { content: "auth session tokens are rotated every request", project: "p", confirmed: true });
      const countAccess = () =>
        store.db!.query<{ access_count: number }>("SELECT access_count FROM memories WHERE id = ?").get([entry.id])?.access_count ?? 0;
      const before = countAccess();
      const result = preflightContext(store, { files: ["src/auth/session.ts"], tokenBudget: 400 });
      expect(result.query).toContain("session");
      expect(result.context.entries.length).toBeGreaterThan(0);
      expect(result.context.totalTokensUsed).toBeLessThanOrEqual(400);
      expect(countAccess()).toBe(before);

      const plain = preflightContext(store, { files: ["src/auth/session.ts"] });
      const tested = preflightContext(store, { files: ["src/auth/session.ts", "test/auth.test.ts"] });
      expect(tested.risk.score).toBeLessThan(plain.risk.score);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  // W26-2: the reported figure used to count entries only, so the appended
  // USER.md block and the memory directive were invisible to the budget check
  // and a "400 token" pack could inject over 1,100.
  test("reports the whole pack, not just the entry subset", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-preflight-w262-"));
    try {
      const store = openStore(memoryDir);
      writeFileSync(join(memoryDir, "USER.md"), `# USER\n\n${"- prefers strict TypeScript and long descriptive names\n".repeat(8)}`);
      for (let i = 0; i < 25; i++) {
        propose(store, {
          content: `auth session tokens are rotated every request variant ${i} with enough text to cost tokens`,
          project: "p",
          confirmed: true,
        });
      }
      const result = preflightContext(store, { files: ["src/auth/session.ts"], tokenBudget: 400 });
      // The reported cost must equal the real cost of what will be injected.
      expect(result.markdownTokens).toBe(estimateTokens(result.context.markdown));
      expect(result.withinBudget).toBe(true);
      expect(result.markdownTokens).toBeLessThanOrEqual(400);
      // The mandatory profile block survives the shrink; entries are what give way.
      expect(result.context.markdown).toContain("User Profile & Preferences");
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  test("degrades honestly when mandatory blocks alone exceed the budget", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-preflight-w262-over-"));
    try {
      const store = openStore(memoryDir);
      writeFileSync(join(memoryDir, "USER.md"), `# USER\n\n${"- an extremely long preference line that costs a lot of tokens\n".repeat(200)}`);
      const result = preflightContext(store, { files: ["src/auth/session.ts"], tokenBudget: 200 });
      // It cannot fit, so it must say so rather than silently claim the budget.
      expect(result.withinBudget).toBe(false);
      expect(result.markdownTokens).toBeGreaterThan(200);
      expect(result.markdownTokens).toBe(estimateTokens(result.context.markdown));
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  // Degenerate budgets must not spin the shrink loop or claim compliance.
  test("degenerate budgets terminate and report honestly", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-preflight-w262-edge-"));
    try {
      const store = openStore(memoryDir);
      propose(store, { content: "auth session tokens are rotated", project: "p", confirmed: true });
      for (const budget of [1, 0, -5, Number.NaN]) {
        const result = preflightContext(store, { files: ["src/auth/session.ts"], tokenBudget: budget });
        // The shrink loop is bounded: it must terminate, not spin.
        expect(result.withinBudget).toBe(false);
        expect(result.context.entries.length).toBe(0);
        expect(result.markdownTokens).toBe(estimateTokens(result.context.markdown));
      }
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });
});
