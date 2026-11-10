import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.ts";
import {
  mergeObservations,
  recordObservation,
  listObservations,
  observationsFilePath,
} from "../src/learning/observation.ts";
import type { ObservationEntry } from "../src/types.ts";

function obs(id: string, raw = `observation ${id}`): ObservationEntry {
  return {
    id,
    timestamp: new Date().toISOString(),
    source: "tool",
    project: "p",
    raw,
    processed: false,
  };
}

describe("R31: append-only observation merge", () => {
  test("appends new observations and skips ones already present", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-obs-merge-"));
    try {
      const store = openStore(memoryDir);
      recordObservation(store, { source: "tool", project: "p", raw: "existing" });
      const existingId = listObservations(store)[0].id;

      const result = mergeObservations(store, [obs("a"), obs("b"), obs(existingId)]);

      expect(result.appended).toEqual(["a", "b"]);
      expect(result.skipped).toBe(1);
      expect(listObservations(store).map((o) => o.id).sort()).toEqual([existingId, "a", "b"].sort());
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  test("is idempotent: re-merging the same batch appends nothing", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-obs-idem-"));
    try {
      const store = openStore(memoryDir);
      const batch = [obs("x"), obs("y")];

      const first = mergeObservations(store, batch);
      expect(first.appended).toHaveLength(2);

      const second = mergeObservations(store, batch);
      expect(second.appended).toEqual([]);
      expect(second.skipped).toBe(2);
      // The ledger did not grow a second copy.
      expect(listObservations(store)).toHaveLength(2);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  test("never rewrites an existing observation", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-obs-immut-"));
    try {
      const store = openStore(memoryDir);
      recordObservation(store, { source: "tool", project: "p", raw: "original content" });
      const original = listObservations(store)[0];

      // Same id, different payload — the merge must not overwrite it.
      mergeObservations(store, [{ ...obs(original.id, "MUTATED"), project: "other" }]);

      const after = listObservations(store);
      expect(after).toHaveLength(1);
      expect(after[0].raw).toBe("original content");
      expect(after[0].project).toBe("p");
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  test("rejects malformed records rather than corrupting the ledger", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-obs-bad-"));
    try {
      const store = openStore(memoryDir);
      const result = mergeObservations(store, [
        { id: "", raw: "no id" } as ObservationEntry,
        { id: "blank", raw: "   " } as ObservationEntry,
        { id: "good", raw: "fine" } as ObservationEntry,
      ]);

      expect(result.appended).toEqual(["good"]);
      expect(result.skipped).toBe(2);
      // Every line in the file still parses.
      const lines = listObservations(store);
      expect(lines).toHaveLength(1);
      expect(lines[0].id).toBe("good");
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  test("concurrent processes all land their observations", async () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-obs-proc-"));
    const store = openStore(memoryDir);
    try {
      // Honest scope: each process writes a distinct id, so this proves the
      // merge is safe under real multi-process load and leaves no torn lines.
      // It does NOT prove the lock is required — appends of distinct ids
      // cannot lose data without it. The lock covers the narrower window
      // where two writers interleave inside a single line.
      const script = `import { openStore } from ${JSON.stringify(join(import.meta.dir, "..", "src", "store.ts"))};
import { mergeObservations } from ${JSON.stringify(join(import.meta.dir, "..", "src", "learning", "observation.ts"))};
const store = openStore(process.argv[1]);
mergeObservations(store, [{ id: process.argv[2], timestamp: new Date().toISOString(), source: "tool", project: "p", raw: "x", processed: false }]);`;

      const writers = 5;
      const procs = Array.from({ length: writers }, (_, i) =>
        Bun.spawn(["bun", "-e", script, memoryDir, `proc_${i}`], { stdout: "pipe", stderr: "pipe" }),
      );
      const codes = await Promise.all(procs.map((p) => p.exited));
      expect(codes.every((c) => c === 0)).toBe(true);

      const ids = listObservations(store).map((o) => o.id);
      expect(new Set(ids).size).toBe(writers);
      // No torn lines: every parsed entry has its required fields.
      for (const entry of listObservations(store)) {
        expect(typeof entry.id).toBe("string");
        expect(typeof entry.raw).toBe("string");
        expect(entry.processed).toBe(false);
      }
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  }, 30000);

  test("an empty batch is a no-op and does not create the file", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-obs-empty-"));
    try {
      const store = openStore(memoryDir);
      const result = mergeObservations(store, []);
      expect(result.appended).toEqual([]);
      expect(result.skipped).toBe(0);
      expect(existsSync(observationsFilePath(memoryDir))).toBe(false);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });
});
