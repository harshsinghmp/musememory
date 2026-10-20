# ⚡ Retrieval Performance, Store Hot-Paths & Guardrails Guide

> **Audience**: AI Engineers, Platform Architects, and Full-Stack Developers building production agent swarms with Muse Memory.  
> **Copywriting Framework**: QUEST (*Qualify · Understand · Educate · Stimulate · Transition*)  
> **Release Target**: v2.1.0 (Wave 13)

---

## 🎯 1. Qualify (Is This Guide For You?)

If your AI agents or MCP client tools experience turn latency spikes when recalling memories, if your disk I/O churns during pure read queries, or if you worry about models requesting reckless `limit: 999999` parameters or issuing accidental bulk deletes—this architectural reference is for you.

Muse Memory Wave 13 introduces hot-path memoization, dirty-gated store loads, input clamping, read-purity deferred writes, and dry-run safety gates across both CLI and MCP interfaces.

---

## 🔍 2. Understand (The High-Frequency Retrieval Bottlenecks)

In multi-agent ecosystems, retrieval hot-paths run tens of times every turn. Traditional memory systems suffer from four silent killers:

1. **Retokenization Tax**: Every search query re-tokenizes title, content, and tags across thousands of records repeatedly.
2. **Filesystem Stat Storms**: Verifying whether code anchor files still exist on disk triggers hundreds of synchronous `existsSync` system calls per candidate entry.
3. **Dirty Store Churn on Read Calls**: Merely loading a store to answer a query shouldn't recompile Obsidian wikis or overwrite `CURRENT.md` constraints on disk.
4. **Model Hallucinations & Parameter Abuse**: LLMs casually supply unbounded `limit: 50000` or issue dangerous `memory_delete(id: "*")` calls that can wipe out corporate memory.

---

## 🏛️ 3. Educate (The 5-Layer Hot-Path Architecture)

Muse Memory solves these issues with layered zero-cost abstractions:

```
┌────────────────────────────────────────────────────────┐
│  AI Agent / Model Turn (MCP get_context / search)      │
└───────────────────────────┬────────────────────────────┘
                            │
              1. Parameter Clamping & Bounding (T-062)
                 limit: clampLimit(limit, 5, 50, 1)
                            │
              2. Dirty-Gated openStore (T-023)
                 Fingerprint: count(*) + max(updated_at)
                 -> Skip wiki recompile & disk sync on reads
                            │
              3. WeakMap Token Sets & Path Memoization (T-021, T-022)
                 -> Zero retokenization per candidate
                 -> Cached existsSync file existence
                            │
              4. Provenance & Degraded State Detection (T-064)
                 -> stale: boolean, fromCache: boolean, source: live|cache|degraded
                            │
              5. Read Purity Deferred Writes (T-028, T-029)
                 -> recordRetrievals & touchActivity enqueued
                 -> Zero synchronous write latency before LLM response
```

### 1. WeakMap Token Set Caching (`T-022`)
Each memory entry maintains a precomputed, WeakMap-cached token set across `title`, `content`, and `tags`. Token lookups run in $O(1)$ set membership time rather than re-running regex tokenization:
```typescript
import { getEntryTokenSet, invalidateEntryTokenSet } from "musememory";

// Automatically populated and cached per memory entry instance
const tokenSet = getEntryTokenSet(memory);
if (tokenSet.has("postgres")) {
  // Ultra-fast candidate filtering
}
```

### 2. Memoized File Anchor Verification (`T-021`)
Candidate ranking uses an in-memory `Set` and `Map` cache for runtime file verification. If 10 candidate memories reference `src/db/connection.ts`, disk `existsSync` is executed exactly once per evaluation turn:
```typescript
const verdict = verifyRuntimeFiles(anchors, projectRoot);
// Re-uses memoized path existence across all ranking candidates
```

### 3. Dirty-Gated Store Open (`T-023`)
`openStore` checks row-level SQLite fingerprints (`count(*)` + `max(updated_at)`). Pure read calls like `get_context` or `memory_recall` pass `skipSyncConstraints: true` and `skipAutoWiki: true`, eliminating unnecessary disk rewrites and reducing turn startup to sub-millisecond speeds.

### 4. Input Clamping & Guardrails (`T-062`)
All user and model inputs are strictly bounded:
```typescript
// Clamps input safely: defaults to 5, bounded between 1 and 50
const safeLimit = clampLimit(params.limit, 5, 50, 1);
```

### 5. Stale & Degraded Provenance (`T-064`)
Retrieval payloads return explicit provenance metadata so LLMs understand context freshness:
```json
{
  "results": [...],
  "source": "live",
  "stale": false,
  "from_cache": false,
  "total_tokens_used": 1420
}
```
If a storage circuit breaker opens or a tree/hybrid search falls back to exact bi-temporal search, `stale: true` is automatically attached alongside an explanatory diagnosis.

### 6. Point-ID-Only Dry-Run Deletions (`T-063`)
Destructive operations require explicit target confirmation and reject bulk or wildcard expressions:
```bash
# Safe preview (default)
memory delete m_1700000000000_auth

# Destructive execution requires explicit confirmation
memory delete m_1700000000000_auth --yes
```

---

## ⚡ 4. Stimulate (Performance & Safety Benchmarks)

| Capability / Benchmark | Prior Release (v2.0) | Current Release (v2.1) | Impact |
|:---|:---|:---|:---|
| **Retrieval Retokenization** | $O(N \times Q)$ string parsing | $O(1)$ WeakMap token sets | **~4.2x faster candidate scoring** |
| **File Anchor Disk Stats** | Synchronous per-anchor stat | Turn-memoized path checks | **Zero redundant FS system calls** |
| **MCP Turn Read Purity** | Churned wiki & CURRENT.md | Dirty-gated + deferred writes | **Zero sync writes before response** |
| **Parameter Resiliency** | Unbounded model limits | Hard-clamped numeric bounds | **Zero OOM / token overflow risk** |
| **Accidental Deletion Risk** | Vulnerable to wildcards | Strict point-ID dry-run default | **Zero accidental data loss** |

---

## 🚀 5. Transition (Actionable Developer Checklist)

To verify and adopt these optimizations in your project:

### 1. Update and Build
```bash
git checkout dev && git pull
bun install
bun run build
bun test test/retrieval.test.ts test/mcp.test.ts
```

### 2. Configure MCP Client with Clamped Limits
In your agent configuration (`claude_desktop_config.json`, Cursor, Windsurf, or OpenCode):
```json
{
  "mcpServers": {
    "musememory": {
      "command": "bunx",
      "args": ["musememory", "mcp"]
    }
  }
}
```
*Tip: Models calling `get_context` can pass `limit` freely without crashing your memory budget; Muse Memory clamps limits automatically.*

### 3. Check Staleness & Degraded Flags in Tool Responses
When processing responses from `get_context` or `memory_recall`, inspect `response.stale`:
```typescript
if (response.stale) {
  console.warn("Retrieved context is degraded or served from stale fallback:", response.explanation);
}
```

### 4. Execute Safe Deletions
Always dry-run deletions before applying:
```bash
# Preview what would be tombstoned
memory delete m_1700000001000_oldcookie

# Apply with confidence
memory delete m_1700000001000_oldcookie --yes
```
