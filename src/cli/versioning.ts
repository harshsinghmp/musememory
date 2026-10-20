/**
 * R23: Versioning CLI commands — memory branch, checkout, and blame.
 *
 * These commands implement Git-like version control semantics over memories:
 * - branch: Tag a memory as a named variant (creates a branch reference)
 * - checkout: Retrieve a memory at a specific path/version
 * - blame: Show access history and modification metadata for a memory
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { get, nowIso, type Store } from "../store.ts";
import { requireRoot, printEntry, usageError, fail, type ParsedArgs } from "./shared.ts";
import { getAuditTrail } from "../audit.ts";
import { computeStaleness, stalenessDaysRemaining } from "../retention.ts";
import type { MemoryEntry } from "../types.ts";

/** Branch reference files are stored as JSON in .memory/branches/ */
const BRANCHES_DIR = "branches";

interface BranchRef {
  id: string;
  mem_path: string;
  created_at: string;
  created_by: string;
  label?: string;
}

function branchFilePath(memoryDir: string, memPath: string): string {
  const safePath = memPath.replace(/[^a-z0-9.-]/gi, "_").slice(0, 80);
  return join(memoryDir, BRANCHES_DIR, `${safePath}.json`);
}

function loadBranch(store: Store, memPath: string): BranchRef | null {
  if (!store.memoryDir) return null;
  try {
    return JSON.parse(readFileSync(branchFilePath(store.memoryDir, memPath), "utf8")) as BranchRef;
  } catch {
    return null;
  }
}

function saveBranch(store: Store, ref: BranchRef): void {
  if (!store.memoryDir) return;
  const dir = join(store.memoryDir, BRANCHES_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(branchFilePath(store.memoryDir, ref.mem_path), JSON.stringify(ref, null, 2), "utf8");
}

/**
 * `memory branch <id> --path <mem_path> [--label <label>]`
 * Tag a memory as a named variant using semantic dotted-path addressing.
 */
export async function handleBranchCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;

  const id = positional[0];
  if (!id) return usageError("branch requires <id>");

  const memPath = flags["path"];
  if (!memPath) return usageError("branch requires --path <mem_path>");

  const entry = get(ctx.store, id);
  if (!entry) return fail(`no entry with id ${id}`);

  const ref: BranchRef = {
    id,
    mem_path: memPath,
    created_at: nowIso(),
    created_by: "cli_user",
    label: flags["label"],
  };

  saveBranch(ctx.store, ref);
  console.log(`branched memory ${id} -> ${memPath}`);
  if (ref.label) console.log(`  label: ${ref.label}`);
  return 0;
}

/**
 * `memory checkout <path>`
 * Retrieve a memory by its semantic dotted-path (mem_path), or by ID.
 */
export async function handleCheckoutCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;

  const target = positional[0];
  if (!target) return usageError("checkout requires <path>");

  // First try: treat as a mem_path branch reference
  const branchRef = loadBranch(ctx.store, target);
  if (branchRef) {
    const entry = get(ctx.store, branchRef.id);
    if (entry) {
      console.log(`checked out branch '${target}' -> ${entry.id}`);
      printEntry(entry);
      return 0;
    }
  }

  // Second try: treat as an entry ID
  const entry = get(ctx.store, target);
  if (entry) {
    printEntry(entry);
    return 0;
  }

  // Third try: search by mem_path in SQLite
  if (ctx.store.db) {
    const results = ctx.store.db
      .query<MemoryEntry>(`SELECT * FROM memories WHERE mem_path = ?`)
      .all([target]);
    if (results && results.length > 0) {
      for (const r of results) printEntry(r);
      return 0;
    }
  }

  return fail(`no memory found for path/id: ${target}`);
}

/**
 * `memory blame <id>`
 * Show access history, modification metadata, and staleness info for a memory.
 */
export async function handleBlameCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;

  const id = positional[0];
  if (!id) return usageError("blame requires <id>");

  const entry = get(ctx.store, id);
  if (!entry) return fail(`no entry with id ${id}`);

  const now = Date.now();
  const staleness = computeStaleness(entry, now);
  const daysRemaining = stalenessDaysRemaining(entry, now);

  console.log(`[BLAME] ${entry.id} (${entry.project})`);
  console.log(`  title: ${entry.title}`);
  console.log(`  status: ${entry.status}`);
  console.log(`  type: ${entry.type}`);
  if (entry.mem_path) console.log(`  mem_path: ${entry.mem_path}`);
  console.log(`  created_at: ${entry.created_at}`);
  console.log(`  updated_at: ${entry.updated_at}`);
  console.log(`  last_accessed_at: ${entry.last_accessed_at ?? "(never)"}`);
  console.log(`  access_count: ${entry.access_count ?? 0}`);
  console.log(`  reinforcement: ${entry.reinforcement ?? 0}`);
  if (entry.verification?.level) {
    console.log(`  verification: ${entry.verification.level}`);
  }
  if (entry.graph?.symbol_names?.length) {
    console.log(`  graph symbols: ${entry.graph.symbol_names.join(", ")}`);
  }
  console.log(`  staleness score: ${staleness.toFixed(3)} (0=fresh, 1=stale)`);
  if (daysRemaining === Infinity) {
    console.log(`  days to staleness threshold: never (indefinite retention)`);
  } else {
    console.log(`  days to staleness threshold: ${daysRemaining}`);
  }

  // Show audit trail for this entry
  const trail = getAuditTrail(ctx.memoryDir, { entryId: entry.id, limit: 20 });
  if (trail.length > 0) {
    console.log(`  audit trail (${trail.length} events):`);
    for (const r of trail) {
      const details = r.details ? ` ${JSON.stringify(r.details)}` : "";
      console.log(`    - [${r.timestamp}] ${r.operation} actor=${r.actor ?? "unknown"}${details}`);
    }
  }

  return 0;
}

/**
 * `memory ls-branches [--project P]`
 * List all branch references.
 */
export async function handleLsBranchesCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;

  if (!ctx.store.memoryDir) {
    console.log("no branches found");
    return 0;
  }

  const branchesDir = join(ctx.store.memoryDir, BRANCHES_DIR);
  if (!existsSync(branchesDir)) {
    console.log("no branches found");
    return 0;
  }

  const files = readdirSync(branchesDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("no branches found");
    return 0;
  }

  console.log(`branches in ${ctx.memoryDir}:`);
  for (const f of files) {
    try {
      const ref = JSON.parse(readFileSync(join(branchesDir, f), "utf8")) as BranchRef;
      console.log(`  ${ref.mem_path} -> ${ref.id}${ref.label ? ` [${ref.label}]` : ""}`);
    } catch {
      // skip unparseable
    }
  }
  return 0;
}
