import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, propose, list, IdempotencyConflictError } from "../src/store.ts";

describe("T-038 & T-039: idempotency keys on memory capture", () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "idempotency-test-"));
    const memoryDir = join(dir, ".memory");
    const store = openStore(memoryDir);
    return { dir, store };
  }

  test("propose with idempotency_key stores key and returns new entry", () => {
    const { dir, store } = setup();
    const entry = propose(store, {
      content: "Ensure SQLite indexes are always checked via PRAGMA before create.",
      project: "musememory",
      title: "Pragma table_info guard",
      idempotency_key: "idem_turn_101",
    });

    expect(entry.idempotency_key).toBe("idem_turn_101");
    expect(entry.content_hash).toBeDefined();

    const listed = list(store);
    expect(listed.length).toBe(1);
    expect(listed[0].idempotency_key).toBe("idem_turn_101");

    store.db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("idempotent retry with identical content returns existing entry without duplicate write (0 writes)", () => {
    const { dir, store } = setup();
    const original = propose(store, {
      content: "Ensure SQLite indexes are always checked via PRAGMA before create.",
      project: "musememory",
      title: "Pragma table_info guard",
      idempotency_key: "idem_retry_same",
    });

    // Replay proposal with exact same idempotency_key and same content
    const replayed = propose(store, {
      content: "Ensure SQLite indexes are always checked via PRAGMA before create.",
      project: "musememory",
      title: "Different title candidate",
      idempotency_key: "idem_retry_same",
    });

    expect(replayed.id).toBe(original.id);
    expect(replayed.created_at).toBe(original.created_at);

    // Exactly one entry exists in store
    const all = list(store);
    expect(all.length).toBe(1);
    expect(all[0].id).toBe(original.id);

    store.db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("divergent retry with conflicting content throws IdempotencyConflictError naming existing id", () => {
    const { dir, store } = setup();
    const original = propose(store, {
      content: "Version 1 content: SQLite WAL mode is enabled by default.",
      project: "musememory",
      title: "WAL mode setting",
      idempotency_key: "idem_conflict_test",
    });

    let threw = false;
    try {
      // Divergent content under same idempotency_key
      propose(store, {
        content: "Version 2 content: Completely different assertion.",
        project: "musememory",
        title: "Divergent assertion",
        idempotency_key: "idem_conflict_test",
      });
    } catch (err: any) {
      threw = true;
      expect(err).toBeInstanceOf(IdempotencyConflictError);
      expect(err.idempotencyKey).toBe("idem_conflict_test");
      expect(err.existingEntryId).toBe(original.id);
      expect(err.message).toContain(original.id);
    }

    expect(threw).toBe(true);

    store.db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("null or omitted idempotency_keys do not collide", () => {
    const { dir, store } = setup();
    const e1 = propose(store, { content: "First entry", project: "test" });
    const e2 = propose(store, { content: "Second entry", project: "test" });

    expect(e1.id).not.toBe(e2.id);
    expect(list(store).length).toBe(2);

    store.db?.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
