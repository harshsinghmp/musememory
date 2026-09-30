import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Store } from "../store.ts";
import type { MemoryEntry, CodeAnchor } from "../types.ts";
import { computeStructuralHash, extractSymbolBody } from "./fingerprint.ts";
import { recordAuditEvent } from "../audit.ts";

/**
 * Write-Time Citation Verification (GAP-1)
 *
 * Kage-pattern trust gate: every code anchor on a memory is checked against the
 * actual filesystem at write time. A memory that cites code which does not exist
 * is refused before it can enter storage, so hallucinated citations never land
 * in the store and never get served at recall time.
 *
 * Verification rules:
 *  - file missing                  -> `orphaned` (hallucinated citation)
 *  - symbol missing in file        -> `orphaned` (hallucinated citation)
 *  - structural hash mismatch      -> `drifted` (file exists, body changed)
 *  - file present, no hash on file -> `valid` (fresh anchor, hash stamped)
 *
 * Policy:
 *  - `fail_fast` (default): orphaned anchors REJECT the write (Vibeguard doctrine:
 *    throw loudly rather than store unverified truth).
 *  - `warn`: orphaned anchors are stripped and the write proceeds.
 *  - `strict`: drifted anchors also reject the write.
 *
 * Every rejection or downgrade writes an immutable `anchor_rejected` /
 * `anchor_drift_flagged` record to audit.jsonl.
 */

export type VerificationPolicy = "fail_fast" | "warn" | "strict";

export interface AnchorWriteVerdict {
  anchor_id: string;
  file_path: string;
  symbol_name?: string;
  status: "valid" | "drifted" | "orphaned";
  action: "admitted" | "downgraded" | "rejected";
  drift_details?: string;
}

export interface WriteVerificationResult {
  admitted: boolean;
  verdicts: AnchorWriteVerdict[];
  rejected: AnchorWriteVerdict[];
  downgraded: AnchorWriteVerdict[];
}

interface AnchorCheck {
  status: "valid" | "drifted" | "orphaned";
  drift_details?: string;
  /** Fresh hash for valid verdicts (stamped onto the anchor). */
  structural_hash?: string;
}

/** Verify a single anchor against the live filesystem. */
function checkAnchor(workspaceRoot: string, anchor: CodeAnchor): AnchorCheck {
  const fullPath = resolve(workspaceRoot, anchor.file_path);

  if (!existsSync(fullPath)) {
    return {
      status: "orphaned",
      drift_details: `Citation rejected: file '${anchor.file_path}' does not exist in workspace`,
    };
  }

  const content = readFileSync(fullPath, "utf8");

  if (anchor.symbol_name) {
    const extracted = extractSymbolBody(content, anchor.symbol_name);
    if (!extracted.found) {
      return {
        status: "orphaned",
        drift_details: `Citation rejected: symbol '${anchor.symbol_name}' not found in '${anchor.file_path}'`,
      };
    }

    if (anchor.structural_hash) {
      const currentHash = computeStructuralHash(extracted.body || extracted.signature || "");
      if (anchor.structural_hash !== currentHash) {
        return {
          status: "drifted",
          drift_details: `Code body for symbol '${anchor.symbol_name}' drifted from recorded structural hash`,
        };
      }
    }

    return {
      status: "valid",
      structural_hash:
        anchor.structural_hash ?? computeStructuralHash(extracted.body || extracted.signature || ""),
    };
  }

  // File-level anchor
  if (anchor.structural_hash) {
    const currentHash = computeStructuralHash(content);
    if (anchor.structural_hash !== currentHash) {
      return {
        status: "drifted",
        drift_details: `File '${anchor.file_path}' drifted from recorded structural hash`,
      };
    }
  }

  return {
    status: "valid",
    structural_hash: anchor.structural_hash ?? computeStructuralHash(content),
  };
}

/**
 * Enforces write-time citation verification over every anchor on a memory entry.
 *
 * Mutates the entry in place: downgraded anchors get refreshed status/hash and a
 * `verified_at` stamp. Returns whether the write is admitted under the policy.
 */
export function enforceWriteTimeVerification(
  store: Store,
  workspaceRoot: string,
  entry: MemoryEntry,
  options: { policy?: VerificationPolicy } = {},
): WriteVerificationResult {
  const policy = options.policy ?? "fail_fast";
  const anchors = entry.anchors ?? [];

  const result: WriteVerificationResult = {
    admitted: true,
    verdicts: [],
    rejected: [],
    downgraded: [],
  };

  if (anchors.length === 0) return result;

  const now = new Date().toISOString();
  const survivors: CodeAnchor[] = [];

  for (const anchor of anchors) {
    const check = checkAnchor(workspaceRoot, anchor);

    const verdict: AnchorWriteVerdict = {
      anchor_id: anchor.id,
      file_path: anchor.file_path,
      symbol_name: anchor.symbol_name,
      status: check.status,
      action: "admitted",
      drift_details: check.drift_details,
    };

    if (check.status === "orphaned") {
      if (policy === "fail_fast" || policy === "strict") {
        verdict.action = "rejected";
        result.rejected.push(verdict);
        result.admitted = false;
        if (store.memoryDir) {
          recordAuditEvent(store.memoryDir, {
            operation: "anchor_reconciled",
            entry_id: entry.id,
            project: entry.project,
            actor: "write_verification",
            reason: check.drift_details ?? "Hallucinated citation rejected at write time",
            details: { ...verdict, gate: "anchor_rejected" } as any,
          });
        }
        continue;
      }

      // warn policy: strip the bad anchor, proceed
      verdict.action = "downgraded";
      result.downgraded.push(verdict);
      if (store.memoryDir) {
        recordAuditEvent(store.memoryDir, {
          operation: "anchor_reconciled",
          entry_id: entry.id,
          project: entry.project,
          actor: "write_verification",
          reason: `Stripped invalid citation: ${check.drift_details ?? "anchor unverifiable"}`,
          details: { ...verdict, gate: "anchor_rejected" } as any,
        });
      }
      continue;
    }

    if (check.status === "drifted" && policy === "strict") {
      verdict.action = "rejected";
      result.rejected.push(verdict);
      result.admitted = false;
      if (store.memoryDir) {
        recordAuditEvent(store.memoryDir, {
          operation: "anchor_reconciled",
          entry_id: entry.id,
          project: entry.project,
          actor: "write_verification",
          reason: check.drift_details ?? "Drifted citation rejected under strict policy",
          details: { ...verdict, gate: "anchor_rejected" } as any,
        });
      }
      continue;
    }

    if (check.status === "drifted") {
      verdict.action = "downgraded";
      result.downgraded.push(verdict);
      if (store.memoryDir) {
        recordAuditEvent(store.memoryDir, {
          operation: "anchor_drifted",
          entry_id: entry.id,
          project: entry.project,
          actor: "write_verification",
          reason: check.drift_details ?? "Anchor drifted from live code",
          details: { ...verdict, gate: "anchor_drift_flagged" } as any,
        });
      }
    }

    survivors.push({
      ...anchor,
      status: check.status,
      structural_hash: check.structural_hash ?? anchor.structural_hash,
      verified_at: now,
    });
  }

  entry.anchors = survivors;
  return result;
}

/** Formats a rejection error matching the codebase's fail-fast error style. */
export function formatRejectionError(result: WriteVerificationResult): string {
  const first = result.rejected[0];
  const count = result.rejected.length;
  const detail = first
    ? ` (${first.file_path}${first.symbol_name ? `#${first.symbol_name}` : ""})`
    : "";
  return `Write-time citation verification failed: ${count} hallucinated citation${count > 1 ? "s" : ""} rejected${detail}. Anchor memories to code that actually exists, or create the anchor against the real file path/symbol.`;
}
