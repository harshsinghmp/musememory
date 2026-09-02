import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Store } from "../store.ts";
import { get, list, save } from "../store.ts";
import { recordAuditEvent } from "../audit.ts";
import type { MemoryEntry } from "../types.ts";
import type {
  CodeAnchor,
  CodeAnchorKind,
  AnchorStatus,
  AnchorVerificationResult,
  AnchorAuditReport,
  CreateAnchorOptions,
} from "./types.ts";
import { computeStructuralHash, extractSymbolBody } from "./fingerprint.ts";

/** Safe slug generator for anchor ID */
function slugify(text: string): string {
  return text.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase().slice(0, 30);
}

/**
 * Creates a line-independent structural code anchor pointing to a file or symbol.
 */
export function createCodeAnchor(
  workspaceRoot: string,
  options: CreateAnchorOptions
): CodeAnchor {
  const fullPath = resolve(workspaceRoot, options.filePath);
  const now = new Date().toISOString();
  const fileExists = existsSync(fullPath);

  const anchorId = `anc_${Date.now()}_${slugify(options.symbolName || options.filePath)}`;

  if (!fileExists) {
    return {
      id: anchorId,
      kind: options.kind,
      file_path: options.filePath,
      symbol_name: options.symbolName,
      qualified_name: options.qualifiedName,
      status: "orphaned",
      provider_metadata: options.providerMetadata,
      created_at: now,
      verified_at: now,
    };
  }

  const content = readFileSync(fullPath, "utf8");

  if (options.symbolName) {
    const extracted = extractSymbolBody(content, options.symbolName);
    if (!extracted.found) {
      return {
        id: anchorId,
        kind: options.kind,
        file_path: options.filePath,
        symbol_name: options.symbolName,
        qualified_name: options.qualifiedName,
        status: "orphaned",
        provider_metadata: options.providerMetadata,
        created_at: now,
        verified_at: now,
      };
    }

    const structuralHash = computeStructuralHash(extracted.body || extracted.signature || "");
    return {
      id: anchorId,
      kind: options.kind,
      file_path: options.filePath,
      symbol_name: options.symbolName,
      qualified_name: options.qualifiedName,
      signature: extracted.signature,
      structural_hash: structuralHash,
      status: "valid",
      provider_metadata: options.providerMetadata,
      created_at: now,
      verified_at: now,
    };
  }

  // File or directory level anchor
  const fileHash = computeStructuralHash(content);
  return {
    id: anchorId,
    kind: options.kind,
    file_path: options.filePath,
    structural_hash: fileHash,
    status: "valid",
    provider_metadata: options.providerMetadata,
    created_at: now,
    verified_at: now,
  };
}

/**
 * Verifies an existing code anchor against the actual filesystem code state.
 */
export function verifyCodeAnchor(
  workspaceRoot: string,
  anchor: CodeAnchor
): AnchorVerificationResult {
  const fullPath = resolve(workspaceRoot, anchor.file_path);
  const fileExists = existsSync(fullPath);

  if (!fileExists) {
    return {
      anchor_id: anchor.id,
      kind: anchor.kind,
      file_path: anchor.file_path,
      symbol_name: anchor.symbol_name,
      status: "orphaned",
      file_exists: false,
      symbol_exists: false,
      hash_matched: false,
      drift_details: `File '${anchor.file_path}' does not exist on disk`,
    };
  }

  const content = readFileSync(fullPath, "utf8");

  if (anchor.symbol_name) {
    const extracted = extractSymbolBody(content, anchor.symbol_name);
    if (!extracted.found) {
      return {
        anchor_id: anchor.id,
        kind: anchor.kind,
        file_path: anchor.file_path,
        symbol_name: anchor.symbol_name,
        status: "orphaned",
        file_exists: true,
        symbol_exists: false,
        hash_matched: false,
        drift_details: `Symbol '${anchor.symbol_name}' no longer found in '${anchor.file_path}'`,
      };
    }

    const currentHash = computeStructuralHash(extracted.body || extracted.signature || "");
    const hashMatched = anchor.structural_hash ? anchor.structural_hash === currentHash : true;

    if (!hashMatched) {
      return {
        anchor_id: anchor.id,
        kind: anchor.kind,
        file_path: anchor.file_path,
        symbol_name: anchor.symbol_name,
        status: "drifted",
        file_exists: true,
        symbol_exists: true,
        hash_matched: false,
        current_hash: currentHash,
        expected_hash: anchor.structural_hash,
        drift_details: `Structural code hash mismatch for symbol '${anchor.symbol_name}'`,
      };
    }

    return {
      anchor_id: anchor.id,
      kind: anchor.kind,
      file_path: anchor.file_path,
      symbol_name: anchor.symbol_name,
      status: "valid",
      file_exists: true,
      symbol_exists: true,
      hash_matched: true,
      current_hash: currentHash,
      expected_hash: anchor.structural_hash,
    };
  }

  // File level anchor
  const currentFileHash = computeStructuralHash(content);
  const hashMatched = anchor.structural_hash ? anchor.structural_hash === currentFileHash : true;

  if (!hashMatched) {
    return {
      anchor_id: anchor.id,
      kind: anchor.kind,
      file_path: anchor.file_path,
      status: "drifted",
      file_exists: true,
      symbol_exists: true,
      hash_matched: false,
      current_hash: currentFileHash,
      expected_hash: anchor.structural_hash,
      drift_details: `Structural code hash mismatch for file '${anchor.file_path}'`,
    };
  }

  return {
    anchor_id: anchor.id,
    kind: anchor.kind,
    file_path: anchor.file_path,
    status: "valid",
    file_exists: true,
    symbol_exists: true,
    hash_matched: true,
    current_hash: currentFileHash,
    expected_hash: anchor.structural_hash,
  };
}

/**
 * Attaches or updates a code anchor on a memory entry.
 */
export function attachAnchorToMemory(
  store: Store,
  memoryId: string,
  anchor: CodeAnchor,
  actor: string = "agent"
): MemoryEntry {
  const entry = get(store, memoryId);
  if (!entry) {
    throw new Error(`Memory entry '${memoryId}' not found in store`);
  }

  const anchors = entry.anchors || [];
  const existingIdx = anchors.findIndex((a) => a.id === anchor.id || (a.file_path === anchor.file_path && a.symbol_name === anchor.symbol_name));

  if (existingIdx >= 0) {
    anchors[existingIdx] = anchor;
  } else {
    anchors.push(anchor);
  }

  entry.anchors = anchors;
  entry.updated_at = new Date().toISOString();
  save(store, entry);

  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "anchor_created",
      entry_id: memoryId,
      project: entry.project,
      actor,
      reason: `Attached code anchor '${anchor.id}' (${anchor.file_path}${anchor.symbol_name ? `#${anchor.symbol_name}` : ""})`,
      details: anchor as any,
    });
  }

  return entry;
}

/**
 * Repository-wide audit of all code anchors across all memories in the store.
 */
export function auditMemoryAnchors(
  store: Store,
  workspaceRoot: string
): AnchorAuditReport {
  const entries = list(store);
  const details: AnchorVerificationResult[] = [];
  let validCount = 0;
  let driftedCount = 0;
  let orphanedCount = 0;

  for (const entry of entries) {
    if (!entry.anchors || entry.anchors.length === 0) continue;

    let modified = false;
    for (const anchor of entry.anchors) {
      const result = verifyCodeAnchor(workspaceRoot, anchor);
      result.memory_id = entry.id;
      details.push(result);

      if (result.status === "valid") validCount++;
      else if (result.status === "drifted") driftedCount++;
      else if (result.status === "orphaned") orphanedCount++;

      if (anchor.status !== result.status) {
        anchor.status = result.status;
        anchor.verified_at = new Date().toISOString();
        modified = true;

        if (store.memoryDir) {
          recordAuditEvent(store.memoryDir, {
            operation: result.status === "drifted" ? "anchor_drifted" : "anchor_verified",
            entry_id: entry.id,
            project: entry.project,
            actor: "audit",
            reason: result.drift_details || `Anchor status changed to ${result.status}`,
            details: result as any,
          });
        }
      }
    }

    if (modified) {
      entry.updated_at = new Date().toISOString();
      save(store, entry);
    }
  }

  const total = details.length;
  const integrityScore = total > 0 ? Number((validCount / total).toFixed(2)) : 1.0;

  return {
    total_anchors: total,
    valid_anchors: validCount,
    drifted_anchors: driftedCount,
    orphaned_anchors: orphanedCount,
    integrity_score: integrityScore,
    details,
  };
}
