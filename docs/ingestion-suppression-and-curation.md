# Ingestion, Suppression & Curation Gates Guide

> **Audience**: Agency architects, AI platform engineers, and autonomous agent orchestrators.  
> **Copy Framework**: QUEST / ACCA (Qualify Problem → Understand Architecture → Educate with Mathematical & System Truth → Stimulate Implementation → Actionable Runbooks).

---

## 1. Qualify: The Echo Chamber of Agent Memory & Ingestion Pitfalls

In multi-agent systems and conversational pair-programming environments, unmanaged memory ingestion creates four compounding systemic pathologies:

1. **Recursive Prompt Poisoning & Echo Bleed (`T-110`)**: When an agent injects a `<memory-context>` pack into a conversation and later transcripts are crawled by memory harvesters, the injected context is ingested as "newly discovered facts". This creates infinite echo loops, bloating memory stores with mirror copies of past context packs and base64 blobs.
2. **Context Window Waste & Redundant Re-Injection (`T-108`, `T-111`)**: If an agent recalls a 500-token architectural rule on Turn 1, blindly re-injecting that exact same rule on Turn 2, 3, and 4 starves the context window of room for new working code. The agent's LLM context window already holds the rule from recent turns.
3. **Premature Self-Echo Ingestion (`T-109`)**: An agent writes a candidate memory at minute 2 of a session. At minute 3, the agent issues a query; naive retrieval fetches the candidate memory the agent itself just wrote, treating it as an authoritative past precedent rather than unverified self-output.
4. **Autonomous Hallucination Promotion (`T-106`, `T-107`)**: Unsupervised LLMs promote speculative ideas to global policy without empirical evidence. Agents must only append empirical evidence (test runs, build results, verification logs); deterministic code gates must arbitrate whether a memory earns project or global scope.
5. **Compute & Token Exhaustion on Trivial or Repetitive Queries (`T-112`, `T-113`)**: Greetings ("hi", "hello", "thanks", "ok") triggered full FTS5, vector, and graph scans, hallucinating irrelevant memory packs. Similarly, consecutive tool calls asking variations of the exact same query re-executed full retrieval pipelines.

**Muse Memory Wave 18** establishes an immutable fortress across the entire ingestion and retrieval lifecycle: **Curator Protocol, Two-Tier Promotion, 6-Turn Re-injection Suppression, Age-Bounded Self-Echo Suppression, Context Block Stripping, Seen-Chunk TTL, Topic-Overlap Prefetch Skipping, and Trivial-Prompt Gates**.

---

## 2. Understand: Wave 18 Architecture & Ingestion Pipeline

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                     INGESTION, SUPPRESSION & DETERMINISTIC CURATION PIPELINE                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                 │
        ┌────────────────────────────────────────┼────────────────────────────────────────┐
        ▼                                        ▼                                        ▼
[ 1. Ingestion Sanitization ]           [ 2. Two-Tier Curation ]                 [ 3. Suppression Engine ]
• stripInjectedContextBlocks            • memory_curate                          • SessionReinjectionTracker
  - <memory-context> tags                 - Append empirical evidence              - 6-turn LRU per session
  - <muse-memory> tags                    - Deterministic promotion gate           - Constraint/timeless exempt
  - Markdown Context Packs                - Threshold: 3x pass, 0 regressions    • Self-Echo Suppression
  - Base64 payload blobs                • Two-Tier Promotion Staging               - 10-minute horizon
• Harvester & propose gates               - Pending promotion tier                 - Session & agent provenance
• Prohibit pure-injected entries          - Session-end atomic flush               - Human/verified exempt
        │                                        │                                        │
        └────────────────────────────────────────┼────────────────────────────────────────┘
                                                 │
        ┌────────────────────────────────────────┴────────────────────────────────────────┐
        ▼                                                                                 ▼
[ 4. Seen-Chunk TTL Suppression ]                                                [ 5. Adaptive Query Gates ]
• SeenChunkTracker (default 5-min TTL)                                           • Topic-Overlap Prefetch Skip (>0.6)
• Chunk keys: content_hash or id:content[:60]                                      - Jaccard query token overlap
• Remaining TTL countdown                                                          - Reuses cached context pack
• Transparent withheld reporting in withheld_memories                            • Trivial-Prompt Gate
                                                                                   - Greeting/acknowledgment detector
                                                                                   - Bypasses recall, keeps constraints
```

---

## 3. Educate: Core Mechanisms & Mathematical Specifications

### 3.1. Curator Protocol & Deterministic Scope Promotion (`T-106`)

Rather than letting models unilaterally promote memories, the **Curator Protocol** separates empirical observation from promotion authority:

$$\text{EligibleForProject}(m) \iff \text{successCount}(m) \ge 3 \land \text{regressionCount}(m) = 0 \land \text{confidence}(m) \ge 0.70$$

$$\text{EligibleForGlobal}(m) \iff \text{EligibleForProject}(m) \land \text{successCount}(m) \ge 5 \land \text{observationSpanDays}(m) \ge 2.0$$

- **Agent Role**: Calls `memory_curate` to record empirical application outcomes (`success`, `regression`, `neutral`, `mitigated`) along with reproducible evidence commands and verified logs.
- **Deterministic Promotion**: Evaluates utility metrics and verification levels. If qualifying thresholds are met, the memory automatically elevates from `candidate` to `confirmed`, and from local `project` scope to cross-project `global` scope.

### 3.2. Two-Tier Promotion Architecture (`T-107`)

In high-throughput multi-agent swarms, modifying shared memory entries mid-session introduces race conditions. Two-tier promotion solves this:

1. **Tier 1 (Staged Pending)**: Promotions staged during an active task are appended to `.memory/pending_promotions.json`. The active memory entry remains untouched and immutable during the session.
2. **Tier 2 (Session-End Flush)**: Upon task completion or session closeout, `memory_flush_pending` validates staged candidates against active health gates, applies scope transitions, updates the SQLite store, and emits audit ledger events atomically.

### 3.3. Re-Injection Suppression (6-Turn LRU) (`T-108`)

When an agent converses across multiple turns, memories injected into the context within the last 6 turns are suppressed:

$$\text{Suppressed}(m, t) \iff (t - t_{\text{injected}}(m) < 6) \land m.\text{type} \ne \text{"constraint"} \land m.\text{temporal\_mode} \ne \text{"timeless"}$$

- **Turn LRU Tracking**: `SessionReinjectionTracker` maintains a 1-indexed turn counter per session and a bounded map of recently injected memory IDs.
- **Exemptions**: Invariants, active working constraints (`CURRENT.md`), and `timeless` architectural boundaries are **strictly exempt** from suppression and guaranteed to be present on every turn.
- **Telemetry**: Suppressed items are surfaced in `withheld_memories` with human-readable diagnostic reasons (`reinjection_suppressed (2 turns ago, injected at turn 1; 6-turn LRU)`).

### 3.4. Age-Bounded Self-Echo Suppression (`T-109`)

Memories captured by the active session or agent within a 10-minute horizon (`DEFAULT_ECHO_HORIZON_MS = 600,000ms`) are withheld from retrieval:

- **Provenance Matching**: Matches `entry.session_id === activeSessionId` or `entry.source.includes(activeAgent)`.
- **Exemption Gate**: User-stated facts (`source: "user" | "human"`) and verified authoritative entries are exempt, ensuring human directives take effect immediately.

### 3.5. Injected-Block Stripping (`T-110`)

`stripInjectedContextBlocks(text)` executes regex sanitization before text enters `extractHarvestUnits`, `harvestSessionMemories`, or `store.propose`:

- Strips `<memory-context>...</memory-context>`, `<muse-memory>...</muse-memory>`, `<context-pack>...</context-pack>`, `<system-instructions>...</system-instructions>`, and HTML comment boundaries.
- Strips raw Markdown Context Packs (`# 🧠 Muse Memory Context Pack...`).
- Redacts base64 data URIs (`data:image/png;base64,...`) and raw base64 code blocks to `[base64-payload-stripped]`.
- Rejects propose calls consisting entirely of stripped injected content.

### 3.6. Seen-Chunk TTL Suppression (`T-111`)

In addition to turn-based tracking, `SeenChunkTracker` enforces real-time timestamp TTLs (default 5 minutes / 300,000ms) over content chunks:

- **Deterministic Chunk Key**: Calculated from `content_hash`, or `id:content.slice(0, 60)`, or `id`.
- **TTL Window**: If an identical chunk was served to the caller session within 5 minutes, it is withheld with `seen_chunk_suppressed (${remainingSec}s TTL remaining)`.

### 3.7. Topic-Overlap Prefetch Skipping (`T-112`)

When consecutive queries in an active session share high keyword Jaccard overlap (> 0.6):

$$J(Q_1, Q_2) = \frac{|Tokens(Q_1) \cap Tokens(Q_2)|}{|Tokens(Q_1) \cup Tokens(Q_2)|}$$

- If $J(Q_{\text{prior}}, Q_{\text{new}}) > 0.6$, `resolveMuseContext` skips redundant database scans, FTS5 execution, and vector embeddings, returning the cached context pack directly with `prefetch_skipped: true` and `topic_overlap: 0.75`.

### 3.8. Trivial-Prompt Gate (`T-113`)

Detects greetings ("hi", "hello", "hey", "howdy", "good morning") and conversational acknowledgments ("thanks", "ok", "got it", "done") when no technical context (`active_file`, `symbol`, `error_message`, or non-general intent) is provided:

- Bypasses memory retrieval passes, returning `trivial_prompt_gated: true`.
- Preserves active constraints from `CURRENT.md` and outputs actionable prompt guidance in `suggested_next_steps`.

---

## 4. Actionable Runbook: Using Wave 18 Capabilities

### 4.1. Appending Curator Evidence via MCP

```typescript
// Agent records empirical validation result
await use_mcp_tool("memory", "memory_curate", {
  id: "mem_conn_pool_size",
  outcome: "success",
  evidence: "Ran integration load test with 50 concurrent workers. 0 dropped connections.",
  run_command: "bun test test/integration/db_pool.test.ts",
  log_snippet: "PASS: 50/50 connections acquired within 12ms",
});
```

### 4.2. Staging and Flushing Promotions

```typescript
// Stage a promotion during a long-running subagent task
await use_mcp_tool("memory", "memory_promote", {
  id: "mem_conn_pool_size",
  target_scope: "project",
  session_id: "agent_session_492",
  stage_pending: true,
});

// At session completion, flush and apply qualifying promotions
const flushResult = await use_mcp_tool("memory", "memory_flush_pending", {
  session_id: "agent_session_492",
  dry_run: false,
});
```

### 4.3. Querying Context with Suppression and Overlap Gates

```typescript
// Request context with 6-turn re-injection suppression and seen-chunk TTL
const context = await use_mcp_tool("memory", "muse_context", {
  query: "Configure database connection pooling parameters",
  session_id: "session_abc123",
  turn: 2,
  suppress_reinjected: true,
  suppress_seen_chunks: true,
  seen_chunk_ttl_ms: 300000,
  check_topic_overlap: true,
  enable_trivial_gate: true,
});
```

---

## 5. Verification Matrix & Guarantees

| Ingestion Gate | Trigger Condition | Outcome | Telemetry / Audit |
|---|---|---|---|
| **Injected Block Strip** (`T-110`) | Input text contains `<memory-context>` or base64 blobs | Strips tags, sanitizes content, rejects empty results | Prevents recursive context pack ingestion |
| **Curator Gate** (`T-106`) | `memory_curate` with application outcome | Updates utility counters, deterministically checks promotion criteria | `curation_observation` event in audit ledger |
| **Pending Staging** (`T-107`) | `memory_promote` with `stage_pending: true` | Staged in `.memory/pending_promotions.json` without mutating store | `memory_flush_pending` flushes at session closeout |
| **Re-injection Suppression** (`T-108`) | Memory injected within last 6 turns | Withheld from retrieval pool | Counted in `reinjection_suppressed_count`, logged in `withheld_memories` |
| **Self-Echo Suppression** (`T-109`) | Memory captured by caller session/agent within 10 min | Withheld unless human or authoritative | Counted in `self_echo_suppressed_count`, logged in `withheld_memories` |
| **Seen-Chunk TTL** (`T-111`) | Identical chunk served to session within 5 minutes | Withheld from retrieval pool | Counted in `seen_chunk_suppressed_count`, remaining TTL reported |
| **Topic-Overlap Skip** (`T-112`) | Consecutive query Jaccard overlap > 0.6 | Reuses cached context pack without re-querying FTS/vector | Sets `prefetch_skipped: true`, reports `topic_overlap` |
| **Trivial-Prompt Gate** (`T-113`) | Conversational greeting without technical context | Bypasses recall, preserves active constraints | Sets `trivial_prompt_gated: true`, guides next query |
