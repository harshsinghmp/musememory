import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { openStore, save, closeStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import type { MemoryEntry } from "../src/types.ts";
import {
  isSelfEcho,
  filterSelfEchoes,
  DEFAULT_ECHO_HORIZON_MS,
} from "../src/retrieval/suppression.ts";
import { resolveMuseContext } from "../src/orchestrator/context.ts";

describe("T-109: Self-echo suppression via capture-side provenance (age-bounded)", () => {
  it("flags freshly captured memory within echo horizon with matching session as self-echo", () => {
    const now = Date.now();
    const entry: MemoryEntry = {
      id: "mem_fresh_1",
      title: "Fresh thought",
      content: "Unverified ephemeral hypothesis",
      project: "test-proj",
      type: "discovery",
      status: "candidate",
      session_id: "session_alpha",
      created_at: new Date(now - 60 * 1000).toISOString(), // 1 min ago
      updated_at: new Date(now - 60 * 1000).toISOString(),
    };

    const check = isSelfEcho(entry, {
      sessionId: "session_alpha",
      now,
      echoHorizonMs: DEFAULT_ECHO_HORIZON_MS,
    });

    expect(check.isEcho).toBe(true);
    expect(check.reason).toContain("self_echo_suppressed");
    expect(check.reason).toContain("active session session_alpha");
  });

  it("does not flag memory older than echo horizon", () => {
    const now = Date.now();
    const entry: MemoryEntry = {
      id: "mem_old_1",
      title: "Older thought",
      content: "Historical thought from earlier",
      project: "test-proj",
      type: "discovery",
      status: "candidate",
      session_id: "session_alpha",
      created_at: new Date(now - 15 * 60 * 1000).toISOString(), // 15 mins ago (> 10m horizon)
      updated_at: new Date(now - 15 * 60 * 1000).toISOString(),
    };

    const check = isSelfEcho(entry, {
      sessionId: "session_alpha",
      now,
      echoHorizonMs: DEFAULT_ECHO_HORIZON_MS,
    });

    expect(check.isEcho).toBe(false);
  });

  it("does not flag memory created by a different session", () => {
    const now = Date.now();
    const entry: MemoryEntry = {
      id: "mem_other_sess",
      title: "Other session knowledge",
      content: "Knowledge from session beta",
      project: "test-proj",
      type: "discovery",
      status: "candidate",
      session_id: "session_beta",
      created_at: new Date(now - 30 * 1000).toISOString(),
      updated_at: new Date(now - 30 * 1000).toISOString(),
    };

    const check = isSelfEcho(entry, {
      sessionId: "session_alpha",
      now,
    });

    expect(check.isEcho).toBe(false);
  });

  it("exempts human/user or authoritative memories from self-echo suppression", () => {
    const now = Date.now();
    const userEntry: MemoryEntry = {
      id: "mem_user_stated",
      title: "User requirement",
      content: "Must support SQLite WAL mode",
      project: "test-proj",
      type: "decision",
      status: "confirmed",
      source: "user",
      session_id: "session_alpha",
      created_at: new Date(now - 30 * 1000).toISOString(),
      updated_at: new Date(now - 30 * 1000).toISOString(),
    };

    const authoritativeEntry: MemoryEntry = {
      id: "mem_auth_verified",
      title: "Verified oracle proof",
      content: "Test suite passes with zero regressions",
      project: "test-proj",
      type: "decision",
      status: "confirmed",
      verification: { level: "authoritative", verified_by: "oracle" },
      session_id: "session_alpha",
      created_at: new Date(now - 30 * 1000).toISOString(),
      updated_at: new Date(now - 30 * 1000).toISOString(),
    };

    expect(isSelfEcho(userEntry, { sessionId: "session_alpha", now }).isEcho).toBe(false);
    expect(isSelfEcho(authoritativeEntry, { sessionId: "session_alpha", now }).isEcho).toBe(false);
  });

  it("filters self-echoes and supports allowSelfEcho override", () => {
    const now = Date.now();
    const echoEntry: MemoryEntry = {
      id: "mem_echo",
      title: "Echo candidate",
      content: "Self echo",
      project: "test-proj",
      type: "discovery",
      status: "confirmed",
      session_id: "sess_x",
      created_at: new Date(now - 60 * 1000).toISOString(),
      updated_at: new Date(now - 60 * 1000).toISOString(),
    };
    const validEntry: MemoryEntry = {
      id: "mem_valid",
      title: "Established knowledge",
      content: "Solid knowledge",
      project: "test-proj",
      type: "discovery",
      status: "confirmed",
      session_id: "sess_y",
      created_at: new Date(now - 60 * 1000).toISOString(),
      updated_at: new Date(now - 60 * 1000).toISOString(),
    };

    const res = filterSelfEchoes([echoEntry, validEntry], { sessionId: "sess_x", now });
    expect(res.allowed.map((e) => e.id)).toEqual(["mem_valid"]);
    expect(res.suppressed.map((s) => s.entry.id)).toEqual(["mem_echo"]);

    const resBypass = filterSelfEchoes([echoEntry, validEntry], { sessionId: "sess_x", now, allowSelfEcho: true });
    expect(resBypass.allowed.length).toBe(2);
    expect(resBypass.suppressed.length).toBe(0);
  });

  describe("resolveMuseContext integration", () => {
    let tmpDir: string;
    let store: Store;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-self-echo-test-"));
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

    it("withholds newly created session memory via self-echo suppression", async () => {
      const now = new Date().toISOString();
      const freshMemory: MemoryEntry = {
        id: "mem_just_generated",
        title: "Database Lock Investigation",
        content: "Investigating thread lock deadlock contention in connection pool",
        project: "test-proj",
        type: "discovery",
        status: "candidate",
        session_id: "session_deadlock_investigation",
        created_at: now,
        updated_at: now,
      };
      save(store, freshMemory);

      // Same session query within 10-minute horizon should suppress the self-echo
      const contextResult = await resolveMuseContext(store, tmpDir, {
        query: "thread lock deadlock contention",
        session_id: "session_deadlock_investigation",
      });

      expect(contextResult.relevant_memories.some((m) => m.id === "mem_just_generated")).toBe(false);
      expect(contextResult.self_echo_suppressed_count).toBeGreaterThanOrEqual(1);
      const withheld = contextResult.withheld_memories?.find((w) => w.id === "mem_just_generated");
      expect(withheld).toBeDefined();
      expect(withheld?.reason).toContain("self_echo_suppressed");

      // A different session calling the same query CAN see it
      const otherSessionResult = await resolveMuseContext(store, tmpDir, {
        query: "thread lock deadlock contention",
        session_id: "different_session_99",
      });
      expect(otherSessionResult.relevant_memories.some((m) => m.id === "mem_just_generated")).toBe(true);

      // Opting out with suppress_self_echo: false returns it
      const bypassResult = await resolveMuseContext(store, tmpDir, {
        query: "thread lock deadlock contention",
        session_id: "session_deadlock_investigation",
        suppress_self_echo: false,
      });
      expect(bypassResult.relevant_memories.some((m) => m.id === "mem_just_generated")).toBe(true);
    });
  });
});
