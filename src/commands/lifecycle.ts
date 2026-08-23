import { propose, supersede, confirm, link, markStale, reject, deleteEntry, type Store } from "../store.ts";
import type { MemoryEntry, MemoryType } from "../types.ts";

/** Shared lifecycle command core. Adapters (CLI/MCP) parse input and format output; this module owns behavior. */

export interface ProposeMemoryParams {
  content: string;
  project: string;
  title?: string;
  tags?: string[];
  type?: MemoryType;
  confirmed?: boolean;
  salience?: number;
}

const STORE_SECRET_PREFIX = "Probable secret detected:";

/**
 * Create a new memory entry via store.propose() (secret scanning happens inside).
 * Throws on invalid input or probable secret with the canonical adapter-facing message.
 */
export function proposeMemory(store: Store, params: ProposeMemoryParams): MemoryEntry {
  try {
    return propose(store, params);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith(STORE_SECRET_PREFIX)) {
      throw new Error(`probable secret detected:${msg.slice(STORE_SECRET_PREFIX.length)}`);
    }
    throw err;
  }
}

/**
 * Supersede oldId by newId (newId must exist and be confirmed).
 * Throws with the canonical message when the transition is impossible.
 */
export function supersedeMemory(
  store: Store,
  { oldId, newId }: { oldId: string; newId: string },
): MemoryEntry {
  const updated = supersede(store, oldId, newId);
  if (!updated) {
    throw new Error(`could not supersede ${oldId} with ${newId} (missing entry or target not confirmed)`);
  }
  return updated;
}

/** candidate/disputed/stale -> confirmed. Throws when entry missing or transition invalid. */
export function confirmMemory(store: Store, id: string): MemoryEntry {
  const entry = confirm(store, id);
  if (!entry) throw new Error(`could not confirm ${id} (not found or invalid status transition)`);
  return entry;
}

/** Two-way link. Throws when either side is missing. */
export function linkMemory(store: Store, id: string, relatedIds: string[]): MemoryEntry {
  const entry = link(store, id, relatedIds);
  if (!entry) throw new Error(`could not link ${id} (missing id or related id)`);
  return entry;
}

/** Mark stale with optional reason. Throws when entry missing. */
export function markStaleMemory(store: Store, id: string, reason?: string): MemoryEntry {
  const entry = markStale(store, id, reason);
  if (!entry) throw new Error(`no entry with id ${id}`);
  return entry;
}

/** Reject an entry. Throws when entry missing. */
export function rejectMemory(store: Store, id: string): MemoryEntry {
  const entry = reject(store, id);
  if (!entry) throw new Error(`no entry with id ${id}`);
  return entry;
}

/** Permanently delete with audit trail. Throws when entry missing. */
export function deleteMemory(store: Store, id: string, reason?: string, actor?: string): true {
  const ok = deleteEntry(store, id, reason, actor);
  if (!ok) throw new Error(`no entry found with id ${id}`);
  return true;
}
