import { Store, save, get, nowIso } from "./store";
import type { MemoryEntry } from "./types";

/**
 * T-128: Check if a memory is flagged or titled as a draft.
 */
export function isDraftMemory(entry: { draft?: boolean; title?: string } | null | undefined): boolean {
  if (!entry) return false;
  return Boolean(entry.draft === true || (entry.title && entry.title.startsWith("[DRAFT]")));
}

/**
 * T-128: Ensure title begins with '[DRAFT] '.
 */
export function ensureDraftTitle(title: string): string {
  if (/^\[DRAFT\]\s*/i.test(title)) {
    return title.replace(/^\[DRAFT\]\s*/i, "[DRAFT] ");
  }
  return `[DRAFT] ${title}`;
}

/**
 * T-128: Strip '[DRAFT] ' prefix from title.
 */
export function stripDraftTitle(title: string): string {
  return title.replace(/^\[DRAFT\]\s*/i, "").trim();
}

/**
 * T-128: Promote a draft memory to an active/confirmed non-draft memory.
 * Strips the [DRAFT] prefix from the title, resets draft flag, and updates timestamp.
 */
export function promoteDraft(store: Store, id: string): MemoryEntry | null {
  const entry = get(store, id);
  if (!entry) return null;
  if (!isDraftMemory(entry)) return entry;

  entry.draft = false;
  entry.title = stripDraftTitle(entry.title);
  entry.updated_at = nowIso();
  save(store, entry);
  return entry;
}
