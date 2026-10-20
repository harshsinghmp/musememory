# Scoring Refinements & Abstract Sidecars (Wave 19)

> **Specification & Guide for Wave 19**: Retrieval scoring enhancements, query-intent biases, effective score computation, RRF multi-list fusion, typed candidate decision provenance, clean-room L0/L1 abstract sidecars, ratio-batched refresh, resident INDEX route-mapping, and tier budgets with provenance.

---

## 1. Overview & Architectural Goals

Wave 19 delivers critical precision, latency, and token efficiency upgrades to the Muse Memory engine:

| Ticket | Capability | Module | Core Functionality |
|---|---|---|---|
| **T-118** | Query-Intent Bias Multipliers | `src/retrieval/intent_bias.ts` | Dynamically biases scores based on detected or inferred task intent (e.g. `feature`, `bugfix`, `refactor`, `review`, `architecture`). |
| **T-119** | Effective Score Formula | `src/retrieval/effective_score.ts` | Formalizes `effective_score = base × reinforcement × decay` with utility reinforcement boosts and floor limits. |
| **T-120** | Reciprocal Rank Fusion (RRF) | `src/retrieval/rrf.ts` | Multi-list reciprocal rank fusion with weight tuning and A/B variant presets (control/A vs treatment/B). |
| **T-121** | Typed Candidate Drop/Keep Reasons | `src/retrieval/candidate_reasons.ts` | Granular, typed audit tokens explaining why each candidate memory was retained or pruned during retrieval. |
| **T-122** | L0/L1 Abstract Sidecars | `src/store/sidecars.ts` | Clean-room MIT implementation of <=120 character single-line L0 summaries and structured L1 abstracts with dual-layer disk & SQLite caching. |
| **T-123** | Ratio-Batched Sidecar Refresh | `src/store/sidecars.ts` | Bounded, progressive refresh of stale/missing sidecars to prevent write-time latency spikes. |
| **T-124** | Resident INDEX Route-Map | `src/orchestrator/route_map.ts` | In-memory indexing of project, tag, symbol, path, and type routes for sub-millisecond zero-I/O candidate routing. |
| **T-125** | Tier Budgets as Named Constants | `src/retrieval/tier_budgets.ts` | Centralized token budgets with documented origin ADRs, architectural rationales, token ceilings, and SLA targets. |

---

## 2. Query-Intent Bias Multipliers (T-118)

Queries exhibit differing information needs depending on the agent's active operational mode:

```typescript
import { detectQueryIntent, computeIntentMultiplier, INTENT_BIAS_TABLE } from "musememory";

// Auto-detect intent from prompt or query
const intent = detectQueryIntent("fix regression in PostgreSQL connection pool");
// -> "bugfix"

// Compute multiplier for an entry
const multiplier = computeIntentMultiplier(intent, entry);
// E.g., decision/negative memories boosted by 1.25x for bugfix intents
```

When calling `rankAndRetrieveMemories` or `resolveMuseContext`, pass `task_intent` or let the engine infer it:

```typescript
const context = await resolveMuseContext(store, process.cwd(), {
  query: "refactor memory store",
  task_intent: "refactor",
});
```

---

## 3. Effective Score Formula (T-119)

Rather than ad-hoc weight additions, the effective score unifies relevance, reinforcement counter, reuse utility, and temporal decay:

$$\text{effective\_score} = \text{base\_score} \times \text{reinforcement\_multiplier} \times \text{decay\_factor}$$

Where:
- $\text{reinforcement\_multiplier} = \text{clamp}(1.0 + 0.05 \times \text{reinforcement} + \text{utility\_delta}, 0.2, 2.0)$
- $\text{decay\_factor} = \max(0.1, \text{computeDecayScore}(...))$

```typescript
import { computeEffectiveScore } from "musememory";

const effective = computeEffectiveScore(baseScore, entry, factors);
```

---

## 4. Reciprocal Rank Fusion (RRF) & A/B Tuning (T-120)

For multi-list hybrid search (combining lexical BM25, FTS5, and vector semantic similarity), RRF merges ranked candidate lists:

$$RRF(d) = \sum_{m \in M} \frac{w_m}{k + r_m(d)}$$

### A/B Variant Presets:
- **Variant A (`control`)**: $k = 60$, lexical weight $1.0$, semantic weight $1.0$, graph weight $0.5$.
- **Variant B (`treatment`)**: $k = 40$, lexical weight $0.8$, semantic weight $1.4$, graph weight $0.8$.

```typescript
import { reciprocalRankFusion, RRF_PRESETS } from "musememory";

const fused = reciprocalRankFusion(
  [
    { name: "lexical", items: lexicalHits },
    { name: "semantic", items: vectorHits },
  ],
  RRF_PRESETS.treatment
);
```

---

## 5. Typed Candidate Drop/Keep Reasons (T-121)

Every candidate memory evaluated during retrieval receives deterministic typed audit tokens explaining its selection:

- **Keep Reasons**:
  - `kept:active_constraint`: Working constraint from `CURRENT.md`.
  - `kept:timeless_rule`: Timeless architectural invariant.
  - `kept:verified_memory`: User-confirmed or oracle-verified entry.
  - `kept:high_relevance`: Strong keyword or semantic similarity.
  - `kept:high_utility`: Strong positive reuse track record.
  - `kept:within_budget`: Fits within knapsack token allocation.
- **Drop Reasons**:
  - `dropped:below_relevance_threshold`
  - `dropped:reinjection_suppressed`
  - `dropped:self_echo_suppressed`
  - `dropped:seen_chunk_suppressed`
  - `dropped:untrusted_provenance`
  - `dropped:token_budget_exceeded`

---

## 6. L0/L1 Abstract Sidecars (T-122)

To prevent broad-scan queries from overwhelming LLM context windows, abstract sidecars provide multi-resolution executive summaries:

- **L0 Abstract**: Single-line executive summary ($\le 120$ characters) truncated on whole-word boundaries with markdown stripped.
- **L1 Abstract**: Structured summary ($\le 250$ characters), key takeaways ($2\text{--}4$ bullet points), extracted entities, and token estimation.
- **Clean-room MIT Implementation**: Zero AGPL dependencies, completely self-contained in `src/store/sidecars.ts`.
- **Dual-Layer Caching**: Persisted to `.memory/.sidecars/<id>.json` and SQLite table `abstract_sidecars`.

```typescript
import { ensureAbstractSidecar, generateL0Abstract, generateL1Abstract } from "musememory";

const sidecar = ensureAbstractSidecar(store, memoryEntry);
console.log(sidecar.l0); // Single-line executive summary
console.log(sidecar.l1.summary); // Structured 2-sentence abstract
```

---

## 7. Ratio-Batched Sidecar Refresh (T-123)

Generates or updates sidecars progressively without blocking writes or introducing latency spikes:

```typescript
import { getSidecarStaleness, refreshSidecarsRatioBatched } from "musememory";

// Check staleness across the store
const report = getSidecarStaleness(store);
console.log(`Stale ratio: ${(report.stale_ratio * 100).toFixed(1)}%`);

// Refresh up to 25% of stale entries in this tick
const result = refreshSidecarsRatioBatched(store, {
  ratio: 0.25,
  maxBatch: 25,
});
console.log(`Refreshed ${result.refreshed_count} sidecars in ${result.duration_ms}ms`);
```

---

## 8. Resident INDEX Route-Map (T-124)

Maintains an in-memory route index of memories partitioned by:
- `project:<name>`
- `tag:<tag>`
- `symbol:<symbol_name>`
- `path:<file_path>`
- `type:<memory_type>`

```typescript
import { getOrBuildResidentRouteMap, matchResidentRoutes } from "musememory";

const routeMap = getOrBuildResidentRouteMap(store);
const result = matchResidentRoutes(routeMap, "PostgreSQL connection pool", {
  project: "data-service",
  symbol: "ConnectionPool",
});

console.log(result.prioritized_entry_ids); // Fast prioritized memory IDs in <1ms
```

Persisted to `.memory/INDEX.json` and automatically invalidated on store writes.

---

## 9. Tier Budgets as Named Constants with Provenance (T-125)

Eliminates magic numbers by formalizing retrieval token budgets and SLAs:

```typescript
import {
  TIER_0_DEFAULT_BUDGET, // 80 tokens (Manifest)
  TIER_1_DEFAULT_BUDGET, // 400 tokens (Routing Set)
  TIER_2_DEFAULT_BUDGET, // 4000 tokens (Bounded Bodies)
  USER_PROFILE_BUDGET_RATIO, // 0.20 (20% reserve for USER.md)
  getTierBudgetProvenance,
} from "musememory";

const prov = getTierBudgetProvenance(0);
console.log(prov.provenance.origin); // "ADR-012 / T-125 Tier Budgets Provenance Standard"
console.log(prov.provenance.targetSlaMs); // 2ms target SLA
```
