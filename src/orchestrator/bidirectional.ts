import type { Store } from "../store.ts";
import { get, list } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import type { CodeForMemoryResult, MemoryForCodeResult } from "./types.ts";

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
  options: { filePath: string; symbolName?: string }
): MemoryForCodeResult {
  const allEntries = list(store);
  const normalizedFile = options.filePath.toLowerCase();
  const normalizedSymbol = options.symbolName ? options.symbolName.toLowerCase() : undefined;

  const associated: MemoryEntry[] = [];
  const negative: MemoryEntry[] = [];
  const constraints: MemoryEntry[] = [];

  for (const entry of allEntries) {
    if (entry.status === "archived" || entry.status === "superseded") continue;

    let isMatch = false;

    // 1. Check native code anchors
    if (entry.anchors && entry.anchors.length > 0) {
      for (const anc of entry.anchors) {
        const ancFile = anc.file_path.toLowerCase();
        const fileMatch = ancFile.includes(normalizedFile) || normalizedFile.includes(ancFile);
        const symbolMatch =
          normalizedSymbol && anc.symbol_name
            ? anc.symbol_name.toLowerCase() === normalizedSymbol
            : false;

        if (fileMatch || symbolMatch) {
          isMatch = true;
          break;
        }
      }
    }

    // 2. Check content or title references if not already matched
    if (!isMatch) {
      const lowerContent = `${entry.title} ${entry.content}`.toLowerCase();
      if (lowerContent.includes(normalizedFile)) {
        isMatch = true;
      } else if (normalizedSymbol && lowerContent.includes(normalizedSymbol)) {
        isMatch = true;
      }
    }

    if (isMatch) {
      if (entry.negative != null || entry.tags?.some((t) => t.includes("negative") || t.includes("anti-pattern"))) {
        negative.push(entry);
      } else if (entry.type === "constraint" || entry.temporal_mode === "timeless") {
        constraints.push(entry);
      } else {
        associated.push(entry);
      }
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
