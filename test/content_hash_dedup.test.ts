import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeContent, computeContentHash } from "../src/quality/dedup.ts";
import { openStore, propose, list } from "../src/store.ts";

describe("T-040: normalized content_hash and deduplication", () => {
  test("normalizeContent folds case and collapses arbitrary whitespace", () => {
    const rawA = "Always verify with  `bun   test`   before claiming completion.\n\n";
    const rawB = "always verify with `bun test` before claiming completion.";

    expect(normalizeContent(rawA)).toBe(normalizeContent(rawB));
    expect(computeContentHash(rawA)).toBe(computeContentHash(rawB));
  });

  test("propose with dedup:true consolidates whitespace/case variants into canonical entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "content-hash-test-"));
    const memoryDir = join(dir, ".memory");
    const store = openStore(memoryDir);

    const first = propose(store, {
      title: "Clean verification standard",
      content: "Run bun test and tsc before submitting work.",
      project: "agency",
      dedup: true,
    });

    expect(first.content_hash).toBeDefined();

    // Second proposal has uppercase characters and extra whitespace/newlines
    const second = propose(store, {
      title: "Another title for same fact",
      content: "RUN   BUN   TEST   and   tsc   before   submitting   work.\n\n",
      project: "agency",
      dedup: true,
      source: "automated_audit",
    });

    // Should consolidate into first canonical entry and reinforce
    expect(second.id).toBe(first.id);
    expect(second.reinforcement).toBeGreaterThan(first.reinforcement ?? 0);

    const all = list(store);
    expect(all.length).toBe(1);

    store.db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("propose preserves distinct content hashes for non-matching texts", () => {
    const dir = mkdtempSync(join(tmpdir(), "content-hash-distinct-"));
    const memoryDir = join(dir, ".memory");
    const store = openStore(memoryDir);

    const e1 = propose(store, { content: "Alpha invariant rule", project: "test" });
    const e2 = propose(store, { content: "Beta invariant rule", project: "test" });

    expect(e1.content_hash).not.toBe(e2.content_hash);
    expect(list(store).length).toBe(2);

    store.db?.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
