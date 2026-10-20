# 🏛️ Wave 22 Design Specification: Failure Attribution & Negative Memory Mining

> **Version Target**: `v2.11.0`  
> **Status**: APPROVED SPECIFICATION  
> **Date**: 2026-10-20  
> **Author**: Muse (Chief Agency Orchestrator) & Nexus (Quality Gate)  
> **Tracked Tickets**: `T-313`, `T-144`, `T-314`, `T-315`  
> **Related Epics**: R17b (Ecosystem Teardown), v2 Gap Audit, LangMem Frequency Modeling

---

## 1. Executive Summary & Goals

Wave 22 hardens Muse Memory's cognitive learning and retrieval quality loops across four foundational axes:

1. **Scoped Failure Attribution (`T-313`)**: Scopes command and test regressions (`isRegression = exitCode !== 0`) strictly to memories with matching code anchors, affected paths, or specific symbols. Replaces the naive 3-strike immediate demotion with session-deduplicated strikes and a dual-decay counter (2 clean runs or 30 days), protecting innocent architectural guidelines and preferences from false-positive disputes.
2. **Trajectory Fix-Pair Mining (`T-144`)**: Detects sequential trajectories of `Error ➔ Remediation ➔ No Recurrence` across session observations. Distills them into candidate negative memories (`AVOID: ...`) with sanitized error reasons, verified alternatives, and template-safe reproduction commands.
3. **Source-Tagged Recall Hits & HOT.md (`T-314`)**: Connects the compiled `.memory/HOT.md` working cache directly into the retrieval engine, tagging candidate hits with origin channels (`hot`, `fts`, `vector`, `tree`, `distilled`) and applying relevance-gated provenance bonuses.
4. **LangMem Frequency Rank Axis (`T-315`)**: Upgrades linear access counters to a mathematically bounded logarithmic frequency curve, blending retrieval frequency with verified application success.

---

## 2. Invariants & Guardrails

- **Zero External Daemons**: All attribution, distillation, and scoring executes in-process via Bun and SQLite (`memory.db`).
- **Constitutional Protection Gate**: Memories marked with `type: "constraint"`, `temporal_mode: "timeless"`, or `salience >= 0.95` can never be auto-disputed by automated test evaluations.
- **Vibeguard Secret Defense**: All mined error snippets, terminal commands, and failure logs are scrubbed via `scanSecrets` before candidate creation or audit logging.
- **Template-Safe Test Commands (`T-001`)**: Reproduction commands must strictly conform to allowed safe templates (`bun test <relative-file>`, `bunx tsc --noEmit`, `node --check <file>`); arbitrary shell commands are kept strictly in documentation text.
- **Zero-Migration Compatibility**: New utility metrics live safely within the existing `data` JSON blob and lazily backfill on access without altering SQLite table structures.

---

## 3. Detailed Component Architecture

### Section 1: Scoped Failure Attribution & Decaying Strike Engine (`T-313`)

#### 1.1 Relevance Detection (`isMemoryRelevantToFailure`)
In `src/learning/feedback.ts`:
```typescript
export interface FailureRelevanceContext {
  command?: string;
  logs?: string;
  exitCode: number;
  project: string;
}

export function isMemoryRelevantToFailure(
  entry: MemoryEntry,
  context: FailureRelevanceContext,
): boolean;
```
A memory is relevant to a failure if and only if:
1. **Code Anchors**: Any anchor file or symbol in `entry.anchors` matches the failure context using word boundaries:
   - File match: `matchesWordBoundary(context.command + " " + context.logs, anchor.file)` or exact basename match.
   - Symbol match: Symbol has `calculateSymbolSpecificity(anchor.symbol) > 0.3` and `matchesWordBoundary(context.logs, anchor.symbol)`.
2. **Affected Paths**: Any path in `entry.graph?.affected_paths` matches paths referenced in `context.command` or `context.logs`.
3. **Reproduction Command**: `entry.test_command` or `entry.negative?.reproduction_command` matches `context.command`.

Memories without anchor or symbol affinity are classified as **bystanders** and are exempt from regression strikes.

#### 1.2 Data Structures & Strike State
In `src/types.ts`:
```typescript
export interface MemoryUtility {
  retrieval_count: number;
  application_count: number;
  successful_applications: number;
  failed_applications: number;
  regressions: number;
  contradictions: number;
  reuse_success_rate: number;
  last_applied_at?: string;
  // Wave 22 Additions (T-313)
  regression_strikes?: number;          // Active un-decayed corroborated strikes (0-3)
  last_regression_at?: string;          // ISO timestamp of latest attributed failure
  last_regression_session?: string;     // Session ID to deduplicate retry loops
  clean_runs_since_regression?: number; // Count of clean runs since last strike
}
```

#### 1.3 Strike Accumulation, Deduplication & Decay Dynamics
In `src/quality/utility.ts`:
- **Session Deduplication**: At most **1 regression strike** is added per session (or 10-minute window) per memory, regardless of how many times a test is retried in that turn.
- **Dual Decay Ladder**:
  - **Usage Decay**: Each consecutive successful application increments `clean_runs_since_regression`. Every **2 clean runs**, `regression_strikes = Math.max(0, regression_strikes - 1)`.
  - **Time Decay**: If `now - last_regression_at > 30 days`, active strikes decay by 1.
- **Demotion Threshold**:
  - `entry.status` flips from `"confirmed"` to `"disputed"` **only if**:
    $$\text{regression\_strikes} \ge 3 \quad \text{AND} \quad \text{entry.type} \ne \text{"constraint"} \quad \text{AND} \quad \text{entry.salience} < 0.95$$
  - When auto-disputed, an audit event `dispute_triggered` is logged with the full strike history.

---

### Section 2: Trajectory Fix-Pair Mining (`T-144`)

#### 2.1 The Trajectory Pattern
Session observations in `.memory/observations.jsonl` are inspected for pairs:
$$\text{Observation } A \text{ (Failure)} \xrightarrow{\le 5 \text{ turns}} \text{Observation } B \text{ (Success)}$$

#### 2.2 Target & Command Affinity Matching
To prevent pairing unrelated commands (e.g. `git push` network failure paired with `ls -la`), Event $B$ is validated against Event $A$:
1. **Exclude Informational Commands**: Event $B$ cannot be a read/informational command (`ls`, `cat`, `git status`, `pwd`, `echo`, `find`).
2. **Affinity Rules**: Event $B$ must satisfy at least one condition:
   - Same command or file target as Event $A$ (verifying the error was cleared).
   - Toolchain remedy verb (e.g. `bun add <pkg>`, `bun install`, package update) following a missing module/dependency error.
   - Same test suite or script with green exit code (`exitCode === 0`).

#### 2.3 Error Signature Normalization & Deduplication
- Error messages are normalized:
  - Strip dynamic line/column numbers (`:\d+:\d+`).
  - Strip memory addresses, timestamps, and thread IDs.
  - Collapse consecutive attempts of the same normalized signature into a single failure block.
- Deduplication Hash:
  $$\text{dedupHash} = \text{sha256}(\text{normalizedApproach} + "::" + \text{normalizedErrorSignature})$$

#### 2.4 Candidate Proposal
Via `recordNegativeLesson(store, ...)` in `src/learning/negative.ts`:
- `title`: `AVOID: <concise summary of failed approach>`
- `status`: `"candidate"` (never auto-promoted)
- `salience`: 0.75
- `temporal_mode`: `"timeless"`
- `failed_approach`: Event $A$ command/input
- `failure_reason`: Sanitized error text (Vibeguard-scrubbed)
- `alternative_recommended`: Event $B$ successful remediation command
- `source_ids`: `[eventA.id, eventB.id]`
- `tags`: `["fix-pair", "mined-trajectory", "anti-pattern"]`
- **Volume Cap**: Maximum **3 candidates** proposed per harvest pass.

---

### Section 3: Scoring Model & Retrieval Pipeline (`T-314` & `T-315`)

#### 3.1 Retrieval Source Channels (`T-314`)
```typescript
export type RetrievalSourceChannel = "hot" | "fts" | "vector" | "tree" | "distilled";
```

#### 3.2 In-Memory HOT.md Cache
In `src/compounding/temporal.ts`:
- Maintain an in-memory `hotCacheState: { mtime: number; ids: Set<string> }`.
- Check file `mtime` before reading `.memory/HOT.md`. If unchanged, return memoized `ids` in $<1\mu\text{s}$.

#### 3.3 Relevance-Gated Source Bonus
In `src/retrieval.ts`:
- Base source weights:
  - `hot`: $+0.20$
  - `fts`: $+0.15$
  - `vector`: $+0.15$
  - `tree`: $+0.10$
  - `distilled`: $+0.08$
- **Relevance Gate**:
  `sourceBonus` is applied **only if**:
  $$\text{baseApplicability} > 0 \lor \text{bm25Match} > 0 \lor \text{exactSymbolMatch} > 0 \lor \text{semanticMatch} > 0$$
  This prevents hot memory "zombie distraction" on totally unrelated queries.
- Multi-channel cap: $\text{sourceBonus} \le +0.25$.

#### 3.4 Logarithmic LangMem Frequency Axis (`T-315`)
In `computeFactors` (`src/retrieval.ts`):
- Effective Count:
  $$\text{effectiveCount} = \text{access\_count} + 2 \times (\text{utility.successful\_applications} \mathbin{??} 0)$$
- Frequency Curve:
  $$\text{frequencyScore} = 0.25 \times \frac{\ln(1 + \text{effectiveCount})}{\ln(1 + 50)}$$
- Recency Modulation:
  - If `daysSince(last_accessed_at) <= 7`: $+0.05$ boost.
  - If `daysSince(last_accessed_at) > 60`: frequency bonus decayed by $0.7\times$.
- Expose `frequencyScore` and `source_channels` in `ScoreFactors` and `deriveWhyRetrieved`.

---

## 4. Error Handling & Audit Telemetry

### 4.1 Defensive Try/Catch Wrappers
- All failure evaluation and fix-pair mining calls run wrapped in try/catch blocks; errors emit `console.warn` and return neutral results without failing agent turns.
- Timestamp injection (`now?: number`) is supported on all utility and evaluation methods to guarantee 100% deterministic testing.

### 4.2 Structured Audit Events
Log four distinct operations to `.memory/audit.jsonl`:
1. `regression_strike`: Memory ID, matched anchor, failing command, strike count.
2. `strike_decay`: Memory ID, decay reason (`clean_runs` or `time`), remaining strikes.
3. `dispute_triggered`: Memory ID, total regressions, corroborating strike history.
4. `fix_pair_mined`: Candidate ID, failed approach, successful remedy.

---

## 5. Verification & Test Plan

| Test File | Target Ticket | Key Assertions |
|---|---|---|
| `test/failure_attribution.test.ts` | `T-313` | - Anchor/symbol match increments strike<br>- Bystander memory ignored on exit != 0<br>- 1 strike max per session retry loop<br>- 2 clean runs decay strike<br>- 30 days decay strike<br>- Constraints cannot be auto-disputed |
| `test/fix_pair_mining.test.ts` | `T-144` | - Error + success pairs into candidate negative memory<br>- Informational commands (`ls`, `pwd`) rejected as remedies<br>- Normalized error deduplication<br>- Vibeguard secret scrubbing<br>- Session volume capped at 3 |
| `test/source_tagging_frequency.test.ts` | `T-314`, `T-315` | - Memoized `HOT.md` candidate lookup<br>- Irrelevant hot entries receive zero bonus<br>- Logarithmic frequency curve ($0 \to 0, 5 \to \approx 0.11, \ge 50 \to 0.25$)<br>- `deriveWhyRetrieved` outputs `source:*` and `freq:*` tokens |

### Gate Verification Commands
1. `bun test test/failure_attribution.test.ts test/fix_pair_mining.test.ts test/source_tagging_frequency.test.ts`
2. `bun test` (full suite, 527+ tests green)
3. `bunx tsc --noEmit` (clean, 0 type errors)
4. `bun run build` (build completes without warnings)
5. `bun ~/.config/LIFEOS/runtime/TOOLS/SecretScan.ts .` (0 secret leaks)
