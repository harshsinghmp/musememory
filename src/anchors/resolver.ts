import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
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
  GroundMovedReportItem,
  CreateAnchorOptions,
} from "./types.ts";
import { computeStructuralHash, extractSymbolBody } from "./fingerprint.ts";

/** Safe slug generator for anchor ID */
function slugify(text: string): string {
  return text.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase().slice(0, 30);
}

/**
 * Resolves the actual filesystem path for an anchor, respecting its recorded base_path
 * with fallback to workspaceRoot.
 */
export function resolveAnchorPath(workspaceRoot: string, anchor: CodeAnchor): string {
  if (anchor.base_path) {
    // 1. Direct path from recorded base_path
    const candidateWithBase = resolve(anchor.base_path, anchor.file_path);
    if (existsSync(candidateWithBase)) {
      return candidateWithBase;
    }
    // 2. Relative to workspaceRoot if base_path is relative or a subpath
    const candidateRelative = resolve(workspaceRoot, anchor.base_path, anchor.file_path);
    if (existsSync(candidateRelative)) {
      return candidateRelative;
    }
  }
  return resolve(workspaceRoot, anchor.file_path);
}

/**
 * Creates a line-independent structural code anchor pointing to a file or symbol.
 */
export function createCodeAnchor(
  workspaceRoot: string,
  options: CreateAnchorOptions
): CodeAnchor {
  const effectiveBase = options.basePath ? resolve(options.basePath) : resolve(workspaceRoot);
  const fullPath = resolve(effectiveBase, options.filePath);
  const now = new Date().toISOString();
  const fileExists = existsSync(fullPath);

  const anchorId = `anc_${Date.now()}_${slugify(options.symbolName || options.filePath)}`;
  const recordedBase = options.basePath ? options.basePath : workspaceRoot;

  if (!fileExists) {
    return {
      id: anchorId,
      kind: options.kind,
      file_path: options.filePath,
      base_path: recordedBase,
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
        base_path: recordedBase,
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
      base_path: recordedBase,
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
    base_path: recordedBase,
    structural_hash: fileHash,
    status: "valid",
    provider_metadata: options.providerMetadata,
    created_at: now,
    verified_at: now,
  };
}

const IGNORED_SCAN_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".agents",
  ".memory",
  "coverage",
  ".next",
  ".turbo",
  ".gemini",
]);

const SUPPORTED_CODE_EXTS = new Set([
  ".ts",
  ".js",
  ".tsx",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
]);

/**
 * Searches workspace source files for a relocated symbol.
 */
export function findRelocatedSymbol(
  workspaceRoot: string,
  symbolName: string,
  originalPath: string,
  expectedHash?: string
): { found: boolean; relocated_path?: string; matched_hash?: boolean } {
  if (!workspaceRoot || !existsSync(workspaceRoot) || !symbolName) {
    return { found: false };
  }

  const normalizedOriginal = originalPath.replace(/\\/g, "/");
  const candidates: Array<{ path: string; hash: string }> = [];

  function scanDir(dir: string, depth = 0) {
    if (depth > 6) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORED_SCAN_DIRS.has(entry) || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        scanDir(full, depth + 1);
      } else if (stat.isFile()) {
        const dotIdx = entry.lastIndexOf(".");
        const ext = dotIdx !== -1 ? entry.slice(dotIdx).toLowerCase() : "";
        if (!SUPPORTED_CODE_EXTS.has(ext)) continue;

        const rel = relative(workspaceRoot, full).replace(/\\/g, "/");
        if (rel === normalizedOriginal) continue;

        try {
          const content = readFileSync(full, "utf8");
          const extracted = extractSymbolBody(content, symbolName);
          if (extracted.found) {
            const hash = computeStructuralHash(extracted.body || extracted.signature || "");
            candidates.push({ path: rel, hash });
          }
        } catch {}
      }
    }
  }

  scanDir(workspaceRoot);

  if (candidates.length === 0) {
    return { found: false };
  }

  // Exact hash match preferred
  if (expectedHash) {
    const exact = candidates.find((c) => c.hash === expectedHash);
    if (exact) {
      return { found: true, relocated_path: exact.path, matched_hash: true };
    }
  }

  // If exactly one candidate exists across workspace
  if (candidates.length === 1) {
    return { found: true, relocated_path: candidates[0].path, matched_hash: false };
  }

  // Multiple candidates without hash match -> ambiguous / undeterminable
  return { found: false };
}

/**
 * Verifies an existing code anchor against the actual filesystem code state.
 * T-134: Reports proven ground movements while staying strictly silent when undeterminable.
 */
export function verifyCodeAnchor(
  workspaceRoot: string,
  anchor: CodeAnchor,
  options?: { searchRelocation?: boolean }
): AnchorVerificationResult {
  const fullPath = resolveAnchorPath(workspaceRoot, anchor);
  const fileExists = existsSync(fullPath);

  if (!fileExists) {
    let groundMoved = false;
    let groundMovedDetails: string | undefined;
    let relocatedPath: string | undefined;
    let undeterminable = false;

    if (options?.searchRelocation !== false && anchor.symbol_name) {
      const rel = findRelocatedSymbol(workspaceRoot, anchor.symbol_name, anchor.file_path, anchor.structural_hash);
      if (rel.found && rel.relocated_path) {
        groundMoved = true;
        relocatedPath = rel.relocated_path;
        groundMovedDetails = `Symbol '${anchor.symbol_name}' relocated from '${anchor.file_path}' to '${rel.relocated_path}'`;
      }
    }

    if (!groundMoved) {
      if (anchor.structural_hash) {
        groundMoved = true;
        groundMovedDetails = `File '${anchor.file_path}' was removed from disk`;
      } else {
        undeterminable = true;
      }
    }

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
      ground_moved: groundMoved,
      ground_moved_details: groundMovedDetails,
      relocated_path: relocatedPath,
      undeterminable,
    };
  }

  const content = readFileSync(fullPath, "utf8");

  if (anchor.symbol_name) {
    const extracted = extractSymbolBody(content, anchor.symbol_name);
    if (!extracted.found) {
      let groundMoved = false;
      let groundMovedDetails: string | undefined;
      let relocatedPath: string | undefined;
      let undeterminable = false;

      if (options?.searchRelocation !== false) {
        const rel = findRelocatedSymbol(workspaceRoot, anchor.symbol_name, anchor.file_path, anchor.structural_hash);
        if (rel.found && rel.relocated_path) {
          groundMoved = true;
          relocatedPath = rel.relocated_path;
          groundMovedDetails = `Symbol '${anchor.symbol_name}' relocated from '${anchor.file_path}' to '${rel.relocated_path}'`;
        }
      }

      if (!groundMoved) {
        if (anchor.structural_hash) {
          groundMoved = true;
          groundMovedDetails = `Symbol '${anchor.symbol_name}' removed or renamed in '${anchor.file_path}'`;
        } else {
          undeterminable = true;
        }
      }

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
        ground_moved: groundMoved,
        ground_moved_details: groundMovedDetails,
        relocated_path: relocatedPath,
        undeterminable,
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
        ground_moved: true,
        ground_moved_details: `Structural code body changed for symbol '${anchor.symbol_name}' in '${anchor.file_path}'`,
        undeterminable: false,
      };
    }

    const undeterminable = !anchor.structural_hash;

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
      ground_moved: false,
      undeterminable,
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
      ground_moved: true,
      ground_moved_details: `Structural code changed for file '${anchor.file_path}'`,
      undeterminable: false,
    };
  }

  const undeterminable = !anchor.structural_hash;

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
    ground_moved: false,
    undeterminable,
  };
}

/**
 * Attaches or updates a code anchor on a memory entry.
 *
 * Write-time citation verification (GAP-1): the anchor is verified against the
 * live filesystem before the write is admitted. A hallucinated citation (file or
 * symbol that does not exist) rejects the write under the default `fail_fast`
 * policy. Pass `verify: false` to opt out.
 */
export function attachAnchorToMemory(
  store: Store,
  memoryId: string,
  anchor: CodeAnchor,
  actor: string = "agent",
  options: { verify?: boolean; verification_policy?: "fail_fast" | "warn" | "strict"; workspaceRoot?: string } = {}
): MemoryEntry {
  const entry = get(store, memoryId);
  if (!entry) {
    throw new Error(`Memory entry '${memoryId}' not found in store`);
  }

  // Write-time citation verification: reject hallucinated citations before storage.
  if (options.verify !== false) {
    const { enforceWriteTimeVerification, formatRejectionError } = require("./verify-write.ts");
    // Canonical workspace root from the store layout; callers may override.
    const workspaceRoot = options.workspaceRoot ?? store.layout?.root ?? (store.memoryDir ? resolve(store.memoryDir, "..") : process.cwd());
    const probe: MemoryEntry = { ...entry, anchors: [anchor] };
    const result = enforceWriteTimeVerification(store, workspaceRoot, probe, {
      policy: options.verification_policy ?? "fail_fast",
    });
    if (!result.admitted) {
      throw new Error(formatRejectionError(result));
    }
    // Adopt the verified anchor (fresh status/hash/verified_at stamps).
    const verified = probe.anchors?.[0];
    if (verified) anchor = verified;
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
  let groundMovedCount = 0;
  let undeterminableCount = 0;

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

      if (result.ground_moved) groundMovedCount++;
      if (result.undeterminable) undeterminableCount++;

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

  const groundMovedReports: GroundMovedReportItem[] = details
    .filter((d) => d.ground_moved)
    .map((d) => ({
      anchor_id: d.anchor_id,
      memory_id: d.memory_id,
      file_path: d.file_path,
      symbol_name: d.symbol_name,
      details: d.ground_moved_details || d.drift_details || "Ground movement detected",
      relocated_path: d.relocated_path,
    }));

  return {
    total_anchors: total,
    valid_anchors: validCount,
    drifted_anchors: driftedCount,
    orphaned_anchors: orphanedCount,
    ground_moved_anchors: groundMovedCount,
    undeterminable_anchors: undeterminableCount,
    integrity_score: integrityScore,
    details,
    ground_moved_reports: groundMovedReports.length > 0 ? groundMovedReports : undefined,
  };
}

/**
 * Formats an anchor audit report into clean Markdown, surfacing proven ground movements
 * while staying strictly silent on undeterminable anchors to prevent false alarms.
 */
export function formatAnchorAuditReport(report: AnchorAuditReport): string {
  const lines: string[] = [
    "# ⚓ Code Anchor Audit & Integrity Report",
    `> Total Anchors: ${report.total_anchors} | Valid: ${report.valid_anchors} | Drifted: ${report.drifted_anchors} | Orphaned: ${report.orphaned_anchors} | Ground-Moved: ${report.ground_moved_anchors} | Integrity Score: ${Math.round(report.integrity_score * 100)}%`,
    "",
  ];

  if (report.ground_moved_reports && report.ground_moved_reports.length > 0) {
    lines.push("## 🚨 Proven Ground-Moved Code Anchors");
    for (const g of report.ground_moved_reports) {
      const sym = g.symbol_name ? ` (symbol: \`${g.symbol_name}\`)` : "";
      const rel = g.relocated_path ? ` -> Relocated to: \`${g.relocated_path}\`` : "";
      lines.push(`- **[${g.anchor_id}] ${g.file_path}${sym}**: ${g.details}${rel}`);
    }
    lines.push("");
  }

  if (report.undeterminable_anchors > 0) {
    lines.push(
      `> ℹ️ _Silent Guard: ${report.undeterminable_anchors} anchor(s) had undeterminable baseline hashes; stayed silent without false alarms._`,
      ""
    );
  }

  return lines.join("\n");
}

