import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryEntry } from "../types.ts";
import type { Entity, EntityType, EntityExtractionResult, EntityExtractionConfig } from "./types.ts";

export const DEFAULT_ENTITY_PATTERNS = {
  person: [
    /@([a-zA-Z0-9_-]+)/g,
    /\b(?:authored|reviewed|fixed|reported by)\s+([a-zA-Z0-9_-]+)/gi,
  ],
  product: [
    /\b(?:Next\.js|React|TypeScript|Node\.js|Bun|Vercel|Anthropic|OpenAI|PostgreSQL|Redis|Docker|Kubernetes|GraphQL|REST|gRPC|WebAssembly|WASM|Tailwind|ESLint|Prettier|Jest|Vitest|Playwright|Cypress)\b/gi,
    /\b[a-zA-Z0-9_-]+\.js\b/gi,
  ],
  organization: [
    /\b(?:Vercel|Anthropic|OpenAI|Google|Microsoft|GitHub|GitLab|AWS|GCP|Azure|Meta|Facebook|Amazon|Netflix|Shopify|Stripe|Supabase|PlanetScale|Neon|Turso)\b/gi,
  ],
  file: [
    /(?:src|lib|test|docs|scripts)\/[a-zA-Z0-9_\/\.-]+\.(?:ts|tsx|js|jsx|json|yaml|yml|md|mdx)/g,
    /\b(?:package\.json|tsconfig\.json|eslint\.config|prettier\.config)\b/gi,
  ],
  concept: [
    /\b(?:tree-indexed retrieval|wiki compilation|knapsack budgeting|progressive disclosure|semantic reasoning|vector search|BM25|hybrid search|entity extraction|memory lifecycle|consolidation|distillation)\b/gi,
  ],
};

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function extractEntitiesFromMemories(
  memories: MemoryEntry[],
  config: EntityExtractionConfig = {},
): EntityExtractionResult {
  const enabledTypes = new Set<EntityType>(
    config.enabledTypes ?? ["person", "product", "organization", "file", "concept"],
  );
  const aliasMap = config.aliasMap ?? {};
  const cooccurrenceThreshold = config.cooccurrenceThreshold ?? 1;

  const entityMap = new Map<string, Entity>();
  const memoryEntityMap = new Map<string, string[]>();

  for (const memory of memories) {
    const text = `${memory.title} ${memory.content} ${(memory.tags ?? []).join(" ")}`;
    const foundInThisMemory = new Map<string, { name: string; type: EntityType }>();

    // 1. Extract Person
    if (enabledTypes.has("person")) {
      for (const pattern of DEFAULT_ENTITY_PATTERNS.person) {
        const matches = text.matchAll(new RegExp(pattern));
        for (const match of matches) {
          const raw = match[1] ?? match[0];
          const name = raw.replace(/^@/, "").trim();
          if (name.length > 1) {
            const slug = slugify(aliasMap[name.toLowerCase()] ?? name);
            if (slug) foundInThisMemory.set(slug, { name, type: "person" });
          }
        }
      }
    }

    // 2. Extract Product
    if (enabledTypes.has("product")) {
      for (const pattern of DEFAULT_ENTITY_PATTERNS.product) {
        const matches = text.matchAll(new RegExp(pattern));
        for (const match of matches) {
          const raw = match[0].trim();
          if (raw.length > 1) {
            const slug = slugify(aliasMap[raw.toLowerCase()] ?? raw);
            if (slug) foundInThisMemory.set(slug, { name: raw, type: "product" });
          }
        }
      }
    }

    // 3. Extract Organization
    if (enabledTypes.has("organization")) {
      for (const pattern of DEFAULT_ENTITY_PATTERNS.organization) {
        const matches = text.matchAll(new RegExp(pattern));
        for (const match of matches) {
          const raw = match[0].trim();
          if (raw.length > 1) {
            const slug = slugify(aliasMap[raw.toLowerCase()] ?? raw);
            if (slug) foundInThisMemory.set(slug, { name: raw, type: "organization" });
          }
        }
      }
    }

    // 4. Extract File
    if (enabledTypes.has("file")) {
      for (const pattern of DEFAULT_ENTITY_PATTERNS.file) {
        const matches = text.matchAll(new RegExp(pattern));
        for (const match of matches) {
          const raw = match[0].trim();
          if (raw.length > 1) {
            const slug = slugify(raw);
            if (slug) foundInThisMemory.set(slug, { name: raw, type: "file" });
          }
        }
      }
    }

    // 5. Extract Concept
    if (enabledTypes.has("concept")) {
      for (const pattern of DEFAULT_ENTITY_PATTERNS.concept) {
        const matches = text.matchAll(new RegExp(pattern));
        for (const match of matches) {
          const raw = match[0].trim();
          if (raw.length > 1) {
            const slug = slugify(aliasMap[raw.toLowerCase()] ?? raw);
            if (slug) foundInThisMemory.set(slug, { name: raw, type: "concept" });
          }
        }
      }
    }

    const memoryEntitySlugs: string[] = [];
    const memoryTime = memory.created_at || new Date().toISOString();

    for (const [slug, { name, type }] of foundInThisMemory) {
      memoryEntitySlugs.push(slug);
      const existing = entityMap.get(slug);
      if (existing) {
        if (!existing.memoryRefs.includes(memory.id)) {
          existing.memoryRefs.push(memory.id);
        }
        existing.metadata.mentionCount++;
        if (memoryTime > existing.metadata.lastSeen) existing.metadata.lastSeen = memoryTime;
        if (memoryTime < existing.metadata.firstSeen) existing.metadata.firstSeen = memoryTime;
      } else {
        entityMap.set(slug, {
          id: slug,
          name,
          type,
          aliases: [name.toLowerCase()],
          project: memory.project,
          memoryRefs: [memory.id],
          relatedEntities: [],
          metadata: {
            firstSeen: memoryTime,
            lastSeen: memoryTime,
            mentionCount: 1,
          },
        });
      }
    }

    memoryEntityMap.set(memory.id, memoryEntitySlugs);
  }

  // Compute co-occurrences between entities across memories
  const cooccurrences = new Map<string, Map<string, number>>();
  for (const [, entitySlugs] of memoryEntityMap) {
    for (let i = 0; i < entitySlugs.length; i++) {
      for (let j = i + 1; j < entitySlugs.length; j++) {
        const a = entitySlugs[i];
        const b = entitySlugs[j];
        if (a === b) continue;

        if (!cooccurrences.has(a)) cooccurrences.set(a, new Map());
        if (!cooccurrences.has(b)) cooccurrences.set(b, new Map());

        const mapA = cooccurrences.get(a)!;
        const mapB = cooccurrences.get(b)!;

        mapA.set(b, (mapA.get(b) ?? 0) + 1);
        mapB.set(a, (mapB.get(a) ?? 0) + 1);
      }
    }
  }

  for (const [slug, entity] of entityMap) {
    const relMap = cooccurrences.get(slug);
    if (relMap) {
      for (const [otherSlug, strength] of relMap) {
        if (strength >= cooccurrenceThreshold) {
          entity.relatedEntities.push({ entityId: otherSlug, strength });
        }
      }
      entity.relatedEntities.sort((a, b) => b.strength - a.strength);
    }
  }

  return {
    entities: Array.from(entityMap.values()),
    memoryEntityMap,
  };
}

export function extractEntitiesFromText(
  text: string,
  config: EntityExtractionConfig = {},
): { name: string; type: EntityType }[] {
  const enabledTypes = new Set<EntityType>(
    config.enabledTypes ?? ["person", "product", "organization", "file", "concept"],
  );
  const results: { name: string; type: EntityType }[] = [];
  const seen = new Set<string>();

  // Person
  if (enabledTypes.has("person")) {
    for (const pattern of DEFAULT_ENTITY_PATTERNS.person) {
      const matches = text.matchAll(new RegExp(pattern));
      for (const match of matches) {
        const raw = match[1] ?? match[0];
        const name = raw.replace(/^@/, "").trim();
        if (name.length > 1) {
          const key = name.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ name, type: "person" });
          }
        }
      }
    }
  }

  // Product
  if (enabledTypes.has("product")) {
    for (const pattern of DEFAULT_ENTITY_PATTERNS.product) {
      const matches = text.matchAll(new RegExp(pattern));
      for (const match of matches) {
        const name = match[0].trim();
        const key = name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ name, type: "product" });
        }
      }
    }
  }

  // Organization
  if (enabledTypes.has("organization")) {
    for (const pattern of DEFAULT_ENTITY_PATTERNS.organization) {
      const matches = text.matchAll(new RegExp(pattern));
      for (const match of matches) {
        const name = match[0].trim();
        const key = name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ name, type: "organization" });
        }
      }
    }
  }

  // File
  if (enabledTypes.has("file")) {
    for (const pattern of DEFAULT_ENTITY_PATTERNS.file) {
      const matches = text.matchAll(new RegExp(pattern));
      for (const match of matches) {
        const name = match[0].trim();
        const key = name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ name, type: "file" });
        }
      }
    }
  }

  return results;
}

export function saveEntities(memoryDir: string, data: Entity[] | EntityExtractionResult): void {
  const filePath = join(memoryDir, "entities.json");
  mkdirSync(memoryDir, { recursive: true });
  const entities = Array.isArray(data) ? data : data.entities;
  writeFileSync(filePath, JSON.stringify(entities, null, 2), "utf8");
}

export function loadEntities(memoryDir: string): Entity[] {
  const filePath = join(memoryDir, "entities.json");
  if (!existsSync(filePath)) return [];
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Entity[];
  } catch {
    return [];
  }
}

export function findEntity(memoryDir: string, id: string): Entity | null {
  const entities = loadEntities(memoryDir);
  const cleanId = slugify(id);
  const alphanumericId = id.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    entities.find((e) => {
      if (e.id === cleanId || e.name.toLowerCase() === id.toLowerCase()) return true;
      if (slugify(e.name) === cleanId) return true;
      const alphaE = e.id.toLowerCase().replace(/[^a-z0-9]/g, "");
      return alphaE.length > 0 && alphaE === alphanumericId;
    }) ?? null
  );
}

export function findRelatedEntities(
  memoryDir: string,
  id: string,
): { entity: Entity; strength: number }[] {
  const entities = loadEntities(memoryDir);
  const target = findEntity(memoryDir, id);
  if (!target) return [];

  const entityIndex = new Map(entities.map((e) => [e.id, e]));
  const results: { entity: Entity; strength: number }[] = [];

  for (const rel of target.relatedEntities) {
    const found = entityIndex.get(rel.entityId);
    if (found) {
      results.push({ entity: found, strength: rel.strength });
    }
  }
  return results;
}
