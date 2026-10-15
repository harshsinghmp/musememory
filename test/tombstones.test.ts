import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempRoot, cleanup } from "./helpers.ts";
import {
  openStore,
  propose,
  list,
  get,
  fileForId,
  deleteEntry,
  restoreEntry,
  replayFromAudit,
  searchMemories,
} from "../src/store.ts";
import { getAuditTrail } from "../src/audit.ts";
import { queryContext } from "../src/retrieval.ts";
import { hybridSearch } from "../src/vector.ts";
import type { MemoryEntry } from "../src/types.ts";

function newStore(): { root: string; memoryDir: string; store: ReturnType<typeof openStore> } {
  const root = makeTempRoot();
  const memoryDir = join(root, ".memory");
  const store = openStore(memoryDir);
  return { root, memoryDir, store };
}

function seed(store: ReturnType<typeof openStore>, title: string): MemoryEntry {
  return propose(store, {
    title,
    content: `${title}: tombstone subject matter for delete/restore coverage`,
    project: "tombstones",
    type: "architecture",
    tags: ["tombstone", "coverage"],
    confirmed: true,
  });
}

describe("T-030 tombstones: soft delete, never hard delete", () => {
  test("deleted row stays on disk and in SQLite, but list/get/recall/hybrid all exclude it", () => {
    const { root, store } = newStore();
    const kept = seed(store, "Kept entry");
    const doomed = seed(store, "Doomed entry");

    expect(deleteEntry(store, doomed.id, "no longer true", "cli_user")).toBe(true);

    // Soft, not hard: the row, its YAML mirror and its audit event all survive.
    const row = store.db
      ?.query<{ deleted_at: string | null; deleted_by: string | null }>(
        `SELECT deleted_at, deleted_by FROM memories WHERE id = ?`,
      )
      .get([doomed.id]);
    expect(row?.deleted_at).toBeTruthy();
    expect(row?.deleted_by).toBe("cli_user");
    expect(existsSync(fileForId(store, doomed.id))).toBe(true);
    expect(getAuditTrail(store.memoryDir!, { entryId: doomed.id })[0]?.operation).toBe("delete");

    // Every read path hides it.
    expect(list(store).map((e) => e.id)).toEqual([kept.id]);
    expect(get(store, doomed.id)).toBeNull();
    expect(searchHits(store, "doomed")).toEqual([]);
    expect(queryContext(store, "tombstone subject matter", {}).results.map((r) => r.entry.id)).not.toContain(
      doomed.id,
    );
    expect(hybridSearch(store, store.memoryDir!, "tombstone") ?? []).not.toContainEqual(
      expect.objectContaining({ entry: expect.objectContaining({ id: doomed.id }) }),
    );

    cleanup(root);
  });

  test("tombstoned entry is dropped from FTS so no read path can leak its text", () => {
    const { root, store } = newStore();
    const entry = seed(store, "Indexed secret text");
    deleteEntry(store, entry.id);

    const indexed = store.db
      ?.query<{ c: number }>(`SELECT count(*) AS c FROM memories_fts WHERE id = ?`)
      .get([entry.id]);
    expect(indexed?.c).toBe(0);

    cleanup(root);
  });

  test("re-opening the store keeps the tombstone (marker is durable, not cache state)", () => {
    const { root, memoryDir, store } = newStore();
    const entry = seed(store, "Durable tombstone");
    deleteEntry(store, entry.id, "gone", "agent");

    const reopened = openStore(memoryDir);
    expect(list(reopened).map((e) => e.id)).not.toContain(entry.id);
    expect(get(reopened, entry.id)).toBeNull();
    expect(restoreEntry(reopened, entry.id).ok).toBe(true);

    cleanup(root);
  });
});

describe("T-031 restore", () => {
  test("delete-then-restore roundtrips the entry back into every read path", () => {
    const { root, store } = newStore();
    const entry = seed(store, "Roundtrip entry");
    const before = get(store, entry.id)!;

    expect(deleteEntry(store, entry.id, "oops", "cli_user")).toBe(true);
    expect(get(store, entry.id)).toBeNull();

    const out = restoreEntry(store, entry.id, "cli_user");
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected restore to succeed");

    expect(out.entry.content).toBe(before.content);
    expect(out.entry.title).toBe(before.title);
    expect(out.entry.tags).toEqual(before.tags);
    expect(get(store, entry.id)?.content).toBe(before.content);
    expect(list(store).map((e) => e.id)).toContain(entry.id);
    expect(searchHits(store, "roundtrip").map((h) => h.id)).toContain(entry.id);

    // The marker is cleared, not merely bypassed.
    const row = store.db?.query<{ deleted_at: string | null }>(`SELECT deleted_at FROM memories WHERE id = ?`).get([
      entry.id,
    ]);
    expect(row?.deleted_at).toBeNull();

    // A second delete/restore cycle still works (no sticky state).
    expect(deleteEntry(store, entry.id, "again", "cli_user")).toBe(true);
    expect(restoreEntry(store, entry.id).ok).toBe(true);

    cleanup(root);
  });

  test("restore of an unknown id fails cleanly as not_found", () => {
    const { root, store } = newStore();
    expect(restoreEntry(store, "m_0000000000000_missing")).toEqual({ ok: false, reason: "not_found" });
    cleanup(root);
  });

  test("restore of a live (never deleted) entry fails cleanly as not_deleted", () => {
    const { root, store } = newStore();
    const entry = seed(store, "Still live");
    expect(restoreEntry(store, entry.id)).toEqual({ ok: false, reason: "not_deleted" });
    expect(get(store, entry.id)).not.toBeNull();
    cleanup(root);
  });

  test("restore of an already-restored entry reports not_deleted instead of resurrecting twice", () => {
    const { root, store } = newStore();
    const entry = seed(store, "Restored once");
    deleteEntry(store, entry.id);
    expect(restoreEntry(store, entry.id).ok).toBe(true);
    expect(restoreEntry(store, entry.id)).toEqual({ ok: false, reason: "not_deleted" });
    cleanup(root);
  });
});

describe("T-032 audit replay restore", () => {
  test("rebuilds content from audit.jsonl after the row and YAML are gone", () => {
    const { root, memoryDir, store } = newStore();
    const entry = seed(store, "Replayable entry");
    deleteEntry(store, entry.id, "purged by retention", "agent");

    // Total data loss: neither primary row nor YAML mirror survives.
    store.db?.run(`DELETE FROM memories WHERE id = ?`, [entry.id]);
    store.db?.run(`DELETE FROM memories_fts WHERE id = ?`, [entry.id]);
    Bun.spawnSync({ cmd: ["rm", "-f", fileForId(store, entry.id)] });

    const dry = replayFromAudit(store, entry.id);
    expect(dry.ok).toBe(true);
    if (!dry.ok || !dry.entry) throw new Error("expected a rebuilt entry");
    expect(dry.entry.id).toBe(entry.id);
    expect(dry.entry.content).toBe(entry.content);
    expect(dry.entry.title).toBe(entry.title);
    expect(dry.entry.project).toBe(entry.project);
    expect(dry.entry.tags).toEqual(entry.tags);
    // Reported, not invented.
    expect(dry.missing.length).toBeGreaterThan(0);
    expect(dry.reconstructed).toContain("content");
    // Dry run by default: nothing written.
    expect(get(store, entry.id)).toBeNull();

    const applied = replayFromAudit(store, entry.id, { apply: true });
    expect(applied.ok).toBe(true);
    expect(get(store, entry.id)?.content).toBe(entry.content);
    expect(list(store).map((e) => e.id)).toContain(entry.id);
    expect(searchHits(store, "replayable").map((h) => h.id)).toContain(entry.id);

    const ledger = readFileSync(join(memoryDir, "audit.jsonl"), "utf8");
    expect(ledger).toContain(entry.id);
    cleanup(root);
  });

  test("replay reports why it cannot rebuild instead of fabricating content", () => {
    const { root, store } = newStore();
    const neverExisted = replayFromAudit(store, "m_0000000000000_absent");
    expect(neverExisted.ok).toBe(false);
    expect(neverExisted.entry).toBeNull();
    expect(neverExisted.reason).toBeTruthy();
    cleanup(root);
  });

  test("replay of a pre-tombstone hard delete reports the gap instead of inventing content", () => {
    const { root, store } = newStore();
    const entry = seed(store, "Legacy hard deleted");
    // A build from before tombstones: the row and YAML are gone and no snapshot was written.
    store.db?.run(`DELETE FROM memories WHERE id = ?`, [entry.id]);
    store.db?.run(`DELETE FROM memories_fts WHERE id = ?`, [entry.id]);
    Bun.spawnSync({ cmd: ["rm", "-f", fileForId(store, entry.id)] });
    store.cache?.deleteEntry(entry.id);

    const report = replayFromAudit(store, entry.id);
    expect(report.ok).toBe(false);
    expect(report.entry).toBeNull();
    expect(report.reason).toContain("no content snapshot");
    expect(replayFromAudit(store, entry.id, { apply: true }).ok).toBe(false);
    expect(get(store, entry.id)).toBeNull();
    cleanup(root);
  });
});

/** Store-level FTS hits for a term that appears in every seeded entry's title/content. */
function searchHits(store: ReturnType<typeof openStore>, term: string): { id: string }[] {
  return searchMemories(store, term).map((r) => ({ id: r.entry.id }));
}