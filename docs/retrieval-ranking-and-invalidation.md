# 🎯 Invalidation, Attribution & Multi-Factor Ranking Rigor Guide

> **Audience**: AI Engineers, Autonomous Agent Developers, and Systems Architects integrating Muse Memory.  
> **Copywriting Framework**: ACCA (*Awareness · Comprehension · Conviction · Action*)  
> **Release Target**: v2.2.0 (Wave 14)

---

## 📢 1. Awareness: The Silent Flaws of Naive Agent Memory

When autonomous agents query memory systems, subtle ranking and invalidation bugs degrade agent decisions without triggering hard exceptions:

1. **Generic Verb Hijacking**: If a developer backticks \`get\` or \`set\` in a single memory, naive symbol matching awards that memory a massive $+1.0$ boost on every query containing "get", drowning out genuinely relevant context.
2. **Substring False Positives**: Naive substring inclusion (\`entryText.includes(token)\`) confuses \`race\` with \`trace\`, \`port\` with \`report\`, and \`lock\` with \`deadlock\`, polluting prompt context with irrelevant memories.
3. **Silent Lexical Search Evaporation**: When full-text search (FTS5) experiences a query error or syntax collision, catching errors with \`catch { return [] }\` quietly hides the failure. Downstream scorers have no idea FTS broke vs. genuinely finding zero hits.
4. **Stale Vector Indexes**: In pure document/store architectures, modifying or deleting a memory in SQLite or YAML leaves the vector index (\`index.json\`) desynchronized until a full rebuild.
5. **Runaway Associative Networks**: Unbounded Hebbian plasticity causes co-activation graphs to explode in size and create unbounded loops when memories repeatedly fire together.
6. **Stripped Capture Metadata**: Calling \`memory_capture\` via MCP stripped out rich propose options (such as idempotency keys, evidence links, verification levels, and temporal bounds), forcing all captures into flat defaults.

Muse Memory Wave 14 systematically eliminates these failure modes with strict attribution, incremental synchronization, and ranking rigor.

---

## 🧠 2. Comprehension: The 6 Pillars of Wave 14

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AI Model / Agent Query                          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┴───────────────────────────────┐
    ▼                                                               ▼
1. FTS5 Lexical Search (T-312)                 2. Vector & Associative Graph (T-304/307)
   - Loud [FTS5_DEGRADED] logging                 - Incremental index.json sync on save/delete
   - degraded: true / false signal                - Bounded Hebbian plasticity (30 edges, 500 nodes)
   - Zero-match != query error                    - Atomic .tmp rename persistence
    │                                                               │
    └───────────────────────────────┬───────────────────────────────┘
                                    │
                                    ▼
3. Unicode Word-Boundary Token Matching (T-310)
   - matchesWordBoundary(text, token)
   - Blocks race⊂trace, port⊂report, lock⊂deadlock
                                    │
                                    ▼
4. IDF-Weighted Symbol Specificity Scorer (T-309)
   - Generic verbs (get, set, run): 0.05
   - Generic short symbols (<=3 chars): 0.15
   - Distinctive compound identifiers (SessionManager, auth_token): 1.0
   - Explicit targetSymbol overrides: 1.0
                                    │
                                    ▼
5. Full Propose Options Passthrough in memory_capture (T-302)
   - Preserves idempotency_key, evidence, source, verification, due_at, salience, trust
```

### 1. Full Options Passthrough on `memory_capture` (`T-302`)
The `memory_capture` MCP tool now accepts and forwards every propose option supported by the core engine:

```json
{
  "name": "memory_capture",
  "arguments": {
    "title": "Database Connection Pool Exhaustion Fix",
    "content": "Set pool size to 25 and wire idle connection cleanup timer.",
    "project": "aria",
    "type": "decision",
    "confirmed": true,
    "idempotency_key": "fix-aria-db-pool-v1",
    "salience": 0.9,
    "trust": "core",
    "valid_from": "2026-10-18T00:00:00.000Z",
    "due_at": "2026-11-01T00:00:00.000Z",
    "evidence": [
      {
        "type": "code",
        "source": "src/database/pool.ts",
        "description": "Connection pool configuration"
      }
    ]
  }
}
```

### 2. Incremental Vector Index Synchronization (`T-304`)
Whenever `save()` or `deleteEntry()` is called on a store, `src/vector.ts` immediately updates the in-memory and on-disk `index.json` incrementally without requiring expensive full-index re-scans:

```typescript
import { upsertIndexEntry, removeIndexEntry } from "musememory";

// Incremental sync is automatic on store writes and deletes:
save(store, entry);      // Calls upsertIndexEntry(memoryDir, entry)
deleteEntry(store, id);  // Calls removeIndexEntry(memoryDir, id)
```

### 3. Bounded Hebbian Co-Activation Plasticity (`T-307`)
Associative connections between co-activated memories are now strictly bounded to prevent graph memory leaks and write lock contention:
- `MAX_COACTIVE_SEEDS = 8`: Only top candidate anchors propagate co-activation.
- `MAX_EDGES_PER_NODE = 30`: Prunes weakest associative links.
- `MAX_GRAPH_NODES = 500`: Hard cap on total indexed nodes.
- **Atomic Persistence**: Serialized through `.tmp` files with atomic rename to prevent half-written graph corruption.
- **Candidate Expansion**: Top associative memories automatically enrich candidate pools during retrieval ranking.

### 4. IDF-Weighted Symbol Specificity Scoring (`T-309`)
To prevent generic verbs (`get`, `set`, `run`, `check`) from dominating multi-factor ranking, symbol matching scales according to identifier specificity:

| Symbol Pattern | Example | Specificity Score |
|---|---|---|
| Falsy / Stopwords | `""`, `"the"`, `"for"` | `0.00` |
| Generic Programming Verbs | `get`, `set`, `run`, `log`, `db` | `0.05` |
| Short Identifiers (<= 3 chars) | `foo`, `bar`, `tmp` | `0.15` |
| Standard Identifiers (4–7 chars) | `token`, `cache`, `route` | `0.35` – `0.60` |
| Long Identifiers (>= 8 chars) | `database`, `middleware` | `0.85` |
| Compound / Distinctive Identifiers | `SessionManager`, `auth_token`, `jwt.verify` | `1.00` |
| Explicit Target Symbol | Query matches explicit `ctx.targetSymbol` | `1.00` |

### 5. Unicode-Aware Word-Boundary Matching (`T-310`)
Replaced substring `entryText.includes(token)` checks with Unicode-aware word-boundary testing:

```typescript
import { matchesWordBoundary } from "musememory";

matchesWordBoundary("Fix stack trace in logger", "race"); // false! (blocks race⊂trace)
matchesWordBoundary("Fix async race condition in lock", "race"); // true!

matchesWordBoundary("Generate quarterly report", "port"); // false! (blocks port⊂report)
matchesWordBoundary("Bind server to port 8080", "port"); // true!
```

### 6. Explicit FTS Failure Degradation Signal (`T-312`)
SQLite FTS5 errors no longer silently swallow into empty arrays. Callers can unequivocally distinguish between a zero-match query and an FTS engine failure:

```typescript
import { searchMemoriesFts } from "musememory";

const results = searchMemoriesFts(db, query);
if (results.degraded) {
  console.warn(`Lexical search unavailable: ${results.error}`);
  // Downstream system knows FTS failed rather than assuming no relevant memories exist
} else if (results.length === 0) {
  // Confirmed zero hits found by healthy FTS engine
}
```

---

## 🏆 3. Conviction: Why Wave 14 Invariants Matter

- **Deterministic Recall**: High-salience architectural patterns are never displaced by coincidental common words.
- **Fail-Loud Observability**: When an infrastructure component (like SQLite FTS) fails, the system logs `[FTS5_DEGRADED]` and reports degraded state rather than silently degrading agent IQ.
- **Zero Drift Between Store & Index**: Vector embeddings in `index.json` match SQLite/YAML on every write.
- **Bounded Resource Footprint**: Hebbian associative plasticity scales gracefully with zero memory leaks.

---

## 🚀 4. Action: Developer Integration Recipes

### Inspecting Degraded Signals in Custom Agents

```typescript
import { openStore, searchMemories } from "musememory";

const store = openStore("./.memory");
const hits = searchMemories(store, "Authentication token");

if (hits.degraded) {
  console.warn("FTS lexical index is degraded:", hits.error);
  // Gracefully degrade to hybrid vector or cached prompt context
}
```

### Capturing Memories with Full Metadata via MCP

```typescript
// When calling memory_capture from an MCP client or agent framework:
await mcpClient.callTool("memory_capture", {
  title: "Always use atomic renames for critical JSON indexes",
  content: "Write to filename.tmp first, then invoke fs.renameSync to prevent corruption.",
  type: "decision",
  confirmed: true,
  salience: 0.95,
  trust: "core",
  idempotency_key: "atomic-rename-pattern-2026",
  tags: ["filesystem", "atomic", "reliability"]
});
```
