import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  recordAuditEvent,
  getAuditTrail,
  verifyAuditChain,
  getDailySalt,
  computeMerkleRoot,
  generateMerkleProof,
  verifyMerkleProof,
  createSessionMerkleCheckpoint,
  verifySessionMerkleCheckpoint,
  auditFilePath,
  GENESIS_HASH,
} from "../src/audit.ts";

describe("T-102: Hash-Chained Audit Ledger and Session Merkle Checkpoints", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-audit-merkle-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("generates cryptographic hash chain across sequential audit events", () => {
    const e1 = recordAuditEvent(tmpDir, {
      operation: "propose",
      entry_id: "m_1",
      project: "test-proj",
      details: { title: "First Memory" },
    });

    const e2 = recordAuditEvent(tmpDir, {
      operation: "confirm",
      entry_id: "m_1",
      project: "test-proj",
    });

    const e3 = recordAuditEvent(tmpDir, {
      operation: "supersede",
      entry_id: "m_1",
      project: "test-proj",
      details: { superseded_by: "m_2" },
    });

    expect(e1.prev_hash).toBe(GENESIS_HASH);
    expect(e1.hash).toBeDefined();
    expect(e1.hash!.length).toBe(64);

    expect(e2.prev_hash).toBe(e1.hash);
    expect(e2.hash).toBeDefined();
    expect(e2.hash!.length).toBe(64);

    expect(e3.prev_hash).toBe(e2.hash);
    expect(e3.hash).toBeDefined();
    expect(e3.hash!.length).toBe(64);

    const verification = verifyAuditChain(tmpDir);
    expect(verification.valid).toBe(true);
    expect(verification.totalEntries).toBe(3);
    expect(verification.verifiedEntries).toBe(3);
  });

  test("detects payload tampering in audit ledger", () => {
    recordAuditEvent(tmpDir, {
      operation: "propose",
      entry_id: "m_alpha",
      details: { role: "admin" },
    });

    recordAuditEvent(tmpDir, {
      operation: "propose",
      entry_id: "m_beta",
      details: { role: "user" },
    });

    const auditFile = auditFilePath(tmpDir);
    const lines = readFileSync(auditFile, "utf8").trim().split("\n");
    const tampered = JSON.parse(lines[1]);
    tampered.details.role = "superadmin"; // Unauthorized change
    lines[1] = JSON.stringify(tampered);
    writeFileSync(auditFile, lines.join("\n") + "\n", "utf8");

    const verification = verifyAuditChain(tmpDir);
    expect(verification.valid).toBe(false);
    expect(verification.corruptedIndex).toBe(1);
    expect(verification.corruptedEntryId).toBe("m_beta");
    expect(verification.error).toContain("Tampered entry hash");
  });

  test("detects broken prev_hash links when an entry is deleted or reordered", () => {
    recordAuditEvent(tmpDir, { operation: "propose", entry_id: "m_1" });
    recordAuditEvent(tmpDir, { operation: "confirm", entry_id: "m_1" });
    recordAuditEvent(tmpDir, { operation: "archive", entry_id: "m_1" });

    // Drop the middle entry
    const auditFile = auditFilePath(tmpDir);
    const lines = readFileSync(auditFile, "utf8").trim().split("\n");
    lines.splice(1, 1);
    writeFileSync(auditFile, lines.join("\n") + "\n", "utf8");

    const verification = verifyAuditChain(tmpDir);
    expect(verification.valid).toBe(false);
    expect(verification.corruptedIndex).toBe(1);
    expect(verification.error).toContain("Hash chain broken");
  });

  test("per-day salt rotates across dates and persists deterministically per day", () => {
    const saltDay1 = getDailySalt(tmpDir, "2026-10-19");
    const saltDay1Repeat = getDailySalt(tmpDir, "2026-10-19");
    const saltDay2 = getDailySalt(tmpDir, "2026-10-20");

    expect(saltDay1).toBe(saltDay1Repeat);
    expect(saltDay1).not.toBe(saltDay2);
    expect(saltDay1.length).toBe(32);
    expect(saltDay2.length).toBe(32);
  });

  test("computes Merkle roots correctly for odd and even leaf counts", () => {
    const l1 = "a".repeat(64);
    const l2 = "b".repeat(64);
    const l3 = "c".repeat(64);

    expect(computeMerkleRoot([])).toBeDefined();
    expect(computeMerkleRoot([l1])).toBe(l1);

    const root2 = computeMerkleRoot([l1, l2]);
    expect(root2.length).toBe(64);

    const root3 = computeMerkleRoot([l1, l2, l3]);
    expect(root3.length).toBe(64);
    expect(root3).not.toBe(root2);
  });

  test("generates and verifies Merkle inclusion proofs for arbitrary leaf positions", () => {
    const leaves = [
      "1111111111111111111111111111111111111111111111111111111111111111",
      "2222222222222222222222222222222222222222222222222222222222222222",
      "3333333333333333333333333333333333333333333333333333333333333333",
      "4444444444444444444444444444444444444444444444444444444444444444",
      "5555555555555555555555555555555555555555555555555555555555555555",
    ];

    const root = computeMerkleRoot(leaves);

    for (let i = 0; i < leaves.length; i++) {
      const proof = generateMerkleProof(leaves, i);
      expect(proof.root).toBe(root);
      expect(proof.leaf).toBe(leaves[i]);
      expect(proof.index).toBe(i);
      expect(verifyMerkleProof(proof)).toBe(true);

      // Tampered leaf must fail verification
      const badProof = { ...proof, leaf: "0".repeat(64) };
      expect(verifyMerkleProof(badProof)).toBe(false);
    }
  });

  test("creates and verifies session Merkle checkpoints", () => {
    const sessionId = "sess_checkout_test";

    recordAuditEvent(tmpDir, {
      operation: "propose",
      entry_id: "m_alpha",
      details: { session_id: sessionId, action: "init" },
    });

    recordAuditEvent(tmpDir, {
      operation: "confirm",
      entry_id: "m_alpha",
      details: { session_id: sessionId, action: "validate" },
    });

    const checkpoint = createSessionMerkleCheckpoint(tmpDir, sessionId);

    expect(checkpoint.session_id).toBe(sessionId);
    expect(checkpoint.leaf_count).toBe(2);
    expect(checkpoint.merkle_root.length).toBe(64);

    const sessionEvents = getAuditTrail(tmpDir).filter(
      (e) => e.details?.session_id === sessionId && e.operation !== "merkle_checkpoint",
    );

    const isValid = verifySessionMerkleCheckpoint(checkpoint, sessionEvents);
    expect(isValid).toBe(true);
  });
});
