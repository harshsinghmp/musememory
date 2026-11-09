import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, get } from "../src/store.ts";
import { buildPreflightQuery, preflightContext } from "../src/hooks/preflight.ts";

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
});
