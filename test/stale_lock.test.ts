import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../src/sqlite.ts";
import { runMigrations } from "../src/migrate.ts";
import { enqueueOutbox, claimOutboxBatch, recoverStaleLocks, getOutboxEntry } from "../src/outbox.ts";
import { openStore } from "../src/store.ts";

describe("T-042: stale lock recovery sweep", () => {
  function setupTestDb() {
    const dir = mkdtempSync(join(tmpdir(), "stale-lock-test-"));
    const dbPath = join(dir, "test.db");
    const db = openDatabase(dbPath);
    runMigrations(db);
    return { dir, db };
  }

  test("recovers locks older than 300 seconds reverting auto_replay entries to pending", () => {
    const { dir, db } = setupTestDb();
    const entry = enqueueOutbox(db, { entry_id: "m_crashed", operation: "save", payload: {}, auto_replay: true });
    claimOutboxBatch(db, 1);

    // Simulate worker crash 400 seconds ago
    const staleTime = new Date(Date.now() - 400 * 1000).toISOString();
    db.run(`UPDATE outbox SET locked_at = ? WHERE id = ?`, [staleTime, entry.id]);

    const result = recoverStaleLocks(db, 300);
    expect(result.recovered).toBe(1);
    expect(result.held).toBe(0);

    const recovered = getOutboxEntry(db, entry.id);
    expect(recovered?.status).toBe("pending");
    expect(recovered?.locked_at).toBeNull();
    expect(recovered?.error).toContain("lock expired");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("transitions non-idempotent entries (auto_replay=false) to held on stale lock expiration", () => {
    const { dir, db } = setupTestDb();
    const entry = enqueueOutbox(db, { entry_id: "m_non_idempotent", operation: "delete", payload: {}, auto_replay: false });
    claimOutboxBatch(db, 1);

    // Simulate worker crash 500 seconds ago
    const staleTime = new Date(Date.now() - 500 * 1000).toISOString();
    db.run(`UPDATE outbox SET locked_at = ? WHERE id = ?`, [staleTime, entry.id]);

    const result = recoverStaleLocks(db, 300);
    expect(result.recovered).toBe(0);
    expect(result.held).toBe(1);

    const heldEntry = getOutboxEntry(db, entry.id);
    expect(heldEntry?.status).toBe("held");
    expect(heldEntry?.locked_at).toBeNull();
    expect(heldEntry?.error).toContain("non-idempotent");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("leaves fresh locks untouched", () => {
    const { dir, db } = setupTestDb();
    const entry = enqueueOutbox(db, { entry_id: "m_active", operation: "save", payload: {} });
    claimOutboxBatch(db, 1); // locked right now

    const result = recoverStaleLocks(db, 300);
    expect(result.recovered).toBe(0);
    expect(result.held).toBe(0);

    const current = getOutboxEntry(db, entry.id);
    expect(current?.status).toBe("processing");
    expect(current?.locked_at).not.toBeNull();

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("openStore automatically executes stale lock recovery sweep", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-store-stale-"));
    const memoryDir = join(dir, ".memory");
    const dbPath = join(memoryDir, "memory.db");
    const db = openDatabase(dbPath);
    runMigrations(db);

    const entry = enqueueOutbox(db, { entry_id: "m_stale_on_open", operation: "save", payload: {}, auto_replay: true });
    claimOutboxBatch(db, 1);

    // Stale timestamp 600s ago
    const staleTime = new Date(Date.now() - 600 * 1000).toISOString();
    db.run(`UPDATE outbox SET locked_at = ? WHERE id = ?`, [staleTime, entry.id]);
    db.close();

    // Opening store via openStore() should automatically recover stale locks
    const store = openStore(memoryDir);
    const recovered = getOutboxEntry(store.db!, entry.id);
    expect(recovered?.status).toBe("pending");
    expect(recovered?.locked_at).toBeNull();

    store.db?.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
