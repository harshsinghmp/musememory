# Entity/Concept Extraction Architecture Design

## Overview
Auto-extract entities and concepts from memory content. Create entity pages with entity-to-entity relationships. Richer than manual `related_memory_ids` linking.

## Entity Types

| Type | Patterns | Examples |
|------|----------|----------|
| Person | @mentions, "authored by", "reviewed by" | @harsh, "John reviewed" |
| Product | Framework/tool names, version refs | Next.js, React, TypeScript 5.6 |
| Organization | Company names, team refs | Vercel, Anthropic, GitHub |
| File | Path references, imports | `src/retrieval.ts`, `package.json` |
| Concept | Technical terms, patterns | "tree-indexed retrieval", "knapsack budgeting" |

## Extraction Pipeline

### Stage 1: Regex-Based Extraction (Fast, No LLM)
```typescript
const ENTITY_PATTERNS = {
  person: [
    /@(\w+)/g,                                    // @mentions
    /\b(?:authored|reviewed|fixed|reported by)\s+(\w+)/gi,
  ],
  product: [
    /\b(?:Next\.js|React|TypeScript|Node\.js|Bun|Vercel|Anthropic|OpenAI|PostgreSQL|Redis|Docker|Kubernetes|GraphQL|REST|gRPC|WebAssembly|WASM)\b/gi,
    /\b\w+\.js\b/gi,                              // *.js frameworks
  ],
  organization: [
    /\b(?:Vercel|Anthropic|OpenAI|Google|Microsoft|GitHub|GitLab|AWS|GCP|Azure|Meta|Facebook|Amazon|Netflix|Shopify|Stripe|Supabase|PlanetScale|Neon|Turso)\b/gi,
  ],
  file: [
    /(?:src|lib|test|docs|scripts)\/[\w\/\.-]+\.(?:ts|tsx|js|jsx|json|yaml|yml|md|mdx)/g,
    /package\.json|tsconfig\.json|eslint\.config|prettier\.config/gi,
  ],
  concept: [
    /\b(?:tree.indexed.retrieval|wiki.compilation|knapsack.budgeting|progressive.disclosure|semantic.reasoning|vector.search|BM25|hybrid.search|entity.extraction|memory.lifecycle|consolidation|distillation)\b/gi,
  ],
};
```

### Stage 2: Normalization & Deduplication
- Lowercase, trim, remove punctuation
- Alias resolution: "Next.js" ≈ "nextjs" ≈ "next"
- Merge duplicates within and across memories

### Stage 3: Entity Page Creation/Update
- For each unique entity, create/update `.memory/wiki/entities/<slug>.md`
- Track: name, type, aliases, memory references, related entities

### Stage 4: Relationship Building
- Co-occurrence: entities mentioned in same memory → related
- Cross-memory: entity A in memory 1, entity B in memory 2, same project → related
- Strength: count of co-occurrences

## Data Structures

```typescript
interface Entity {
  id: string;                    // slugified name
  name: string;                  // Display name
  type: EntityType;
  aliases: string[];
  memoryIds: string[];           // Memories mentioning this entity
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

interface EntityExtractionResult {
  entities: Entity[];
  memoryEntityMap: Map<string, string[]>;  // memoryId -> entityIds
}
```

## Integration Points
- `wiki/compiler.ts`: Entities feed into wiki compilation
- `graph.ts`: Entities enhance CodeGraph AST linking
- `retrieval.ts`: Entity-aware search (filter by entity)
- `mcp.ts`: New tool `memory_entities_get`, `memory_entities_search`
- CLI: `memory extract-entities`, `memory entities list`

## CLI Interface
```bash
memory extract-entities [--project <name>] [--dry-run]
memory entities list [--type person|product|org|file|concept] [--project <name>]
memory entities show <entity-id>
memory entities related <entity-id>
```

## Configuration
```typescript
interface EntityExtractionConfig {
  enabledTypes: EntityType[];    // Default: all
  minMentionsForPage: number;    // Default: 2
  cooccurrenceThreshold: number; // Default: 2
  customPatterns: Record<string, RegExp[]>;
  aliasMap: Record<string, string>;  // "react" -> "React"
}
```

## Performance
- Regex extraction: O(n) per memory, very fast
- No LLM calls required (deterministic)
- Incremental: only process new/updated memories
- Scales to millions: O(1) per memory