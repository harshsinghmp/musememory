import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { openStore, save, get, closeStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import type { MemoryEntry } from "../src/types.ts";
import {
  stagePendingPromotion,
  listPendingPromotions,
  cancelPendingPromotion,
  flushPendingPromotions,
  loadPendingPromotions,
} from "../src/promotion/pending.ts";

describe("T-107: Two-tier promotion (pending tier -> session-end flush)", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-two-tier-test-"));
    const memoryDir = path.join(tmpDir, ".memory");
    fs.mkdirSync(memoryDir, { recursive: true });
    store = openStore(memoryDir);
  });

  afterEach(() => {
    try {
      closeStore(store);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("stages a memory entry in pending tier without immediately mutating memory entry", () => {
    const entry: MemoryEntry = {
      id: "mem_local_1",
      title: "Local candidate fix",
      content: "Ensure database handles WAL journal mode properly",
      project: "test-proj",
      type: "decision",
      status: "candidate",
      scope: "local",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    save(store, entry);

    const staged = stagePendingPromotion(store, "mem_local_1", {
      reason: "Verified during turn 3",
      actor: "curator-agent",
      sessionId: "session_abc_1",
    });

    expect(staged.id).toBeDefined();
    expect(staged.memory_id).toBe("mem_local_1");
    expect(staged.status).toBe("pending");
    expect(staged.current_scope).toBe("local");
    expect(staged.target_scope).toBe("project");
    expect(staged.session_id).toBe("session_abc_1");

    // The entry itself in the store should NOT be changed yet (still candidate / local)
    const stored = get(store, "mem_local_1");
    expect(stored?.scope).toBe("local");
    expect(stored?.status).toBe("candidate");

    // Verify it is persisted in pending_promotions.json
    const persisted = loadPendingPromotions(store.memoryDir!);
    expect(persisted.length).toBe(1);
    expect(persisted[0].id).toBe(staged.id);
  });

  it("lists pending promotions with session and status filtering", () => {
    const entry1: MemoryEntry = {
      id: "mem_sess1",
      title: "Session 1 memory",
      content: "Content 1",
      project: "test-proj",
      type: "decision",
      status: "candidate",
      scope: "local",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const entry2: MemoryEntry = {
      id: "mem_sess2",
      title: "Session 2 memory",
      content: "Content 2",
      project: "test-proj",
      type: "discovery",
      status: "candidate",
      scope: "local",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    save(store, entry1);
    save(store, entry2);

    stagePendingPromotion(store, "mem_sess1", { sessionId: "sess-1" });
    stagePendingPromotion(store, "mem_sess2", { sessionId: "sess-2" });

    const allPending = listPendingPromotions(store);
    expect(allPending.length).toBe(2);

    const sess1Only = listPendingPromotions(store, { sessionId: "sess-1" });
    expect(sess1Only.length).toBe(1);
    expect(sess1Only[0].memory_id).toBe("mem_sess1");

    const sess2Only = listPendingPromotions(store, { sessionId: "sess-2" });
    expect(sess2Only.length).toBe(1);
    expect(sess2Only[0].memory_id).toBe("mem_sess2");
  });

  it("cancels a staged pending promotion", () => {
    const entry: MemoryEntry = {
      id: "mem_cancel_1",
      title: "Cancelled candidate",
      content: "Content to cancel",
      project: "test-proj",
      type: "fix",
      status: "candidate",
      scope: "local",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    save(store, entry);

    const staged = stagePendingPromotion(store, "mem_cancel_1");
    expect(staged.status).toBe("pending");

    const cancelled = cancelPendingPromotion(store, staged.id, "User requested cancellation");
    expect(cancelled).toBe(true);

    const activePending = listPendingPromotions(store, { status: "pending" });
    expect(activePending.length).toBe(0);

    const allRecords = listPendingPromotions(store);
    expect(allRecords.length).toBe(1);
    expect(allRecords[0].status).toBe("cancelled");
  });

  it("dry-run evaluates without applying promotions", () => {
    const entry: MemoryEntry = {
      id: "mem_dry_1",
      title: "Confirmed memory",
      content: "Reliable database query",
      project: "test-proj",
      type: "architecture",
      status: "confirmed",
      scope: "local",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    save(store, entry);

    stagePendingPromotion(store, "mem_dry_1");

    const dryResult = flushPendingPromotions(store, { dryRun: true });
    expect(dryResult.total_staged).toBe(1);
    expect(dryResult.promoted_count).toBe(1);
    expect(dryResult.rejected_count).toBe(0);
    expect(dryResult.results[0].promoted).toBe(true);

    // Should remain in pending status because dryRun was true
    const activePending = listPendingPromotions(store, { status: "pending" });
    expect(activePending.length).toBe(1);

    // Stored entry should NOT be promoted yet
    const stored = get(store, "mem_dry_1");
    expect(stored?.scope).toBe("local");
  });

  it("flushes pending promotions and executes promotion for qualifying entries", () => {
    // 1. Qualified candidate (status: confirmed)
    const entry1: MemoryEntry = {
      id: "mem_qual_1",
      title: "Qualified candidate",
      content: "Valid architecture pattern",
      project: "test-proj",
      type: "architecture",
      status: "confirmed",
      scope: "local",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 2. Unverified candidate (unconfirmed, unverified -> will be rejected by policy)
    const entry2: MemoryEntry = {
      id: "mem_unqual_2",
      title: "Unverified candidate",
      content: "Unverified idea",
      project: "test-proj",
      type: "architecture",
      status: "candidate",
      scope: "local",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    save(store, entry1);
    save(store, entry2);

    stagePendingPromotion(store, "mem_qual_1", { sessionId: "sess-flush" });
    stagePendingPromotion(store, "mem_unqual_2", { sessionId: "sess-flush" });

    const flushResult = flushPendingPromotions(store, { sessionId: "sess-flush" });
    expect(flushResult.total_staged).toBe(2);
    expect(flushResult.promoted_count).toBe(1);
    expect(flushResult.rejected_count).toBe(1);

    // Verify qualified entry was promoted to project scope
    const stored1 = get(store, "mem_qual_1");
    expect(stored1?.scope).toBe("project");

    // Verify unqualified entry was NOT promoted
    const stored2 = get(store, "mem_unqual_2");
    expect(stored2?.scope).toBe("local");

    // Verify pending queue entries were updated to flushed / rejected
    const active = listPendingPromotions(store, { status: "pending" });
    expect(active.length).toBe(0);

    const all = listPendingPromotions(store);
    const item1 = all.find((x) => x.memory_id === "mem_qual_1");
    const item2 = all.find((x) => x.memory_id === "mem_unqual_2");
    expect(item1?.status).toBe("flushed");
    expect(item1?.flushed_at).toBeDefined();
    expect(item2?.status).toBe("rejected");
  });

  it("preserves session isolation during flush", () => {
    const entry1: MemoryEntry = {
      id: "mem_sess_a",
      title: "Session A entry",
      content: "A content",
      project: "test-proj",
      type: "architecture",
      status: "confirmed",
      scope: "local",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const entry2: MemoryEntry = {
      id: "mem_sess_b",
      title: "Session B entry",
      content: "B content",
      project: "test-proj",
      type: "architecture",
      status: "confirmed",
      scope: "local",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    save(store, entry1);
    save(store, entry2);

    stagePendingPromotion(store, "mem_sess_a", { sessionId: "session-A" });
    stagePendingPromotion(store, "mem_sess_b", { sessionId: "session-B" });

    // Flush only session-A
    const result = flushPendingPromotions(store, { sessionId: "session-A" });
    expect(result.total_staged).toBe(1);
    expect(result.promoted_count).toBe(1);

    // Session A is flushed
    const storedA = get(store, "mem_sess_a");
    expect(storedA?.scope).toBe("project");

    // Session B is still pending and untouched
    const storedB = get(store, "mem_sess_b");
    expect(storedB?.scope).toBe("local");

    const pendingB = listPendingPromotions(store, { status: "pending" });
    expect(pendingB.length).toBe(1);
    expect(pendingB[0].memory_id).toBe("mem_sess_b");
  });
});
