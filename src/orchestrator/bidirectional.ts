import type { Store } from "../store.ts";
import { get, list } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import type { CodeForMemoryResult, MemoryForCodeResult } from "./types.ts";
import { resolveMemoriesForCode } from "../retrieval/code_context.ts";

/**
 * Given a memory ID, returns all anchored code references, files, and symbols.
 */
export function resolveCodeForMemory(
  store: Store,
  memoryId: string
): CodeForMemoryResult {
  const entry = get(store, memoryId);
  if (!entry) {
    throw new Error(`Memory entry '${memoryId}' not found in store`);
  }

  const anchors = entry.anchors || [];
  const referencedFiles = new Set<string>();
  const referencedSymbols = new Set<string>();

  for (const anc of anchors) {
    if (anc.file_path) referencedFiles.add(anc.file_path);
    if (anc.symbol_name) referencedSymbols.add(anc.symbol_name);
  }

  // Also extract backtick references from text (`src/foo/bar.ts` or `funcName()`)
  const codeSpanRegex = /`([^`]+)`/g;
  let match: RegExpExecArray | null;

  while ((match = codeSpanRegex.exec(entry.content)) !== null) {
    const span = match[1].trim();
    if (span.includes("/") || span.endsWith(".ts") || span.endsWith(".js") || span.endsWith(".py")) {
      referencedFiles.add(span);
    } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*(\(\))?$/.test(span)) {
      referencedSymbols.add(span.replace("()", ""));
    }
  }

  return {
    memory_id: entry.id,
    title: entry.title,
    anchors,
    referenced_files: Array.from(referencedFiles),
    referenced_symbols: Array.from(referencedSymbols),
  };
}

/**
 * Given a file path, symbol, or anchor, returns all associated memories, decisions, fixes, and negative lessons.
 */
export function resolveMemoryForCode(
  store: Store,
  options: { filePath: string; symbolName?: string; project?: string }
): MemoryForCodeResult {
  // W26-1: shared resolver. PR context keeps prose mentions and untrusted
  // entries for a superset view, but matching/ranking lives in one place.
  const matches = resolveMemoriesForCode(store, {
    files: [options.filePath],
    symbols: options.symbolName ? [options.symbolName] : undefined,
    project: options.project,
    includeMentions: true,
    includeUntrusted: true,
    enforceFreshness: false,
    limit: 50,
  });

  const associated: MemoryEntry[] = [];
  const negative: MemoryEntry[] = [];
  const constraints: MemoryEntry[] = [];

  for (const { entry } of matches) {
    if (entry.negative != null || entry.tags?.some((t) => t.includes("negative") || t.includes("anti-pattern"))) {
      negative.push(entry);
    } else if (entry.type === "constraint" || entry.temporal_mode === "timeless") {
      constraints.push(entry);
    } else {
      associated.push(entry);
    }
  }


  return {
    file_path: options.filePath,
    symbol_name: options.symbolName,
    associated_memories: associated,
    negative_lessons: negative,
    constraints,
    total_found: associated.length + negative.length + constraints.length,
  };
}
