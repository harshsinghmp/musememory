# Wiki Compilation Engine Architecture Design

## Overview
Adopt OpenKB's wiki compilation as native musememory feature. Background process compiles related memories into structured markdown pages (concept pages, entity pages, index, log) for ALL memory types. Knowledge compounds over time.

## Goals
- Structured pages for all memory types (not just fix-type rollups like `consolidate.ts`)
- Cross-references between concepts
- Knowledge compounding: each new entry enriches existing pages
- Obsidian-compatible markdown with wikilinks
- OKF-ready export

## Wiki Page Types

### 1. Concept Page (`wiki/concepts/<slug>.md`)
```markdown
---
title: "React Server Components"
type: concept
status: confirmed
tags: [react, architecture, performance]
related: ["server-components", "streaming", "suspense"]
memories: ["m_1700000001000_fix", "m_1700000002000_arch"]
lastUpdated: "2026-08-28T10:30:00Z"
---

# React Server Components

## Summary
React Server Components (RSC) allow rendering components exclusively on the server...

## Key Insights
- [[server-components]] reduce client bundle size
- [[streaming]] enables progressive rendering
- See also: [[suspense]] for data fetching patterns

## Related Memories
- [[m_1700000001000_fix]]: RSC hydration mismatch fix
- [[m_1700000002000_arch]]: Architecture decision for RSC adoption
```

### 2. Entity Page (`wiki/entities/<slug>.md`)
```markdown
---
title: "Next.js"
type: entity
entityType: product
tags: [framework, react, vercel]
memories: ["m_1700000001000_fix", "m_1700000003000_decision"]
lastUpdated: "2026-08-28T10:30:00Z"
---

# Next.js

## Overview
Next.js is a React framework by Vercel...

## Mentions in Memories
- [[m_1700000001000_fix]]: App Router migration
- [[m_1700000003000_decision]]: Framework selection rationale
```

### 3. Index Page (`wiki/index.md`)
```markdown
---
title: "Knowledge Base Index"
lastUpdated: "2026-08-28T10:30:00Z"
totalMemories: 1247
totalConcepts: 89
totalEntities: 34
---

# Knowledge Base Index

## By Type
- [[fix|Fixes]] (423)
- [[architecture|Architecture]] (156)
- [[decision|Decisions]] (89)
- [[operation|Operations]] (67)
- ...

## By Project
- [[musememory|Muse Memory]] (892)
- [[personal|Personal]] (355)
```

### 4. Log Page (`wiki/log.md`)
```markdown
---
title: "Compilation Log"
lastCompiled: "2026-08-28T10:30:00Z"
entriesProcessed: 1247
pagesCreated: 12
pagesUpdated: 89
---

# Compilation Log

## 2026-08-28 10:30:00
- Created concept: `react-server-components`
- Updated entity: `nextjs`
- Linked 3 memories to `server-components` concept
```

## Compilation Pipeline

### Input
- All memories with status `confirmed` (or configurable)
- Grouped by project, then by type

### Stage 1: Clustering (reuse `consolidate.ts`)
- Cluster memories by token overlap within (project, type)
- Threshold: 0.5 cosine similarity
- Min cluster size: 3 (configurable)

### Stage 2: Concept Extraction
- For each cluster, extract dominant topic tokens
- Create/update concept page
- Cross-reference with existing concepts (token overlap > 0.3)

### Stage 3: Entity Extraction
- Extract named entities from memory content
- People: @mentions, author names
- Products: framework names, tool names
- Organizations: company names, team names
- Files: file paths, repo names
- Create/update entity pages

### Stage 4: Page Generation
- Render markdown with frontmatter
- Wikilinks: `[[concept-slug]]`, `[[entity-slug]]`, `[[memory-id]]`
- Write to `.memory/wiki/`

### Stage 5: Index & Log Update
- Regenerate index.md with counts
- Append to log.md

## Background Execution
- Run via `memory wiki compile` CLI command
- Can be scheduled via routines
- Incremental: only reprocess changed memories (track via `updated_at`)
- Dry-run mode for preview

## CLI Interface
```bash
memory wiki compile [--project <name>] [--dry-run] [--types fix,architecture,...]
memory wiki list [--project <name>]
memory wiki show <concept|entity|index|log>
```

## Integration Points
- `consolidate.ts`: Reuse clustering logic
- `retrieval.ts`: Wiki pages as retrieval targets (L1 disclosure)
- `distill.ts`: Wiki pages as skill distillation source
- `mcp.ts`: New tool `memory_wiki_get`, `memory_wiki_search`

## File Layout
```
src/
  wiki/
    index.ts           # Main export
    compiler.ts        # Compilation pipeline
    concept.ts         # Concept page logic
    entity.ts          # Entity page logic
    render.ts          # Markdown rendering
    wiki.test.ts
```

## Configuration
```typescript
interface WikiConfig {
  minClusterSize: number;        // Default: 3
  clusteringThreshold: number;   // Default: 0.5
  conceptOverlapThreshold: number; // Default: 0.3
  entityTypes: string[];         // ['person', 'product', 'org', 'file']
  outputDir: string;             // Default: '.memory/wiki'
  incremental: boolean;          // Default: true
  includeTypes: MemoryType[];    // Default: all confirmed
}
```

## Token Bloat Reduction
- L1 retrieval: Return only title + summary (frontmatter + first paragraph)
- ~60-80% token savings vs retrieving N individual memories at L2
- Progressive disclosure: L1 → L2 (full content) → L3 (with metadata)