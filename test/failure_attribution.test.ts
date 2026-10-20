import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openStore, propose, confirm, save, type Store } from "../src/store.ts";
import { evaluateSessionOutcomes, isMemoryRelevantToFailure } from "../src/learning/feedback.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("T-313: Scoped Failure Attribution", () => {
  const testDir = join(import.meta.dir, ".tmp-failure-attribution-test");
  let store: Store;

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    store = openStore(testDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("isMemoryRelevantToFailure", () => {
    it("identifies relevance when failure context references memory code anchor file", () => {
      const entry: MemoryEntry = {
        id: "mem-1",
        title: "JWT Session Validator",
        content: "Validate JWT expiry on tokens",
        project: "test-proj",
        type: "architecture",
        status: "confirmed",
        anchors: [
          {
            id: "anc-1",
            kind: "file",
            file_path: "src/auth/jwt.ts",
            structural_hash: "hash123",
            status: "valid",
          },
        ],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const isRelevant = isMemoryRelevantToFailure(entry, {
        command: "bun test src/auth/jwt.test.ts",
        logs: "FAIL: src/auth/jwt.ts:42 TokenExpiredError",
        exitCode: 1,
        project: "test-proj",
      });

      expect(isRelevant).toBe(true);
    });

    it("identifies relevance when failure logs reference distinctive anchor symbol", () => {
      const entry: MemoryEntry = {
        id: "mem-2",
        title: "Authentication Token Manager",
        content: "Manage bearer auth tokens",
        project: "test-proj",
        type: "fix",
        status: "confirmed",
        anchors: [
          {
            id: "anc-2",
            kind: "symbol",
            file_path: "src/auth/manager.ts",
            symbol_name: "SessionTokenManager",
            structural_hash: "hash456",
            status: "valid",
          },
        ],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const isRelevant = isMemoryRelevantToFailure(entry, {
        command: "bun test",
        logs: "Error: SessionTokenManager failed to refresh token",
        exitCode: 1,
        project: "test-proj",
      });

      expect(isRelevant).toBe(true);
    });

    it("rejects false attribution when symbol is generic low-specificity (e.g. 'id', 'get')", () => {
      const entry: MemoryEntry = {
        id: "mem-3",
        title: "Generic ID Utility",
        content: "Utility function for ids",
        project: "test-proj",
        type: "fix",
        status: "confirmed",
        anchors: [
          {
            id: "anc-3",
            kind: "symbol",
            file_path: "src/utils/id.ts",
            symbol_name: "id",
            structural_hash: "hash789",
            status: "valid",
          },
        ],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // The log mentions 'id', but it is a generic word boundary match
      const isRelevant = isMemoryRelevantToFailure(entry, {
        command: "bun test src/payment/checkout.test.ts",
        logs: "TypeError: Cannot read properties of undefined (reading 'id')",
        exitCode: 1,
        project: "test-proj",
      });

      expect(isRelevant).toBe(false);
    });

    it("classifies unrelated memory as bystander (false relevance)", () => {
      const entry: MemoryEntry = {
        id: "mem-4",
        title: "CSS Button Layout Rule",
        content: "Always use flexbox for buttons",
        project: "test-proj",
        type: "preference",
        status: "confirmed",
        anchors: [
          {
            id: "anc-4",
            kind: "file",
            file_path: "src/components/Button.tsx",
            structural_hash: "hash000",
            status: "valid",
          },
        ],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const isRelevant = isMemoryRelevantToFailure(entry, {
        command: "bun test src/auth/jwt.test.ts",
        logs: "FAIL: src/auth/jwt.ts:42 TokenExpiredError",
        exitCode: 1,
        project: "test-proj",
      });

      expect(isRelevant).toBe(false);
    });
  });

  describe("evaluateSessionOutcomes with Scoped Attribution", () => {
    it("only marks regression on relevant memory while bystander memory is untouched", () => {
      // 1. Relevant memory (auth)
      const authEntry = propose(store, {
        title: "Auth JWT Rules",
        content: "JWT validation rules in src/auth/jwt.ts",
        project: "test-proj",
        type: "architecture",
      });
      authEntry.anchors = [
        {
          id: "anc-auth",
          kind: "file",
          file_path: "src/auth/jwt.ts",
          structural_hash: "auth123",
          status: "valid",
        },
      ];
      confirm(store, authEntry.id);
      authEntry.status = "confirmed";
      // Ensure anchors are persisted in the store
      save(store, authEntry);

      // 2. Bystander memory (button)
      const uiEntry = propose(store, {
        title: "Button UI Styles",
        content: "Button styling in src/components/Button.tsx",
        project: "test-proj",
        type: "preference",
      });
      uiEntry.anchors = [
        {
          id: "anc-ui",
          kind: "file",
          file_path: "src/components/Button.tsx",
          structural_hash: "ui123",
          status: "valid",
        },
      ];
      confirm(store, uiEntry.id);
      uiEntry.status = "confirmed";
      save(store, uiEntry);

      // Evaluate command failure that occurred in jwt.ts
      const result = evaluateSessionOutcomes(store, {
        project: "test-proj",
        retrievedMemoryIds: [authEntry.id, uiEntry.id],
        exitCode: 1,
        command: "bun test src/auth/jwt.test.ts",
        logs: "FAIL in src/auth/jwt.ts: signature verification failed",
      });

      expect(result.updatedMemories.length).toBe(2);

      const updatedAuth = result.updatedMemories.find((m) => m.id === authEntry.id)!;
      const updatedUi = result.updatedMemories.find((m) => m.id === uiEntry.id)!;

      // Auth memory should have received regression
      expect(updatedAuth.utility?.regressions).toBe(1);

      // UI bystander memory should NOT have received regression!
      expect(updatedUi.utility?.regressions ?? 0).toBe(0);
    });
  });

  describe("Decaying Strike Engine & Constitutional Gate", () => {
    it("deduplicates retry loop failures within same session (at most 1 strike per session)", () => {
      const entry = propose(store, {
        title: "Database Pool Rule",
        content: "Pool config in src/db/pool.ts",
        project: "test-proj",
        type: "fix",
      });
      confirm(store, entry.id);

      const { recordApplicationOutcome } = require("../src/quality/utility.ts");

      // Failure attempt 1 in session-A
      recordApplicationOutcome(store, {
        memoryId: entry.id,
        success: false,
        regression: true,
        sessionId: "session-A",
      });

      // Failure attempt 2 in same session-A (retry 1)
      recordApplicationOutcome(store, {
        memoryId: entry.id,
        success: false,
        regression: true,
        sessionId: "session-A",
      });

      // Failure attempt 3 in same session-A (retry 2)
      const after3Retries = recordApplicationOutcome(store, {
        memoryId: entry.id,
        success: false,
        regression: true,
        sessionId: "session-A",
      });

      // Regressions count may be 3, but strikes MUST be 1
      expect(after3Retries.utility?.regressions).toBe(3);
      expect(after3Retries.utility?.regression_strikes).toBe(1);
    });

    it("decays active strikes after 2 consecutive clean runs", () => {
      const entry = propose(store, {
        title: "API Rate Limiter",
        content: "Rate limiter in src/api/limit.ts",
        project: "test-proj",
        type: "fix",
      });
      confirm(store, entry.id);

      const { recordApplicationOutcome } = require("../src/quality/utility.ts");

      // Strike 1 in session-1
      recordApplicationOutcome(store, {
        memoryId: entry.id,
        success: false,
        regression: true,
        sessionId: "session-1",
      });
      // Strike 2 in session-2
      const after2Strikes = recordApplicationOutcome(store, {
        memoryId: entry.id,
        success: false,
        regression: true,
        sessionId: "session-2",
      });
      expect(after2Strikes.utility?.regression_strikes).toBe(2);

      // Clean run 1
      recordApplicationOutcome(store, {
        memoryId: entry.id,
        success: true,
      });

      // Clean run 2 -> should trigger strike decay!
      const afterClean2 = recordApplicationOutcome(store, {
        memoryId: entry.id,
        success: true,
      });

      expect(afterClean2.utility?.regression_strikes).toBe(1);
    });

    it("decays active strikes when 30 days elapse without recurring failure", () => {
      const entry = propose(store, {
        title: "Cache Layer",
        content: "Cache in src/cache.ts",
        project: "test-proj",
        type: "fix",
      });
      confirm(store, entry.id);

      const { recordApplicationOutcome } = require("../src/quality/utility.ts");

      const t0 = Date.now();
      recordApplicationOutcome(store, {
        memoryId: entry.id,
        success: false,
        regression: true,
        sessionId: "session-1",
        now: t0,
      });

      // Simulate 31 days passing
      const t31DaysLater = t0 + 31 * 86_400_000;
      const afterTimeDecay = recordApplicationOutcome(store, {
        memoryId: entry.id,
        success: true,
        now: t31DaysLater,
      });

      expect(afterTimeDecay.utility?.regression_strikes).toBe(0);
    });

    it("demotes memory to disputed only when 3 distinct corroborated strikes accumulate", () => {
      const entry = propose(store, {
        title: "Worker Thread Pool",
        content: "Worker pool in src/worker.ts",
        project: "test-proj",
        type: "fix",
      });
      confirm(store, entry.id);

      const { recordApplicationOutcome } = require("../src/quality/utility.ts");

      // Strike 1
      recordApplicationOutcome(store, {
        memoryId: entry.id,
        success: false,
        regression: true,
        sessionId: "session-1",
      });
      // Strike 2
      recordApplicationOutcome(store, {
        memoryId: entry.id,
        success: false,
        regression: true,
        sessionId: "session-2",
      });
      // After 2 strikes, still confirmed
      const after2 = recordApplicationOutcome(store, {
        memoryId: entry.id,
        success: true,
      });
      expect(after2.status).toBe("confirmed");

      // Strike 3
      const after3 = recordApplicationOutcome(store, {
        memoryId: entry.id,
        success: false,
        regression: true,
        sessionId: "session-3",
      });

      // With 3 active strikes, status is flipped to disputed
      expect(after3.utility?.regression_strikes).toBe(3);
      expect(after3.status).toBe("disputed");
    });

    it("protects constitutional constraints and high-salience memories from auto-dispute", () => {
      const constraint = propose(store, {
        title: "Never commit secrets to git",
        content: "Hard invariant: Zero secret exposure",
        project: "test-proj",
        type: "constraint",
        salience: 1.0,
      });
      confirm(store, constraint.id);

      const { recordApplicationOutcome } = require("../src/quality/utility.ts");

      // 3 distinct failures in 3 sessions
      recordApplicationOutcome(store, {
        memoryId: constraint.id,
        success: false,
        regression: true,
        sessionId: "session-1",
      });
      recordApplicationOutcome(store, {
        memoryId: constraint.id,
        success: false,
        regression: true,
        sessionId: "session-2",
      });
      const after3 = recordApplicationOutcome(store, {
        memoryId: constraint.id,
        success: false,
        regression: true,
        sessionId: "session-3",
      });

      // Strikes are tracked, but status is NEVER flipped to disputed!
      expect(after3.utility?.regression_strikes).toBe(3);
      expect(after3.status).toBe("confirmed");
    });
  });
});
