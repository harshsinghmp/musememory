# Temporal Transitions, Contradiction Engine & Verbs Guide

> **Audience**: Software engineers, agency architects, and AI agent platform builders.  
> **Copy Framework**: QUEST / ACCA (Qualify Problem → Understand Architecture → Educate with Mathematical & System Truth → Stimulate Implementation → Actionable Runbooks).

---

## 1. Qualify: The Fragility of Point-in-Time Truth & Contradictions in Agent Memory

Production AI agents and multi-agent agency teams face four critical failure modes when managing evolving system state over time:

1. **Temporal Flattening & Anachronisms**: When an agent queries memory with "How did we configure database connection pooling last quarter before the migration?", traditional vector stores return current pool settings or blend obsolete and contemporary settings together. Without bi-temporal awareness, agents cannot reconstruct historical system states.
2. **Date Invention & Observation Lag**: When an architectural rule ceased to apply between two known commits, naive systems invent an arbitrary date or drop candidate memories completely. An honest memory system must report what was definitely valid, what was definitely invalid, and what is *undetermined* due to observation lag.
3. **Over-Eager Invalidation & Graphiti Collisions**: When an agent notes that development runs on port 3000 while production runs on port 443, naive contradiction checkers flag a mutual conflict and overwrite one with the other (the Graphiti #1728 failure). Distinct truths with distinct environmental or platform scopes must peacefully coexist.
4. **Destructive Conflict Resolution**: When two distributed subagents arrive at conflicting recommendations, deleting or overwriting one recommendation destroys historical auditability and causes oscillation. Both perspectives must be preserved in a durable conflicts ledger until explicitly resolved.
5. **Agent Inbreeding & Poisoning**: Agent-generated inferences competing on equal footing with direct human principal instructions lead to model drift. High-veracity user directives must deterministically break ties and outrank autonomous inferences.

**Muse Memory Wave 16** solves these challenges with a zero-daemon, mathematically grounded engine for **Bi-Temporal Transitions, Five-Verb Lifecycles, Keep-Both Conflict Tables, Scoped Invalidation, Federation Mesh Handshakes, Veracity Rank Weights, and Evidence-Age Stamping**.

---

## 2. Understand: Wave 16 Architecture & Data Flow

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                   TEMPORAL CONTRADICTION & PROVENANCE VERACITY PIPELINE                │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                            │
       ┌────────────────────────────────────┼────────────────────────────────────┐
       ▼                                    ▼                                    ▼
[ 1. Bi-Temporal Boundaries ]     [ 2. Lifecycle Verbs ]              [ 3. Contradiction Engine ]
• valid_from / valid_to           • change: atomic supersede          • conflicts table (keep-both)
• valid_to_exact flag             • end: historical cessation         • Semantic (entity, relation,
• evaluateAsOf(asOfTime):         • correct: errata fix                 target, scope) alignment
  valid / invalid / undetermined  • revert: restore previous          • Federation handshake
• searchTemporal(atTime)          • forget: GDPR soft/hard tombstone  • Dedup key canonicalization
       │                                    │                                    │
       └────────────────────────────────────┼────────────────────────────────────┘
                                            │
       ┌────────────────────────────────────┴────────────────────────────────────┐
       ▼                                                                         ▼
[ 4. Provenance Veracity Ranks ]                                    [ 5. Evidence-Age Stamping ]
• user: 1.0 weight (+0.15 score bonus)                             • src_ts evidence timestamp
• agent: 0.7 weight (0.0 neutral baseline)                         • Effective age: max(event, src_ts)
• external: 0.5 weight (-0.10 discount)                            • Capped freshness decay
• system: 0.3 weight (-0.20 discount)                              • Fresh ingest cannot revive
• minVeracity context filtering                                      stale historical documents
```

---

## 3. Educate: System Mechanics & Invariants

### A. Bi-Temporal Transitions & Exact Boundary Flags (`T-082`, `T-083`, `T-085`)

Every memory entry in Muse Memory records two independent temporal dimensions:
1. **Assertion / Record Time** (`created_at`, `updated_at`): When the agent recorded or revised the memory.
2. **Valid Time** (`valid_from`, `valid_to`): When the fact was genuinely true in the real-world software system.

#### Exact Historical Boundaries (`valid_to_exact`)
When a system transition occurs, `valid_to` records when the rule ceased to apply. To distinguish between precise, verified historical boundaries and unconfirmed runtime transitions:
- `valid_to_exact: true`: Explicitly verified historical cessation (e.g. "We migrated from Vue 2 to Vue 3 on 2025-01-15").
- `valid_to_exact: false`: Auto-stamped or runtime transition subject to observation lag.

```typescript
export interface MemoryEntry {
  valid_from?: string;
  valid_to?: string;
  /** T-082: Explicit flag indicating whether valid_to is a known exact historical cessation boundary. */
  valid_to_exact?: boolean;
}
```

#### Point-in-Time `evaluateAsOf` Protocol
When querying historical state via `as_of: "2025-06-01T00:00:00Z"`:
1. If $T_{\text{as\_of}} < \text{valid\_from}$, the fact had not yet occurred $\implies$ `invalid`.
2. If $T_{\text{as\_of}} \ge \text{valid\_from}$ and `valid_to` is unset $\implies$ `valid`.
3. If $T_{\text{as\_of}} < \text{valid\_to}$, the fact was active $\implies$ `valid`.
4. If $T_{\text{as\_of}} \ge \text{valid\_to}$:
   - If `valid_to_exact === true` $\implies$ `invalid`.
   - If `valid_to_exact === false` $\implies$ **`undetermined`** (`reason: "inexact_boundary_observation_lag"`).

No arbitrary dates are invented. Callers receive `{ results, undetermined }` allowing agents to reason about uncertainty honestly.

#### Point-in-Time Temporal Retrieval (`searchTemporal`)
`searchTemporal(store, query, atTime, options)` searches memories as of `atTime`, default-excluding superseded memories while returning undetermined boundary candidates.

---

### B. The Five Canonical Lifecycle Verbs (`T-084`)

Memory modifications must carry explicit semantics rather than generic overwrites. Muse Memory provides five typed lifecycle verbs:

```typescript
export type LifecycleVerb = "change" | "end" | "correct" | "revert" | "forget";
```

| Verb | Semantics | Audit Trail |
| :--- | :--- | :--- |
| **`change`** | Replaces an active memory with a newer truth, setting `valid_to` on the old and marking it `superseded`. | `lifecycle_change` |
| **`end`** | Marks a fact as ceased in the real world without introducing a replacement. Sets `valid_to` and `status: 'historical'`. | `lifecycle_end` |
| **`correct`** | In-place errata correction (fixing typos, wrong ports, or syntax) without incrementing lifecycle generation. | `lifecycle_correct` |
| **`revert`** | Restores an accidentally superseded or ended memory back to `confirmed` status. | `lifecycle_revert` |
| **`forget`** | Right-to-be-forgotten / GDPR deletion. Defaults to soft tombstoning (`deleted_at`); supports `--hard` for total physical excision. | `lifecycle_forget` |

Exposed via the `memory_lifecycle` MCP tool and `store.ts` APIs.

---

### C. Keep-Both Conflicts Ledger (`T-086`)

Following the Graphiti and Mnemosyne architecture principles, **Muse Memory never deletes conflicting memories**. Contradictions are first-class data citizens.

#### SQLite `conflicts` Table (Migration v6)
```sql
CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,
  memory_a_id TEXT NOT NULL,
  memory_b_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'resolved'
  conflict_type TEXT NOT NULL,         -- 'direct' | 'scoped' | 'temporal'
  confidence REAL DEFAULT 1.0,
  reason TEXT,
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution_strategy TEXT,            -- 'supersede' | 'keep_both' | 'historical' | 'reject'
  resolved_by TEXT,
  data TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conflicts_status ON conflicts(status);
CREATE INDEX IF NOT EXISTS idx_conflicts_pair ON conflicts(memory_a_id, memory_b_id);
```

When an agent flags a contradiction via `flagConflict()`:
1. Both memories are preserved in the `memories` table with `status: 'conflicted'`.
2. A durable conflict record is inserted into `conflicts`.
3. Resolution via `resolveConflict(store, conflictId, { strategy })` updates the conflict record and transitions memories atomically without data loss.

---

### D. Scoped Invalidation Engine (`T-087`)

A major defect in earlier agent memory engines is false-positive contradiction across disjoint scopes (Graphiti #1728):
> *Memory A: "Development server binds to port 3000"*  
> *Memory B: "Production server binds to port 443"*  
> *Naive Engine: "Conflict detected on port! Invalidate Memory A!"*

Muse Memory enforces **Semantic Fact Triple Alignment** before asserting contradiction:

$$\text{Conflict} \iff (E_1 = E_2) \land (R_1 = R_2) \land (\text{Scope}_1 = \text{Scope}_2) \land (T_1 \ne T_2)$$

```typescript
export interface SemanticFactTriple {
  entity: string;    // e.g. "server"
  relation: string;  // e.g. "port"
  target: string;    // e.g. "3000" vs "443"
  scope?: string;    // e.g. "dev" vs "prod"
}
```

- When entities differ (e.g. caching vs compression) $\implies$ **No conflict**.
- When scopes differ (e.g. dev port 3000 vs prod port 443, macOS desktop theme vs mobile theme) $\implies$ **Coexist peacefully**.
- When entity, relation, and scope match but targets contradict $\implies$ **Genuine contradiction flagged**.

---

### E. Claim-Based Contradiction Detection (`T-320`)

The scoped-invalidation rule above governs *author-supplied* fact triples. Everything
else — the free-text memories an agent actually writes — is compared by extracting
**polarity claims**: what a subject is, under which relation, with which target
value, in which scope.

```typescript
export interface PolarityClaim {
  entity: string;    // "wiki recompile gate"
  relation: string;  // "status" | "database" | "port" | "protocol" | "runtime" | "theme" | "policy"
  target: string;    // "enabled" | "postgresql" | "3000"
  scope?: string;    // "production" | "tier 2"
}
```

$$\text{Conflict} \iff (\text{relation}_1 = \text{relation}_2) \land (\text{subject}_1 \approx \text{subject}_2) \land \text{scopesCompatible} \land (T_1 \ne T_2)$$

- **Subject-bound.** Two memories contradict only when they make opposing
  statements *about the same thing*. "The team server enables bearer token
  authentication" and "The team server enables the SSE hub" are not in conflict
  because they are not opposite claims.
- **Scope-aware.** "Pooling is enabled in production" and "pooling is disabled on
  localhost" are distinct contextual truths, not a contradiction. A scoped claim
  also never contradicts an unscoped one: the scoped claim *refines* the general
  claim rather than opposing it.
- **Rationale-aware.** For technology claims the trailing phrase is usually a
  rationale ("uses bun runtime for fast startup"), so it only counts as a scope
  when it names a real environment.

> **Why this matters.** Flagging a pair moves **both** memories to `conflicted`.
> That costs 25 health points each — four false positives fail the store-integrity
> pillar outright — and removes both memories from every future sync broadcast,
> while still serving them into agent prompts. A false negative only leaves a
> tension unreported, so detection is deliberately biased toward precision.

Before `T-320` the engine tested seven bare regex pairs against the concatenated
title and content of both sides. Any two memories that happened to contain an
"enable"-ish and a "disable"-ish word were flagged, regardless of subject or
context. Measured against ten realistic non-contradictory pairs, it flagged
**8 of 10**. The calibrated engine flags **0 of 10**.

#### Dry-run surfaces

Detection never has to be a blind write:

| Surface | Effect |
| :--- | :--- |
| `memory conflicts` | Lists the conflicts recorded in the keep-both `conflicts` table. |
| `memory conflicts --dry-run` | Read-only scan reporting the pairs the engine **would** flag. |
| `propose({ checkConflict: true, conflictDryRun: true })` | Detects and audit-logs (`conflict_detected_dry_run`) without flagging either memory. |
| `detectConflict(store, candidate, { dryRun: true })` | Returns the detection with `dryRun: true` and mutates nothing. |

The dry-run scan is the operator's preview for peer-to-peer sync ingestion, which
is the one path that flags contradictions automatically.

---

### F. Federation Handshake Protocol (`T-088`)

In distributed monorepos and mesh-mode multi-agent swarms, isolated subagents may discover and flag conflicts independently.

#### Canonical Pair Deduplication Key
To prevent mirrored duplicates (`(A, B)` vs `(B, A)`), dedup keys are strictly canonicalized:
$$\text{key}(A, B) = \text{SHA256}(\min(A, B) + ":" + \max(A, B))$$

#### Handshake Sequence
```
Peer Agent A                                                Peer Agent B
     │                                                           │
     │ 1. initiateFederationHandshake(localConflicts)            │
     ├──────────────────────────────────────────────────────────►│
     │    Packet: { conflicts, checksum, timestamp }             │ 2. Deduplicate pairs
     │                                                           │ 3. Propagate resolutions:
     │                                                           │    • supersede
     │                                                           │    • keep_both
     │                                                           │    • reject
     │ 4. Result: { merged, resolved, unresolved }               │
     │◄──────────────────────────────────────────────────────────┤
```

Gossiped contradictions arriving during `ingestKnowledge()` automatically register in the local SQLite `conflicts` table.

---

### G. Provenance Veracity Ranking (`T-089`)

To protect context from model hallucinations, prompt injection, and agent inbreeding, memories are assigned canonical veracity weights based on origin:

| Provenance Class | Weight | Scorer Impact | Tie-Breaker | Typical Origin |
| :--- | :---: | :---: | :---: | :--- |
| **`user`** | **1.0** | **+0.15 rank bonus** | **+0.015** | Direct principal input, `user-confirmed`, `authoritative` |
| **`agent`** | **0.7** | **0.0 baseline** | **0.000** | Autonomous model inferences, assistant observations |
| **`external`** | **0.5** | **-0.10 discount** | **-0.010** | Web scrapes, crawler imports, unvetted documentation |
| **`system`** | **0.3** | **-0.20 discount** | **-0.020** | Background daemons, synthetic rules, automated sweeps |

```typescript
// Formula: veracityBonus = (weight - 0.7) * 0.5
// user:     (1.0 - 0.7) * 0.5 = +0.15
// agent:    (0.7 - 0.7) * 0.5 =  0.00
// external: (0.5 - 0.7) * 0.5 = -0.10
// system:   (0.3 - 0.7) * 0.5 = -0.20
```

#### Context Filtering (`minVeracity`)
Querying with `minVeracity: "agent"` (0.7) filters out untrusted external crawls and synthetic background rules into `withheld` (`reason: "low_veracity_source"`), preserving pure agent and human context.

---

### H. `src_ts` Evidence-Age Stamping (`T-090`)

A newly proposed memory must never appear fresher than its underlying source document. When ingesting a transcript or documentation page from 6 months ago, setting `created_at` to today would falsely give it near-zero recency decay.

#### The Evidence-Age Invariant
$$\text{Effective Age} = \max(\text{daysSince}(\text{event\_time}), \text{daysSince}(\text{src\_ts}))$$

- SQLite Migration 7 adds `src_ts TEXT` with index `idx_memories_src_ts`.
- `computeDecayScore`, `computeStaleness`, and `recencyDecay` evaluate elapsed days relative to $\min(\text{reference\_time}, \text{src\_ts})$.
- Timeless rules and immutable constraints remain exempt ($R(t) = 1.0$).

---

## 4. Stimulate: Developer Runbooks & MCP Recipes

### Recipe 1: Point-in-Time Historical Investigation
Inspect what your agent knew as of July 1st, 2025:

```typescript
// MCP Tool Call: search
{
  "query": "authentication session jwt expiry",
  "as_of": "2025-07-01T00:00:00.000Z"
}

// Result:
{
  "results": [
    { "id": "m_auth_jwt_v1", "title": "JWT expiry is 15 minutes", "score": 0.88 }
  ],
  "undetermined": [
    { "id": "m_auth_jwt_v2", "title": "JWT refresh rotation", "score": 0.82 }
  ],
  "as_of": "2025-07-01T00:00:00.000Z"
}
```

### Recipe 2: The Five Lifecycle Verbs in Action
```typescript
// 1. Correct an errata without changing version lineage
await memory_lifecycle({
  verb: "correct",
  id: "m_db_config",
  content: "Database pool max connections is 25 (corrected from 20)",
  reason: "Typo in initial configuration notes"
});

// 2. Cease a fact that no longer applies
await memory_lifecycle({
  verb: "end",
  id: "m_legacy_auth",
  valid_to: "2026-01-01T00:00:00Z",
  reason: "Legacy basic auth deprecated in v2"
});

// 3. Revert an accidental deprecation
await memory_lifecycle({
  verb: "revert",
  id: "m_legacy_auth",
  reason: "Reactivated for enterprise customer transition window"
});
```

### Recipe 3: High-Veracity User Context Query
Query context strictly limited to authoritative user directives and verified agent observations:

```typescript
// MCP Tool Call: get_context
{
  "query": "deployment target architecture",
  "min_veracity": "agent" // blocks external web scrapes (0.5) and synthetic daemons (0.3)
}
```

---

## 5. Verification & Health Audit Checklist

Before releasing or merging features interacting with temporal memory and contradictions:

- [x] **Schema Integrity**: Verify SQLite migrations 5, 6, and 7 pass cleanly (`bun test test/migrate.test.ts`).
- [x] **Bi-Temporal Precision**: Verify `as_of` queries return `{results, undetermined}` without date invention (`bun test test/as_of_queries.test.ts`).
- [x] **Conflict Retention**: Verify contradictions populate the `conflicts` table without deleting either memory (`bun test test/conflicts_table.test.ts`).
- [x] **Scoped Coexistence**: Verify distinct platform/environment scopes coexist without false-positive conflict (`bun test test/scoped_invalidation.test.ts`).
- [x] **Contradiction Calibration**: Verify the claim-based engine clears a labelled fixture with precision and recall above 0.9 (`bun test test/contradiction_calibration.test.ts`).
- [x] **Federation Dedup**: Verify canonical pair hashing in mesh handshakes (`bun test test/federation_handshake.test.ts`).
- [x] **Veracity Rank Boosts**: Verify user inputs receive +0.15 boost and break ties over agent inferences (`bun test test/veracity_ranking.test.ts`).
- [x] **Evidence Age Capping**: Verify `src_ts` restricts freshness decay (`bun test test/src_ts_evidence_age.test.ts`).
