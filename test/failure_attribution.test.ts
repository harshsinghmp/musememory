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
            kind: "file",
            file: "src/auth/jwt.ts",
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
            kind: "symbol",
            file: "src/auth/manager.ts",
            symbol: "SessionTokenManager",
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
            kind: "symbol",
            file: "src/utils/id.ts",
            symbol: "id",
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
            kind: "file",
            file: "src/components/Button.tsx",
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
          kind: "file",
          file: "src/auth/jwt.ts",
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
          kind: "file",
          file: "src/components/Button.tsx",
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
});
