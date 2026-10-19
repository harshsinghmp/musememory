# 🕸️ Graph, Provenance & Lineage Architecture Guide

> **Version**: `v2.7.0`  
> **Status**: Feature Release (Wave 17: Packing, Graph, Lineage & Provenance)  
> **Test Coverage**: 1,073 tests passing across 170 test suites  

---

## 1. Overview & Architectural Principles

Muse Memory v2.7.0 lands **Wave 17 (Packing + Graph + Provenance)**, introducing first-class relational lineage, progressive associative graph expansion, immutable fact provenance, and cryptographic audit security:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Muse Memory v2.7.0 Knowledge Fabric                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┴───────────────────────────────┐
    │                                                               │
    ▼                                                               ▼
┌─────────────────────────────────┐               ┌─────────────────────────────────┐
│     Associative Graph & Wiki    │               │    Relational Lineage & Provenance│
├─────────────────────────────────┤               ├─────────────────────────────────┤
│ • linked_memory_ids auto-seeding│               │ • supersedes_id & conflicts_fk  │
│ • Progressive wikilink expansion│               │ • walkLineageBfs DAG traversal  │
│ • prefer_observations dedup     │               │ • fact_provenance append table  │
│ • Hidden-count over-fetching    │               │ • Hash-chained audit + Merkle   │
└─────────────────────────────────┘               └─────────────────────────────────┘
```

---

## 2. Core Capabilities

### 2.1 Write-Time Linked Edges (`linked_memory_ids`, T-095)
Captures associative relationships at ingest time without expensive graph passes.
- Auto-seeds up to 10 recent related memories within the same project/session.
- Stored as a dedicated SQLite column `linked_memory_ids` and indexed via `idx_memories_linked_ids`.
- Explicit IDs can be passed via `opts.linked_memory_ids`, or automatically computed based on tag and lexical co-occurrence.

### 2.2 HyAtlas Supersede-not-Delete & Hidden-Count Over-Fetch (T-096)
Enforces the immutable knowledge invariant: old decisions are never deleted.
- Memories replaced via `opts.supersedes` transition to `status: 'superseded'`, set `valid_to` and `valid_to_exact: true`.
- SQLite FTS and hybrid retrieval engines over-fetch by `limit + hidden_count` to guarantee full page budgets even when superseded items match query terms.
- Surfaced via `hidden_count` in `SearchResult`, `FormattedContext`, and `UnifiedSearchResult`.

### 2.3 Observation-Biased Recall Deduplication (`prefer_observations`, T-097)
Prefers empirical observations over abstract generalizations in recall candidate pools.
- Scopes near-duplicate detection to top-2×budget candidate window with Jaccard threshold $\ge 0.65$.
- Grants empirical observation-backed entries a $+0.10$ veracity boost within candidate windows.
- Surfaced via `deduped_count` in search results.

### 2.4 Progressive Wikilink Expansion after Fusion (T-098)
Progressively expands related concept pages and linked memories following reciprocal rank fusion.
- Parses `[[target]]`, aliased `[[target|alias]]`, and anchored `[[target#section]]` links.
- Performs BFS frontier expansion across memories and compiled wiki concept pages up to `max_wikilink_hops` (default 1).
- Enforces token budget capping, cycle prevention, and superseded memory filtering.
- Formats expanded concepts under `### Progressively Expanded Wiki Links & Related Memories` in prompt context.

### 2.5 Semantic Fact Provenance Registry (`fact_provenance`, T-099)
Append-only SQLite registry tracking the immutable origin and evidence for semantic triples:
- Schema Migration 9 establishes table `fact_provenance` with triple-unique index:
  ```sql
  CREATE UNIQUE INDEX idx_fact_provenance_triple ON fact_provenance(entity, relation, target);
  ```
- Automatically records fact triples on `save()` and `propose()`.
- Idempotent `INSERT OR IGNORE` ensures the original asserting evidence is preserved forever.

### 2.6 First-Class Lineage Foreign Keys (`supersedes_id`, `conflicts_with_id`, T-100)
Elevates lineage relationships to indexed relational foreign keys:
- Schema Migration 10 adds `supersedes_id TEXT` and `conflicts_with_id TEXT` to `memories`.
- Indexed via `idx_memories_supersedes_id` and `idx_memories_conflicts_with_id`.
- Automatically populated during `propose({ supersedes })`, `supersede(store, oldId, newId)`, and `flagConflict(store, memA, memB)`.

### 2.7 Lineage BFS DAG Walker (`walkLineageBfs`, T-101)
Traverses provenance DAGs in any direction with cycle prevention and depth bounds:
```typescript
import { walkLineageBfs } from "musememory";

const lineage = walkLineageBfs(store, "m_current_db", {
  direction: "both",       // "ancestors" | "descendants" | "both"
  maxDepth: 3,             // depth bound
  limit: 25,               // max entries
  includeConflicts: true,  // lateral conflict traversal
  includeLinked: true,     // associative write-time links
});

console.log(lineage.entries); // Array of MemoryEntry along the DAG
console.log(lineage.depths);  // Record<memory_id, depth>
console.log(lineage.edges);   // Typed edges (supersedes, superseded_by, conflicts_with, linked)
```

### 2.8 Hash-Chained Audit Ledger & Session Merkle Checkpoints (T-102)
Guarantees tamper-evident audit security for multi-agent workflows:
- **Hash Chaining**: Every audit entry in `.memory/audit.jsonl` contains `prev_hash`, `hash`, and `salt_date`.
- **Per-Day Salt Rotation**: Rotating cryptographic salt per date partition stored in `.memory/audit_salts.json`.
- **Integrity Verification**: `verifyAuditChain(memoryDir)` validates the hash chain line-by-line, instantly detecting tampering, reordering, or line deletion.
- **Session Merkle Checkpoints**: Computes Merkle tree roots over session events (`createSessionMerkleCheckpoint`, `verifySessionMerkleCheckpoint`, `generateMerkleProof`, `verifyMerkleProof`).

---

## 3. Verification & Compliance

All Wave 17 capabilities are verified against the independent oracle test suite:
```bash
bun test test/linked_memory_ids.test.ts
bun test test/supersede_overfetch.test.ts
bun test test/prefer_observations.test.ts
bun test test/wikilink_expansion.test.ts
bun test test/fact_provenance.test.ts
bun test test/lineage_fks.test.ts
bun test test/lineage_bfs.test.ts
bun test test/audit_merkle.test.ts
```
Full suite: **1,073 tests passing across 170 files (0 failures)**.
