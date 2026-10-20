# 🛡️ Quality Telemetry, Honesty Gates & Retrieval Fault Signals

> **Wave 20 Architectural Standard**  
> **Status**: Shipped & Enforced on `dev` (`v2.10.0`)  
> **Scope**: `T-127` through `T-135`

---

## 📌 Executive Summary

Wave 20 introduces rigorous truthfulness, honesty gates, and fault observability throughout the Muse Memory cognitive engine. Rather than silently degrading, swallowing errors, or presenting ambiguous retrieval results, Muse Memory provides end-to-end transparency:
1. **Telemetry & Feedback Honesty**: Joins recall history with actual usage outcomes (`usage_rate`) to calculate real return-on-investment (ROI) for stored memories.
2. **Draft & Confident Segregation**: Explicitly separates unverified draft answers from confident knowledge using `[DRAFT]` markers and segregated response keys.
3. **AST Config-Honesty**: Audits configuration keys across TypeScript source code, classifying every key as `WIRED`, `DORMANT`, or `UNREAD`, failing builds if configuration invariants drift.
4. **Storage Version Compatibility**: Formalizes SQLite schema version history (`schema_versions.json`) and verifies forward/backward migration integrity in CI test matrices.
5. **Honest Benchmarks**: Enforces measured vs. claimed labeling on all benchmark scoreboards and micro-benchmarks.
6. **Constitution Contract**: Injects immutable constitutional directives at index 0, trim-exempt under zero token budgets, and strips write tools to enforce read-only safety.
7. **Degraded Fault Signals**: Surfaces `degraded: true` and diagnostic `degraded_notes` whenever circuit breakers trip, cache fallbacks engage, or upstream errors occur.
8. **Ground-Moved Anchor Audits**: Detects moved code symbols and relocated paths while staying strictly silent on undeterminable references without false alarms.
9. **Tiered Retrieval Ladder**: Progressively falls back through strict (Rung 1), standard (Rung 2), and loosened (Rung 3) criteria, explicitly badging loosened candidates with `[LOOSENED MATCH (Rung 3)]` and clear rationale.

---

## 🔬 Core Capabilities & Specifications

### 1. Recall→Usage Telemetry Join (`T-127`)
- **Module**: `src/quality/telemetry.ts`
- **Telemetry Event**: `recordRecallUsageJoin(memoryId, recalled, used, sessionTurn)`
- **Key Metrics**:
  - `recall_count`: Total times a memory was injected into context.
  - `used_count`: Total times an agent actually referenced or synthesized the memory.
  - `usage_rate = used_count / recall_count`: Precision ratio feeding utility reinforcement and retention pruning.
  - `net_roi_score`: Normalized value reflecting whether a memory justifies its token context expenditure.

### 2. Draft Marking & Confident Segregation (`T-128`)
- **Modules**: `src/store.ts`, `src/retrieval.ts`, `src/orchestrator/context.ts`
- **Draft Marker**: Memories with status `draft` or `candidate` are tagged with `is_draft: true` and visually prefaced with `[DRAFT]` in markdown context headers.
- **Segregated Results**:
  - `confident_answers`: Scored memories meeting confidence thresholds that are confirmed.
  - `draft_answers`: Separate list of draft or candidate memories returned without contaminating confident assertions.
  - `mode`: `"confident_match"` vs `"no_confident_match"`.

### 3. Config-Honesty AST Audit (`T-129`)
- **Module**: `src/config/honesty.ts`
- **CLI Command**: `bun run test:honesty` / `auditConfigHonesty()`
- **Status Classification**:
  - `WIRED`: Property is defined in schema and actively read/evaluated in runtime code.
  - `DORMANT`: Property is defined in schema but has no read occurrences across codebase.
  - `UNREAD`: Property is referenced in templates or tests but never consumed by application logic.
- **Build Enforcement**: Throws `ConfigHonestyViolationError` and fails the build when strict mode is active and dormant or unread configuration options exist.

### 4. Storage-Version Compatibility CI Matrix (`T-130`)
- **Module**: `test/storage_version_compat.test.ts`, `src/storage/versions.json`
- **Schema Ledger**: Tracks all database migration steps (`v1` to `v10+`), recording schema migration timestamps, added tables, and modified indexes.
- **CI Matrix Validation**: Executes upgrade runs from every historical schema snapshot to ensure zero table drop, zero loss of memories, and graceful schema backward-read tolerance.

### 5. Honest Benchmark Labels (`T-131`)
- **Module**: `src/benchmark/labels.ts`, `src/benchmark/suite.ts`
- **Labeling Standard**:
  - `Claimed`: Target theoretical SLA or marketing specification (e.g. `sub-50µs`, `sub-2ms`).
  - `Measured`: Actual latency measured on the active hardware and platform runtime.
  - `Honesty Delta`: Divergence between claimed SLA and measured performance, categorized as `HONEST_MET`, `HONEST_APPROX`, or `HONEST_DRIFTED`.

### 6. Constitution Contract (`T-132`)
- **Module**: `src/orchestrator/constitution.ts`, `src/orchestrator/context.ts`
- **Directives Injection**: Constitutional rules (`CANONICAL_CONSTITUTIONAL_RULES`) are always resolved and positioned at index 0 of context packing.
- **Trim-Exempt Guarantee**: Constitutional rules are never trimmed, truncated, or dropped—even when the available token budget is 0.
- **Write-Tool Safety**: `assertConstitutionWriteSafety` and `filterToolsForConstitution` automatically remove write tools from tool-calling agents during constitution-gated read-only sessions to prevent prompt injections from mutating invariants.

### 7. Degraded Fault Signals (`T-133`)
- **Module**: `src/retrieval/faults.ts`, `src/retrieval.ts`
- **Fault Representation**:
  ```typescript
  export interface DegradedFaultSignal {
    degraded: boolean;
    degraded_notes: string[];
    fault_notes?: string[];
  }
  ```
- **Context Banner**: When `degraded: true`, `formatDegradedFaultNotice` renders an alerting banner at the top of context packs:
  ```markdown
  > ⚠️ **DEGRADED CONTEXT FAULT NOTICE**:
  > - circuit_breaker_open: circuit breaker open after failure threshold
  ```

### 8. Ground-Moved Reporting for Anchors (`T-134`)
- **Module**: `src/anchors/resolver.ts`, `src/anchors.ts`
- **Ground Moved Detection**:
  - Compares symbol body hash and file path against recorded baselines.
  - If a symbol has moved to a new file, reports `ground_moved: true` with `relocated_path`.
- **Silent When Undeterminable**: If an anchor lacks a structural hash baseline and symbol cannot be resolved, it sets `undeterminable: true` and remains silent in alerts to avoid false alarms.

### 9. Tiered Retrieval Ladder (`T-135`)
- **Module**: `src/retrieval/ladder.ts`, `src/retrieval.ts`
- **Three-Rung Architecture**:
  1. **Rung 1 (Strict Match)**: Exact symbol match, active file alignment, or strict score $\ge 0.70$.
  2. **Rung 2 (Standard Match)**: Multi-factor BM25 + semantic retrieval with score $\ge 0.45$.
  3. **Rung 3 (Loosened Match)**: Relaxed score threshold $\ge 0.20$ or relaxed project scope to global.
- **Loosened Badging**: Every candidate admitted via Rung 3 receives:
  - `ladder_rung: 3`
  - `is_loosened: true`
  - `loosened_reason: "loosened_threshold: score 0.32 admitted below standard threshold (0.45)"`
  - Rendered title badge: `[LOOSENED MATCH (Rung 3) — <reason>]`
  - Advisory notice in context pack headers.

---

## 🧪 Verification Matrix

| Ticket | Component | Test Suite | Pass Count | Status |
|---|---|---|---|---|
| `T-127` | Recall-Usage Join | `test/recall_usage_telemetry.test.ts` | 6 passed | Shipped |
| `T-128` | Draft Marking | `test/draft_marking.test.ts` | 8 passed | Shipped |
| `T-129` | Config-Honesty AST | `test/config_honesty_ast.test.ts` | 6 passed | Shipped |
| `T-130` | Storage Compat CI | `test/storage_version_compat.test.ts` | 5 passed | Shipped |
| `T-131` | Honest Benchmarks | `test/honest_benchmark_labels.test.ts` | 6 passed | Shipped |
| `T-132` | Constitution Contract | `test/constitution_contract.test.ts` | 10 passed | Shipped |
| `T-133` | Degraded Faults | `test/degraded_fault_signals.test.ts` | 9 passed | Shipped |
| `T-134` | Ground-Moved Anchors | `test/anchor_ground_moved.test.ts` | 7 passed | Shipped |
| `T-135` | Tiered Ladder | `test/tiered_ladder_loosened.test.ts` | 8 passed | Shipped |
| **All** | **Full Suite** | `bun test` | **1268 passed** | **Green** |
