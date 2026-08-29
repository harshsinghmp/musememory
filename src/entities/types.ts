import type { MemoryEntry } from "../types.ts";

export type EntityType = "person" | "product" | "organization" | "file" | "concept";

export interface Entity {
  id: string;                    // slugified name
  name: string;                  // Display name
  type: EntityType;
  aliases: string[];
  project?: string;
  memoryRefs: string[];           // Memories mentioning this entity
  relatedEntities: {             // Co-occurrence relationships
    entityId: string;
    strength: number;            // Co-occurrence count
  }[];
  metadata: {
    firstSeen: string;
    lastSeen: string;
    mentionCount: number;
  };
}

export interface EntityExtractionResult {
  entities: Entity[];
  memoryEntityMap: Map<string, string[]>;  // memoryId -> entityIds
}

export interface EntityExtractionConfig {
  enabledTypes?: EntityType[];
  minMentionsForPage?: number;
  cooccurrenceThreshold?: number;
  customPatterns?: Record<string, RegExp[]>;
  aliasMap?: Record<string, string>;
}
