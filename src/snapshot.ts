import type { Store } from "./store.ts";
import { list, save, get, extractEntryText } from "./store.ts";
import { validateEntry } from "./schema.ts";
import { scanSecrets } from "./secrets.ts";
import { recordAuditEvent } from "./audit.ts";
import type { MemoryEntry } from "./types.ts";

/**
 * Export all entries from store into a portable JSON snapshot.
 */
export function exportSnapshot(store: Store): {
  version: string;
  exported_at: string;
  total: number;
  entries: MemoryEntry[];
} {
  const entries = list(store);
  return {
    version: "1.0.0",
    exported_at: new Date().toISOString(),
    total: entries.length,
    entries,
  };
}

/**
 * Import a memory snapshot into the store with validation and secret defenses.
 */
export function importSnapshot(
  store: Store,
  snapshot: { entries: MemoryEntry[] },
  options: { overwrite?: boolean } = {},
): { imported: number; skipped: number; errors: string[] } {
  if (!snapshot || !Array.isArray(snapshot.entries)) {
    return { imported: 0, skipped: 0, errors: ["Invalid snapshot format: missing entries array"] };
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const entry of snapshot.entries) {
    const validRes = validateEntry(entry);
    if (!validRes.valid) {
      errors.push(`Validation failed for ${entry.id ?? "unknown"}: ${validRes.errors.join(", ")}`);
      continue;
    }

    const secrets = scanSecrets(extractEntryText(entry));
    if (secrets.length > 0) {
      errors.push(`Secret detected in entry ${entry.id}: ${secrets.join(", ")}`);
      continue;
    }

    const existing = get(store, entry.id);
    if (existing && !options.overwrite) {
      skipped++;
      continue;
    }

    try {
      save(store, entry);
      imported++;
    } catch (err: unknown) {
      errors.push(`Failed to save ${entry.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (imported > 0 && store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "import",
      entry_id: "snapshot_batch",
      details: { imported_count: imported, skipped_count: skipped, error_count: errors.length },
    });
  }

  return { imported, skipped, errors };
}
