import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, save, deleteEntry, list, countMemories } from "../src/store.ts";

// Reproductions for audit findings F4 and F5 (issues #406, #407). Both live in
// list()'s YAML reconciliation loop.

function seed(store: ReturnType<typeof openStore>, id: string, project: string, now: string) {
  save(store, {
    id,
    title: `memory ${id}`,
    content: `content for ${id}`,
    project,
    status: "confirmed",
    created_at: now,
    updated_at: now,
  } as any);
}

describe("audit F4: list() must not resurrect a tombstoned memory", () => {
  test("an erased memory does not come back from list()", () => {
    const dir = mkdtempSync(join(tmpdir(), "f4-"));
    try {
      const store = openStore(dir);
      const now = new Date().toISOString();
      // An id the migrator adapters legitimately produce: mixed case means
      // slugifyId(id) != id, so the file name and the id diverge.
      const id = "m_ABC123_Imported";
      seed(store, id, "p", now);
      deleteEntry(store, id, "gdpr erasure");

      const rows = list(store);
      const resurrected = rows.filter((e) => e.id === id && !(e as any).deleted_at);
      expect(resurrected).toEqual([]);
      expect(rows.map((e) => e.id)).not.toContain(id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("list() returns each id at most once and agrees with countMemories()", () => {
    const dir = mkdtempSync(join(tmpdir(), "f4b-"));
    try {
      const store = openStore(dir);
      const now = new Date().toISOString();
      seed(store, "m_ABC123_Imported", "p", now);
      const rows = list(store);
      expect(new Set(rows.map((e) => e.id)).size).toBe(rows.length);
      expect(rows.length).toBe(countMemories(store));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("audit F5: list() must not write on a read", () => {
  test("a filtered list leaves access_count untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "f5-"));
    try {
      const store = openStore(dir);
      const now = new Date().toISOString();
      for (let i = 0; i < 10; i++) seed(store, `m_${i}`, i < 3 ? "A" : "B", now);

      const before = store.db!.query("SELECT id, access_count FROM memories ORDER BY id").all() as any[];
      const changesBefore = (store.db!.query("SELECT total_changes() AS c").get() as any).c;

      list(store, { project: "A" });

      const changesAfter = (store.db!.query("SELECT total_changes() AS c").get() as any).c;
      const after = store.db!.query("SELECT id, access_count FROM memories ORDER BY id").all() as any[];

      // The counters must be identical: nothing was retrieved.
      expect(after.map((r) => r.access_count)).toEqual(before.map((r) => r.access_count));
      // And the read should not have issued a storm of writes.
      expect(changesAfter - changesBefore).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
