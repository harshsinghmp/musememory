import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose } from "../src/store.ts";
import { queryContext } from "../src/retrieval.ts";

describe("benchmark packing: title-less memories", () => {
  test("token-budgeted retrieval does not crash when title is absent", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-titleless-"));
    try {
      const store = openStore(memoryDir);
      propose(store, { content: "a memory without an explicit title", project: "p", confirmed: true });
      const result = queryContext(store, "memory without title", { tokenBudget: 200, limit: 3, project: "p" });
      expect(Array.isArray(result.results)).toBe(true);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });
});
