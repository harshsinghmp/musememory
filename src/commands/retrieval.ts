import { extractHarvestUnits } from "../harvest.ts";
import type { Store } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import { proposeMemory } from "./lifecycle.ts";

/** Shared retrieval-domain command core. */

export interface HarvestMemoryParams {
  text: string;
  project: string;
  confirmed?: boolean;
}

/**
 * Distill text into structured harvest units and propose each as a memory entry
 * (secret scanning via store.propose inside proposeMemory). Units that fail to
 * propose (e.g. probable secret) are skipped; survivors returned.
 */
export function harvestMemory(store: Store, { text, project, confirmed }: HarvestMemoryParams): MemoryEntry[] {
  const units = extractHarvestUnits(text);
  const created: MemoryEntry[] = [];
  for (const u of units) {
    try {
      created.push(
        proposeMemory(store, {
          content: u.content,
          project,
          title: u.title,
          tags: u.tags,
          type: u.type,
          confirmed: confirmed === true,
          salience: u.salience,
        }),
      );
    } catch {
      // skip units that cannot be proposed
    }
  }
  return created;
}
