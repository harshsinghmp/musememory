import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { openStore, save, closeStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import type { MemoryEntry } from "../src/types.ts";
import {
  SessionReinjectionTracker,
  defaultReinjectionTracker,
} from "../src/retrieval/suppression.ts";
import { resolveMuseContext } from "../src/orchestrator/context.ts";

describe("T-108: Re-injection suppression per session (6-turn LRU)", () => {
  let tracker: SessionReinjectionTracker;

  beforeEach(() => {
    tracker = new SessionReinjectionTracker(6);
    defaultReinjectionTracker.clearAll();
  });

  it("suppresses recently injected memory within 6-turn window and expires at turn 7", () => {
    const sessionId = "session_test_1";

    // Turn 1: inject mem_1
    tracker.recordInjected(sessionId, ["mem_1"], 1);

    // Turn 1 through 6: should be suppressed
    for (let t = 1; t <= 6; t++) {
      const res = tracker.isSuppressed(sessionId, "mem_1", t);
      expect(res.suppressed).toBe(true);
      expect(res.turnsAgo).toBe(t - 1);
    }

    // Turn 7: exactly 6 turns ago -> expired!
    const res7 = tracker.isSuppressed(sessionId, "mem_1", 7);
    expect(res7.suppressed).toBe(false);
    expect(res7.turnsAgo).toBe(6);
  });

  it("exempts constraints and timeless entries from suppression", () => {
    const sessionId = "session_test_2";
    tracker.recordInjected(sessionId, ["rule_constraint", "rule_timeless", "normal_fact"], 1);

    const entries: MemoryEntry[] = [
      {
        id: "rule_constraint",
        title: "Architecture rule",
        content: "Always use WAL mode",
        type: "constraint",
        project: "test-proj",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "rule_timeless",
        title: "Database invariant",
        content: "Idempotent migrations",
        type: "decision",
        temporal_mode: "timeless",
        project: "test-proj",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "normal_fact",
        title: "Standard fact",
        content: "Port number is 3000",
        type: "decision",
        project: "test-proj",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const result = tracker.filterSuppressed(sessionId, entries, { turn: 2 });
    expect(result.allowed.length).toBe(2);
    expect(result.allowed.map((e) => e.id)).toEqual(["rule_constraint", "rule_timeless"]);
    expect(result.suppressed.length).toBe(1);
    expect(result.suppressed[0].item.id).toBe("normal_fact");
    expect(result.suppressed[0].turnsAgo).toBe(1);
  });

  it("isolates suppression state across different sessions", () => {
    tracker.recordInjected("session_A", ["shared_mem_1"], 1);

    // Suppressed in session_A
    expect(tracker.isSuppressed("session_A", "shared_mem_1", 2).suppressed).toBe(true);

    // NOT suppressed in session_B
    expect(tracker.isSuppressed("session_B", "shared_mem_1", 2).suppressed).toBe(false);
  });

  describe("resolveMuseContext integration", () => {
    let tmpDir: string;
    let store: Store;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-reinjection-test-"));
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

    it("suppresses previously injected memory on subsequent turn in resolveMuseContext", async () => {
      const entryA: MemoryEntry = {
        id: "mem_auth_flow",
        title: "OAuth Token Refresh Pattern",
        content: "Refresh token rotation must use atomic database transaction",
        project: "auth-service",
        type: "decision",
        status: "confirmed",
        salience: 1.0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const entryB: MemoryEntry = {
        id: "mem_crypto_salt",
        title: "Daily Audit Salt Security",
        content: "Store audit salts per calendar day in audit_salts.json",
        project: "auth-service",
        type: "decision",
        status: "confirmed",
        salience: 0.9,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      save(store, entryA);
      save(store, entryB);

      const sessionId = "agent_session_42";

      // Turn 1: query matches OAuth
      const turn1 = await resolveMuseContext(store, tmpDir, {
        query: "OAuth Token Refresh",
        session_id: sessionId,
        turn: 1,
      });

      expect(turn1.relevant_memories.some((m) => m.id === "mem_auth_flow")).toBe(true);

      // Turn 2: same query in same session -> mem_auth_flow should be withheld by re-injection suppression!
      const turn2 = await resolveMuseContext(store, tmpDir, {
        query: "OAuth Token Refresh",
        session_id: sessionId,
        turn: 2,
      });

      expect(turn2.relevant_memories.some((m) => m.id === "mem_auth_flow")).toBe(false);
      expect(turn2.reinjection_suppressed_count).toBeGreaterThanOrEqual(1);
      const withheld = turn2.withheld_memories?.find((w) => w.id === "mem_auth_flow");
      expect(withheld).toBeDefined();
      expect(withheld?.reason).toContain("reinjection_suppressed");

      // Bypassing suppression with suppress_reinjected: false returns it
      const turn2Bypass = await resolveMuseContext(store, tmpDir, {
        query: "OAuth Token Refresh",
        session_id: sessionId,
        turn: 2,
        suppress_reinjected: false,
      });
      expect(turn2Bypass.relevant_memories.some((m) => m.id === "mem_auth_flow")).toBe(true);
    });
  });
});
