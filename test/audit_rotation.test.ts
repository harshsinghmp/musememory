import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GENESIS_HASH,
  getAuditStorageStats,
  getAuditTrail,
  listAuditArchives,
  pruneAuditLedger,
  readAuditAnchor,
  recordAuditEvent,
  rotateAuditIfNeeded,
  verifyAuditChain,
} from "../src/audit.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "muse-audit-rotate-"));
}

function withRotationEnv<T>(fn: () => T, bytes = "1", segments?: string): T {
  process.env.MUSE_AUDIT_MAX_BYTES = bytes;
  if (segments !== undefined) process.env.MUSE_AUDIT_MAX_SEGMENTS = segments;
  try {
    return fn();
  } finally {
    delete process.env.MUSE_AUDIT_MAX_BYTES;
    if (segments !== undefined) delete process.env.MUSE_AUDIT_MAX_SEGMENTS;
  }
}

describe("R29: audit ledger rotation", () => {
  test("rolls the active file over and the chain continues across segments", () => {
    const root = temp();
    try {
      for (let i = 0; i < 4; i++) {
        recordAuditEvent(root, { operation: "propose", entry_id: `e${i}` });
      }

      expect(withRotationEnv(() => rotateAuditIfNeeded(root))).toBe(true);
      expect(listAuditArchives(root)).toHaveLength(1);
      expect(existsSync(join(root, "audit.jsonl"))).toBe(false);

      recordAuditEvent(root, { operation: "confirm", entry_id: "e9" });

      const trail = getAuditTrail(root);
      expect(trail.map((entry) => entry.entry_id)).toEqual(["e9", "e3", "e2", "e1", "e0"]);

      const chain = verifyAuditChain(root);
      expect(chain.valid).toBe(true);
      expect(chain.totalEntries).toBe(5);
      expect(chain.verifiedEntries).toBe(5);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("pruning records an anchor so the retained window still verifies", () => {
    const root = temp();
    try {
      for (let i = 0; i < 3; i++) {
        recordAuditEvent(root, { operation: "propose", entry_id: `e${i}` });
      }

      withRotationEnv(() => rotateAuditIfNeeded(root), "1", "0");
      expect(listAuditArchives(root)).toHaveLength(0);
      const anchor = readAuditAnchor(root);
      expect(anchor).not.toBe(GENESIS_HASH);

      recordAuditEvent(root, { operation: "confirm", entry_id: "after-prune" });
      const chain = verifyAuditChain(root);
      expect(chain.valid).toBe(true);
      expect(chain.totalEntries).toBe(1);
      expect(chain.verifiedEntries).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("retains only the configured number of archives and reports storage", () => {
    const root = temp();
    try {
      recordAuditEvent(root, { operation: "propose", entry_id: "a" });
      withRotationEnv(() => rotateAuditIfNeeded(root), "1", "5");
      recordAuditEvent(root, { operation: "propose", entry_id: "b" });
      withRotationEnv(() => rotateAuditIfNeeded(root), "1", "1");
      expect(listAuditArchives(root)).toHaveLength(1);

      recordAuditEvent(root, { operation: "propose", entry_id: "c" });
      withRotationEnv(() => rotateAuditIfNeeded(root), "1", "1");
      expect(listAuditArchives(root)).toHaveLength(1);

      const stats = getAuditStorageStats(root);
      expect(stats.files).toBe(1);
      expect(stats.bytes).toBeGreaterThan(0);
      expect(verifyAuditChain(root).valid).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("pruneAuditLedger honours an explicit retention bound", () => {
    const root = temp();
    try {
      for (let i = 0; i < 3; i++) {
        recordAuditEvent(root, { operation: "propose", entry_id: `e${i}` });
        withRotationEnv(() => rotateAuditIfNeeded(root), "1", "10");
      }
      expect(listAuditArchives(root)).toHaveLength(3);
      const removed = pruneAuditLedger(root, { maxSegments: 1 });
      expect(removed).toHaveLength(2);
      expect(listAuditArchives(root)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
