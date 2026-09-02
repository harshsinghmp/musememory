import type { Store } from "../store.ts";
import { save } from "../store.ts";
import type { MemoryEntry, EvidenceItem } from "../types.ts";
import { defaultRegistry } from "./registry.ts";

/**
 * Optionally enriches a memory entry with code intelligence evidence
 * (symbol definitions, source files, and caller graphs) without modifying core content.
 */
export async function enrichMemoryWithCodeIntel(
  store: Store,
  memory: MemoryEntry,
  workspaceDir?: string,
): Promise<MemoryEntry> {
  const dir = workspaceDir || store.dir;
  if (!dir) return memory;

  // Extract possible symbol tokens from title and tags
  const tokens = new Set<string>();
  for (const tag of memory.tags ?? []) {
    if (tag.length > 3 && !tag.includes("-")) tokens.add(tag);
  }

  const titleWords = memory.title.split(/[\s:()[\],.`'"]+/).filter((w) => w.length > 3);
  for (const word of titleWords) {
    if (/^[A-Za-z0-9_$]+$/.test(word)) tokens.add(word);
  }

  const newEvidence: EvidenceItem[] = [];

  for (const token of Array.from(tokens).slice(0, 5)) {
    try {
      const symbols = await defaultRegistry.resolveSymbolsWithFallback(token, dir);
      for (const sym of symbols.slice(0, 3)) {
        newEvidence.push({
          id: `ev_intel_${Date.now()}_${sym.name}`,
          type: "code_intelligence",
          source: sym.file,
          timestamp: new Date().toISOString(),
          excerpt: `${sym.name} (${sym.kind}) at line ${sym.line ?? 1}`,
          confidence: 0.85,
        });
      }
    } catch {
      // Never crash enrichment on provider failure
    }
  }

  if (newEvidence.length > 0) {
    const existing = memory.evidence ?? [];
    const seenSources = new Set(existing.map((e) => `${e.source}:${e.excerpt}`));
    const deduplicated = [...existing];

    for (const ev of newEvidence) {
      const key = `${ev.source}:${ev.excerpt}`;
      if (!seenSources.has(key)) {
        deduplicated.push(ev);
        seenSources.add(key);
      }
    }

    memory.evidence = deduplicated;
    memory.updated_at = new Date().toISOString();
    save(store, memory);
  }

  return memory;
}
