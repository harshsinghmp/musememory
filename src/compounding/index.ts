import type { Store } from "../store.ts";
import { compileWiki } from "../wiki/compiler.ts";
import { extractEntitiesFromMemories, saveEntities } from "../entities/extractor.ts";
import { list } from "../store.ts";
import type { WikiCompileOptions, CompileResult } from "../wiki/types.ts";
import type { EntityExtractionResult } from "../entities/types.ts";

export * from "./cluster.ts";
export * from "../wiki/types.ts";
export * from "../entities/types.ts";

export interface CompoundingReport {
  wiki: CompileResult;
  entities: EntityExtractionResult;
}

/**
 * Unified Knowledge Compounding Engine:
 * In a single pass, clusters confirmed memories, extracts named entities,
 * and compiles both Obsidian Markdown wiki pages and the JSON co-occurrence graph.
 */
export function compileKnowledge(
  store: Store,
  memoryDir: string,
  options: WikiCompileOptions = {},
): CompoundingReport {
  // 1. Compile Obsidian Markdown wiki pages (concepts, entities, log, index)
  const wikiResult = compileWiki(store, memoryDir, options);

  // 2. Extract and persist canonical entity co-occurrence graph
  const allMemories = list(store).filter((e) => e.status === "confirmed");
  const entityResult = extractEntitiesFromMemories(allMemories);
  if (!options.dryRun) {
    saveEntities(memoryDir, entityResult);
  }

  return {
    wiki: wikiResult,
    entities: entityResult,
  };
}
