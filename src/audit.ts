import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { AuditEntry, AuditOperation, MerkleCheckpoint, MerkleProof } from "./types.ts";
import { appendJsonlWithFsync } from "./lock.ts";

export const GENESIS_HASH = "0".repeat(64);

export function auditFilePath(memoryDir: string): string {
  return join(memoryDir, "audit.jsonl");
}

export function auditSaltsFilePath(memoryDir: string): string {
  return join(memoryDir, "audit_salts.json");
}

export function checkpointsFilePath(memoryDir: string): string {
  return join(memoryDir, "checkpoints.jsonl");
}

/**
 * T-102: Retrieves or generates a per-day cryptographic salt.
 * Persisted in .memory/audit_salts.json for tamper-evident verification.
 */
export function getDailySalt(memoryDir: string, dateStr?: string): string {
  const dateKey = dateStr || new Date().toISOString().slice(0, 10);
  const saltsPath = auditSaltsFilePath(memoryDir);

  let salts: Record<string, string> = {};
  if (existsSync(saltsPath)) {
    try {
      salts = JSON.parse(readFileSync(saltsPath, "utf8"));
    } catch {}
  }

  if (salts[dateKey]) {
    return salts[dateKey];
  }

  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  const newSalt = randomBytes(16).toString("hex");
  salts[dateKey] = newSalt;
  try {
    writeFileSync(saltsPath, JSON.stringify(salts, null, 2), "utf8");
  } catch {}

  return newSalt;
}

/**
 * T-102: Computes a deterministic SHA-256 hash for an audit entry incorporating
 * the prior entry's hash, entry fields, and the daily salt.
 */
export function computeAuditEntryHash(
  entry: {
    prev_hash: string;
    timestamp: string;
    operation: string;
    entry_id: string;
    project?: string;
    actor?: string;
    reason?: string;
    details?: Record<string, any>;
    salt_date: string;
  },
  salt: string,
): string {
  const canonicalDetails = entry.details
    ? JSON.stringify(entry.details, Object.keys(entry.details).sort())
    : "";
  const payload = [
    entry.prev_hash,
    entry.timestamp,
    entry.operation,
    entry.entry_id,
    entry.project || "",
    entry.actor || "",
    entry.reason || "",
    canonicalDetails,
    entry.salt_date,
    salt,
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Reads the cryptographic hash of the most recent audit entry in audit.jsonl.
 * Returns GENESIS_HASH if empty or unhashed.
 */
export function getLastAuditHash(memoryDir: string): string {
  const auditPath = auditFilePath(memoryDir);
  if (!existsSync(auditPath)) return GENESIS_HASH;

  try {
    const raw = readFileSync(auditPath, "utf8");
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (parsed.hash && typeof parsed.hash === "string") {
          return parsed.hash;
        }
      } catch {}
    }
  } catch {}

  return GENESIS_HASH;
}

/**
 * Appends a structured audit event to the append-only audit ledger (.memory/audit.jsonl).
 * T-044: Guarantees fsync crash durability on every event line written.
 * T-102: Implements tamper-evident cryptographic hash chaining with per-day salt.
 */
export function recordAuditEvent(
  memoryDir: string,
  event: {
    operation: AuditOperation;
    entry_id: string;
    project?: string;
    actor?: string;
    reason?: string;
    details?: Record<string, any>;
  },
): AuditEntry {
  const auditPath = auditFilePath(memoryDir);
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const saltDate = timestamp.slice(0, 10);
  const salt = getDailySalt(memoryDir, saltDate);
  const prevHash = getLastAuditHash(memoryDir);

  const partialEntry = {
    prev_hash: prevHash,
    timestamp,
    operation: event.operation,
    entry_id: event.entry_id,
    project: event.project,
    actor: event.actor ?? "agent",
    reason: event.reason,
    details: event.details,
    salt_date: saltDate,
  };

  const hash = computeAuditEntryHash(partialEntry, salt);

  const entry: AuditEntry = {
    ...partialEntry,
    hash,
  };

  appendJsonlWithFsync(auditPath, JSON.stringify(entry));
  return entry;
}

export interface AuditQueryOptions {
  operation?: string;
  entryId?: string;
  limit?: number;
}

/**
 * Reads audit trail from .memory/audit.jsonl in reverse chronological order.
 */
export function getAuditTrail(memoryDir: string, options: AuditQueryOptions = {}): AuditEntry[] {
  const auditPath = auditFilePath(memoryDir);
  if (!existsSync(auditPath)) return [];

  const raw = readFileSync(auditPath, "utf8");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const entries: AuditEntry[] = [];

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as AuditEntry;
      if (options.operation && parsed.operation !== options.operation) {
        continue;
      }
      if (options.entryId && parsed.entry_id !== options.entryId) {
        continue;
      }
      entries.push(parsed);
      if (options.limit && entries.length >= options.limit) {
        break;
      }
    } catch {
      // Ignore corrupt lines
    }
  }

  return entries;
}

export interface AuditChainVerificationResult {
  valid: boolean;
  totalEntries: number;
  verifiedEntries: number;
  error?: string;
  corruptedIndex?: number;
  corruptedEntryId?: string;
}

/**
 * T-102: Verifies the integrity of the audit ledger line-by-line against hash chaining and per-day salts.
 */
export function verifyAuditChain(memoryDir: string): AuditChainVerificationResult {
  const auditPath = auditFilePath(memoryDir);
  if (!existsSync(auditPath)) {
    return { valid: true, totalEntries: 0, verifiedEntries: 0 };
  }

  const raw = readFileSync(auditPath, "utf8");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  let expectedPrevHash = GENESIS_HASH;
  let verified = 0;

  for (let i = 0; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]) as AuditEntry;

      // Gracefully handle legacy pre-hash-chaining entries
      if (!entry.hash) {
        expectedPrevHash = GENESIS_HASH;
        continue;
      }

      if (entry.prev_hash !== expectedPrevHash) {
        return {
          valid: false,
          totalEntries: lines.length,
          verifiedEntries: verified,
          corruptedIndex: i,
          corruptedEntryId: entry.entry_id,
          error: `Hash chain broken at index ${i}: expected prev_hash "${expectedPrevHash}" but found "${entry.prev_hash}"`,
        };
      }

      const saltDate = entry.salt_date || (entry.timestamp ? entry.timestamp.slice(0, 10) : "");
      const salt = getDailySalt(memoryDir, saltDate);
      const recomputedHash = computeAuditEntryHash(
        {
          prev_hash: entry.prev_hash,
          timestamp: entry.timestamp,
          operation: entry.operation,
          entry_id: entry.entry_id,
          project: entry.project,
          actor: entry.actor,
          reason: entry.reason,
          details: entry.details,
          salt_date: saltDate,
        },
        salt,
      );

      if (recomputedHash !== entry.hash) {
        return {
          valid: false,
          totalEntries: lines.length,
          verifiedEntries: verified,
          corruptedIndex: i,
          corruptedEntryId: entry.entry_id,
          error: `Tampered entry hash at index ${i}: stored "${entry.hash}" does not match recomputed "${recomputedHash}"`,
        };
      }

      expectedPrevHash = entry.hash;
      verified++;
    } catch (err: any) {
      return {
        valid: false,
        totalEntries: lines.length,
        verifiedEntries: verified,
        corruptedIndex: i,
        error: `Corrupt JSON line at index ${i}: ${err.message || String(err)}`,
      };
    }
  }

  return {
    valid: true,
    totalEntries: lines.length,
    verifiedEntries: verified,
  };
}

/**
 * T-102: Computes a Merkle root over an array of leaf hashes using pairwise SHA-256 combining.
 */
export function computeMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) {
    return createHash("sha256").update("empty_merkle_tree", "utf8").digest("hex");
  }
  if (leaves.length === 1) {
    return leaves[0];
  }

  let currentLayer = [...leaves];
  while (currentLayer.length > 1) {
    const nextLayer: string[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i];
      const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : left;
      const combined = createHash("sha256").update(left + right, "utf8").digest("hex");
      nextLayer.push(combined);
    }
    currentLayer = nextLayer;
  }

  return currentLayer[0];
}

/**
 * T-102: Generates a Merkle inclusion proof for the leaf at the given index.
 */
export function generateMerkleProof(leaves: string[], index: number): MerkleProof {
  if (index < 0 || index >= leaves.length) {
    throw new Error(`Invalid leaf index ${index} for tree with ${leaves.length} leaves`);
  }

  const siblings: string[] = [];
  let currentLayer = [...leaves];
  let currentIndex = index;

  while (currentLayer.length > 1) {
    const isRightNode = currentIndex % 2 === 1;
    const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;

    if (siblingIndex < currentLayer.length) {
      siblings.push(currentLayer[siblingIndex]);
    } else {
      // If odd element at end, it pairs with itself
      siblings.push(currentLayer[currentIndex]);
    }

    const nextLayer: string[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i];
      const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : left;
      nextLayer.push(createHash("sha256").update(left + right, "utf8").digest("hex"));
    }

    currentLayer = nextLayer;
    currentIndex = Math.floor(currentIndex / 2);
  }

  return {
    leaf: leaves[index],
    index,
    siblings,
    root: currentLayer[0],
  };
}

/**
 * T-102: Verifies a Merkle inclusion proof against a root hash.
 */
export function verifyMerkleProof(proof: MerkleProof): boolean {
  let current = proof.leaf;
  let index = proof.index;

  for (const sibling of proof.siblings) {
    const isRightNode = index % 2 === 1;
    const combined = isRightNode ? sibling + current : current + sibling;
    current = createHash("sha256").update(combined, "utf8").digest("hex");
    index = Math.floor(index / 2);
  }

  return current === proof.root;
}

/**
 * T-102: Creates a session Merkle checkpoint summarizing audit state for a session.
 */
export function createSessionMerkleCheckpoint(
  memoryDir: string,
  sessionId: string,
): MerkleCheckpoint {
  const allEvents = getAuditTrail(memoryDir);
  const sessionEvents = allEvents.filter(
    (e) => e.details?.session_id === sessionId || e.entry_id === sessionId,
  );

  const leaves = sessionEvents.map(
    (e) => e.hash || createHash("sha256").update(JSON.stringify(e), "utf8").digest("hex"),
  );
  const merkleRoot = computeMerkleRoot(leaves);
  const now = new Date().toISOString();
  const saltDate = now.slice(0, 10);
  const dailySalt = getDailySalt(memoryDir, saltDate);

  const checkpoint: MerkleCheckpoint = {
    checkpoint_id: `chk_${Date.now()}_${sessionId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    session_id: sessionId,
    timestamp: now,
    merkle_root: merkleRoot,
    leaf_count: leaves.length,
    leaves,
    daily_salt: dailySalt,
  };

  const chkPath = checkpointsFilePath(memoryDir);
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }
  appendJsonlWithFsync(chkPath, JSON.stringify(checkpoint));

  recordAuditEvent(memoryDir, {
    operation: "merkle_checkpoint",
    entry_id: checkpoint.checkpoint_id,
    details: {
      session_id: sessionId,
      merkle_root: checkpoint.merkle_root,
      leaf_count: checkpoint.leaf_count,
    },
  });

  return checkpoint;
}

/**
 * T-102: Verifies that a MerkleCheckpoint correctly matches the provided session audit events.
 */
export function verifySessionMerkleCheckpoint(
  checkpoint: MerkleCheckpoint,
  events: AuditEntry[],
): boolean {
  const computedLeaves = events.map(
    (e) => e.hash || createHash("sha256").update(JSON.stringify(e), "utf8").digest("hex"),
  );
  if (computedLeaves.length !== checkpoint.leaf_count) {
    return false;
  }
  const root = computeMerkleRoot(computedLeaves);
  return root === checkpoint.merkle_root;
}
