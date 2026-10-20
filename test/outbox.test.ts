import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../src/sqlite.ts";
import { runMigrations } from "../src/migrate.ts";
import {
  enqueueOutbox,
  claimOutboxBatch,
  markOutboxSent,
  markOutboxHeld,
  markOutboxFailed,
  getOutboxEntry,
  listOutbox,
  processOutbox,
} from "../src/outbox.ts";

describe("T-041: write outbox state machine", () => {
  function setupTestDb() {
    const dir = mkdtempSync(join(tmpdir(), "outbox-test-"));
    const dbPath = join(dir, "test.db");
    const db = openDatabase(dbPath);
    runMigrations(db);
    return { dir, db };
  }

  test("enqueues entries with pending status and records metadata", () => {
    const { dir, db } = setupTestDb();
    const entry = enqueueOutbox(db, {
      entry_id: "m_1_test",
      operation: "capture",
      payload: { title: "Test Memory", content: "Important detail" },
      idempotency_key: "idem_123",
      auto_replay: true,
    });

    expect(entry.id).toStartWith("ob_");
    expect(entry.status).toBe("pending");
    expect(entry.entry_id).toBe("m_1_test");
    expect(entry.operation).toBe("capture");
    expect(entry.attempts).toBe(0);
    expect(entry.auto_replay).toBe(true);

    const fetched = getOutboxEntry(db, entry.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.idempotency_key).toBe("idem_123");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("claimOutboxBatch transitions pending entries to processing and sets lock", () => {
    const { dir, db } = setupTestDb();
    enqueueOutbox(db, { entry_id: "m_1", operation: "save", payload: { n: 1 } });
    enqueueOutbox(db, { entry_id: "m_2", operation: "save", payload: { n: 2 } });
    enqueueOutbox(db, { entry_id: "m_3", operation: "save", payload: { n: 3 } });

    const claimed = claimOutboxBatch(db, 2);
    expect(claimed.length).toBe(2);
    expect(claimed[0].status).toBe("processing");
    expect(claimed[0].attempts).toBe(1);
    expect(claimed[0].locked_at).toBeDefined();

    const remainingPending = listOutbox(db, { status: "pending" });
    expect(remainingPending.length).toBe(1);
    expect(remainingPending[0].entry_id).toBe("m_3");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("markOutboxSent transitions entry to terminal sent state", () => {
    const { dir, db } = setupTestDb();
    const entry = enqueueOutbox(db, { entry_id: "m_1", operation: "save", payload: {} });
    const claimed = claimOutboxBatch(db, 1);

    markOutboxSent(db, claimed[0].id);

    const updated = getOutboxEntry(db, entry.id);
    expect(updated?.status).toBe("sent");
    expect(updated?.locked_at).toBeNull();

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("markOutboxHeld transitions entry to held state", () => {
    const { dir, db } = setupTestDb();
    const entry = enqueueOutbox(db, { entry_id: "m_1", operation: "save", payload: {} });
    const claimed = claimOutboxBatch(db, 1);

    markOutboxHeld(db, claimed[0].id, "Manual inspection required");

    const updated = getOutboxEntry(db, entry.id);
    expect(updated?.status).toBe("held");
    expect(updated?.error).toBe("Manual inspection required");
    expect(updated?.locked_at).toBeNull();

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("markOutboxFailed reverts to pending for auto_replay=true, held for auto_replay=false, failed at limit", () => {
    const { dir, db } = setupTestDb();
    // 1. auto_replay = true: reverts to pending before max attempts
    const autoEntry = enqueueOutbox(db, { entry_id: "m_auto", operation: "save", payload: {}, auto_replay: true });
    claimOutboxBatch(db, 1);
    markOutboxFailed(db, autoEntry.id, "Network timeout", 3);
    expect(getOutboxEntry(db, autoEntry.id)?.status).toBe("pending");

    // 2. auto_replay = false (non-idempotent): goes directly to held (T-043)
    const nonAuto = enqueueOutbox(db, { entry_id: "m_non_auto", operation: "delete", payload: {}, auto_replay: false });
    claimOutboxBatch(db, 2);
    markOutboxFailed(db, nonAuto.id, "Conflict", 3);
    expect(getOutboxEntry(db, nonAuto.id)?.status).toBe("held");

    // 3. Max attempts exceeded: transitions to failed
    claimOutboxBatch(db, 1); // attempt 2
    markOutboxFailed(db, autoEntry.id, "Network timeout 2", 3);
    claimOutboxBatch(db, 1); // attempt 3
    markOutboxFailed(db, autoEntry.id, "Network timeout 3 (exhausted)", 3);
    expect(getOutboxEntry(db, autoEntry.id)?.status).toBe("failed");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("processOutbox processes batch with handler and updates terminal states", async () => {
    const { dir, db } = setupTestDb();
    enqueueOutbox(db, { entry_id: "m_ok", operation: "save", payload: { shouldPass: true } });
    enqueueOutbox(db, { entry_id: "m_fail", operation: "save", payload: { shouldPass: false } });

    const result = await processOutbox(db, async (entry) => {
      const data = JSON.parse(entry.payload);
      if (!data.shouldPass) throw new Error("Processing failed");
      return true;
    });

    expect(result.processed).toBe(2);
    expect(result.sent).toBe(1);

    const okEntry = listOutbox(db, { status: "sent" });
    expect(okEntry.length).toBe(1);
    expect(okEntry[0].entry_id).toBe("m_ok");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
