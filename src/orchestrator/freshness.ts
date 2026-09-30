import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Store } from "../store.ts";
import type { MemoryEntry, CodeAnchor, AnchorStatus } from "../types.ts";
import { computeStructuralHash, extractSymbolBody } from "../anchors/fingerprint.ts";

/**
 * Recall-Time Freshness Gate (GAP-3)
 *
 * Kage-pattern recall gate: memories whose code anchors no longer match the live
 * filesystem are WITHHELD from fused context by default instead of merely being
 * down-ranked. Muse already verifies at write time (see verify-write.ts); this
 * gate closes the loop at recall time, because code moves *after* a memory is
 * stored too.
 *
 * Design constraints (Muse invariants):
 *  - Zero-daemon, in-process: verifies anchors directly against the filesystem.
 *  - Sub-millisecond recall: verification is memoized per (path, symbol, mtime)
 *    within a single gate instance, so a repo-hot recall pass reads each file at
 *    most once, and untouched stores can answer from cached statuses.
 *
 * A withheld memory is reported in `freshness.withheld` (id + reason), never
 * silently dropped. With `include_drifted: true`, drifted memories come back
 * WITH an explicit provenance warning appended to their content (deja-vu
 * pattern: "4 files this session touched have changed since") — surfaced, never
 * silently served as truth.
 */

export interface FreshnessVerdict {
  memory_id: string;
  anchor_id: string;
  file_path: string;
  symbol_name?: string;
  status: AnchorStatus;
  reason: string;
}

export interface FreshnessGateResult {
  /** Memories safe to serve: no anchors, or all anchors verified valid. */
  fresh: MemoryEntry[];
  /** Withheld memories with the exact reason (never silent). */
  withheld: FreshnessVerdict[];
  /** Memories included despite drift, each carrying a freshness_warning field. */
  warned: Array<MemoryEntry & { freshness_warning?: string }>;
  /** Stats for telemetry / the observability studio. */
  stats: {
    checked: number;
    files_read: number;
    withheld: number;
    drifted: number;
    duration_ms: number;
  };
}

export interface FreshnessGateOptions {
  /** true (default): drifted/orphaned-anchor memories are withheld. */
  enforce?: boolean;
  /** When enforce=false or on explicit opt-in, include drifted with warnings. */
  include_drifted?: boolean;
  /** Override liveness check (used by tests to freeze time). */
  now?: number;
}

/** Per-process cache: path+symbol+mtime+hash -> verdict. Survives across calls. */
const verdictCache = new Map<string, AnchorStatus>();

function cacheKey(fullPath: string, symbol: string | undefined, mtimeMs: number): string {
  return `${fullPath}::${symbol ?? "*"}::${mtimeMs}`;
}

interface AnchorCheckFast {
  status: AnchorStatus;
  reason?: string;
}

/** Lightweight anchor liveness check (file exists? symbol exists? hash drift?). */
function checkAnchorLive(workspaceRoot: string, anchor: CodeAnchor): AnchorCheckFast {
  const fullPath = resolve(workspaceRoot, anchor.file_path);

  let mtimeMs = 0;
  try {
    mtimeMs = statSync(fullPath).mtimeMs;
  } catch {
    return {
      status: "orphaned",
      reason: `cited file '${anchor.file_path}' no longer exists`,
    };
  }

  const key = cacheKey(fullPath, anchor.symbol_name, mtimeMs);
  const cached = verdictCache.get(key);
  if (cached) return { status: cached };

  let status: AnchorStatus;
  let reason: string | undefined;

  const content = readFileSync(fullPath, "utf8");

  if (anchor.symbol_name) {
    const extracted = extractSymbolBody(content, anchor.symbol_name);
    if (!extracted.found) {
      status = "orphaned";
      reason = `cited symbol '${anchor.symbol_name}' no longer exists in '${anchor.file_path}'`;
    } else if (anchor.structural_hash) {
      const currentHash = computeStructuralHash(extracted.body || extracted.signature || "");
      status = currentHash === anchor.structural_hash ? "valid" : "drifted";
      if (status === "drifted") {
        reason = `code body for '${anchor.symbol_name}' changed since this memory was written`;
      }
    } else {
      status = "valid";
    }
  } else if (anchor.structural_hash) {
    const currentHash = computeStructuralHash(content);
    status = currentHash === anchor.structural_hash ? "valid" : "drifted";
    if (status === "drifted") {
      reason = `file '${anchor.file_path}' changed since this memory was written`;
    }
  } else {
    status = "valid";
  }

  verdictCache.set(key, status);
  return { status, reason };
}

/** Worst-status rollup across a memory's anchors. */
function worstStatus(statuses: AnchorStatus[]): AnchorStatus {
  if (statuses.includes("orphaned")) return "orphaned";
  if (statuses.includes("drifted")) return "drifted";
  return "valid";
}

/**
 * Splits a candidate memory pool into fresh / withheld / warned-by-drift,
 * verifying anchors against the live workspace with per-file memoization.
 */
export function applyFreshnessGate(
  store: Store,
  workspaceRoot: string,
  candidates: MemoryEntry[],
  options: FreshnessGateOptions = {},
): FreshnessGateResult {
  const enforce = options.enforce ?? true;
  const includeDrifted = options.include_drifted ?? false;
  const started = options.now ?? Date.now();

  const fresh: MemoryEntry[] = [];
  const withheld: FreshnessVerdict[] = [];
  const warned: Array<MemoryEntry & { freshness_warning?: string }> = [];
  let filesRead = 0;

  for (const entry of candidates) {
    // Memories without code anchors are always fresh — nothing to verify.
    if (!entry.anchors || entry.anchors.length === 0) {
      fresh.push(entry);
      continue;
    }

    const statuses: AnchorStatus[] = [];
    const reasons: string[] = [];
    let worst: AnchorStatus = "valid";

    for (const anchor of entry.anchors) {
      const before = verdictCache.size;
      const check = checkAnchorLive(workspaceRoot, anchor);
      if (verdictCache.size > before) filesRead++;
      statuses.push(check.status);
      if (check.reason) reasons.push(check.reason);
    }

    worst = worstStatus(statuses);

    if (worst === "valid") {
      fresh.push(entry);
      continue;
    }

    const verdict: FreshnessVerdict = {
      memory_id: entry.id,
      anchor_id: entry.anchors[0].id,
      file_path: entry.anchors[0].file_path,
      symbol_name: entry.anchors[0].symbol_name,
      status: worst,
      reason: reasons.join("; ") || `anchor ${worst}`,
    };

    if (enforce && !includeDrifted) {
      withheld.push(verdict);
      continue;
    }

    // Opt-in inclusion: serve with an explicit provenance warning, never silent.
    const warning =
      worst === "orphaned"
        ? `⚠ FRESHNESS: ${verdict.reason} — this memory may be outdated.`
        : `⚠ FRESHNESS: ${verdict.reason} — verify against current code before relying on it.`;
    warned.push({ ...entry, freshness_warning: warning });
  }

  return {
    fresh,
    withheld,
    warned,
    stats: {
      checked: candidates.length,
      files_read: filesRead,
      withheld: withheld.length,
      drifted: warned.length,
      duration_ms: Date.now() - started,
    },
  };
}

/** Test hook: clear the per-process verdict cache. */
export function clearFreshnessCache(): void {
  verdictCache.clear();
}

/**
 * Builds the provenance block appended to fused context when memories were
 * withheld — visible accountability instead of silent drops.
 */
export function formatWithheldNotice(result: FreshnessGateResult): string | null {
  if (result.withheld.length === 0) return null;
  const lines = result.withheld.slice(0, 3).map((w) => {
    const loc = `${w.file_path}${w.symbol_name ? `#${w.symbol_name}` : ""}`;
    return `- ${w.memory_id}: ${w.reason} (${loc})`;
  });
  const extra = result.withheld.length > 3 ? ` (+${result.withheld.length - 3} more)` : "";
  return `🛡 Freshness gate withheld ${result.withheld.length} memor${result.withheld.length === 1 ? "y" : "ies"} whose code citations no longer match the workspace:\n${lines.join("\n")}${extra}`;
}

/**
 * Convenience wrapper for the orchestrator: gate a candidate pool and return
 * the entries to pack plus an optional withheld notice.
 */
export function gateCandidates(
  store: Store,
  workspaceRoot: string,
  candidates: MemoryEntry[],
  options: FreshnessGateOptions = {},
): {
  entries: MemoryEntry[];
  withheld: FreshnessVerdict[];
  withheldNotice: string | null;
  stats: FreshnessGateResult["stats"];
} {
  const result = applyFreshnessGate(store, workspaceRoot, candidates, options);
  const entries = [...result.fresh, ...(options.include_drifted ? result.warned : [])];
  return {
    entries,
    withheld: result.withheld,
    withheldNotice: formatWithheldNotice(result),
    stats: result.stats,
  };
}
