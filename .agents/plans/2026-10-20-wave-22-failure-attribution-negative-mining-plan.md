# Wave 22: Failure Attribution & Negative Memory Mining Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement scoped failure attribution with decaying strikes (T-313), trajectory fix-pair mining into candidate negative memories (T-144), source-tagged recall hits with HOT.md cache (T-314), and LangMem logarithmic frequency ranking (T-315).

**Architecture:** Extend existing feedback, utility, distillation, and retrieval scoring engines in-process with zero external daemons. Keep schema backward-compatible, enforce template-gated test reproduction, and maintain sub-2ms retrieval performance.

**Tech Stack:** TypeScript, Bun, SQLite (via `bun:sqlite`), FTS5, Vitest/Bun test runner.

## Global Constraints
- Pinned to Bun runtime (`bun test`, `bun run build`, `tsc --noEmit`).
- Zero resident external daemons; all logic executes in-process.
- Zero secret exposure: Vibeguard SecretScan on all mined error snippets and terminal commands.
- Constitutional protection gate: `type: "constraint"`, `temporal_mode: "timeless"`, or `salience >= 0.95` can never be auto-disputed.
- Template-gated reproduction commands: only allowlisted templates (`bun test <relative-file>`, `bunx tsc --noEmit`, `node --check <file>`) allowed as `test_command`.

---

### Task 1: Scoped Failure Attribution (`T-313`)

**Files:**
- Modify: `src/learning/feedback.ts`
- Test: `test/failure_attribution.test.ts`

**Interfaces:**
- Produces: `isMemoryRelevantToFailure(entry: MemoryEntry, context: FailureRelevanceContext): boolean`
- Updates: `evaluateSessionOutcomes(store: Store, options: SessionOutcomeEvaluationOptions): SessionOutcomeResult`

- [ ] **Step 1: Write failing tests for failure relevance detection**
Create `test/failure_attribution.test.ts` asserting:
1. An entry with an anchor matching the failure file/symbol receives `regression: true`.
2. An entry whose anchor does not match the failure context is classified as a bystander and does NOT receive `regression: true`.
3. Low-specificity symbols (e.g. `id`, `get`) do not trigger false attribution.

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test test/failure_attribution.test.ts`
Expected: FAIL (cannot find `isMemoryRelevantToFailure` or bystander memory gets regression).

- [ ] **Step 3: Implement `isMemoryRelevantToFailure` in `src/learning/feedback.ts`**
Add relevance matching:
1. Anchor file basename and symbol match via `matchesWordBoundary` with specificity $> 0.3$.
2. Affected path match in `entry.graph?.affected_paths`.
3. Test command match in `entry.test_command`.
Only mark `regression = isRegression && isRelevant` in `evaluateSessionOutcomes`.

- [ ] **Step 4: Run test to verify it passes**
Run: `bun test test/failure_attribution.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/learning/feedback.ts test/failure_attribution.test.ts
git commit -m "feat(learning): scope failure attribution to anchor-relevant memories (closes T-313 part 1)"
```

---

### Task 2: Decaying Strike Engine & Constitutional Gate (`T-313`)

**Files:**
- Modify: `src/types.ts`
- Modify: `src/quality/utility.ts`
- Test: `test/failure_attribution.test.ts`

**Interfaces:**
- Extends: `MemoryUtility` with `regression_strikes`, `last_regression_at`, `clean_runs_since_regression`, `last_regression_session`.
- Updates: `recordApplicationOutcome(store: Store, options: ApplicationOutcomeOptions): MemoryEntry`

- [ ] **Step 1: Write failing tests for strike decay, session dedup, and constitutional gate**
In `test/failure_attribution.test.ts`, add test cases:
1. Re-running the failing command 3 times within the same session ID adds at most 1 strike.
2. 2 consecutive clean applications decay active strikes by 1.
3. Simulating 30 days passing via `now?: number` parameter decays strikes by 1.
4. Auto-dispute triggers only when `regression_strikes >= 3`.
5. `type: "constraint"` or `salience >= 0.95` memories are immune to auto-dispute.

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test test/failure_attribution.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement decaying strikes and constitutional gate in `src/quality/utility.ts`**
1. Add `now?: number` and `sessionId?: string` to `ApplicationOutcomeOptions`.
2. Update `ensureUtility` with default zero fields.
3. In `recordApplicationOutcome`:
   - If `options.regression`: check if `last_regression_session === options.sessionId`. If not, increment `regression_strikes`. Reset `clean_runs_since_regression = 0`.
   - If `options.success`: increment `clean_runs_since_regression`. If $\ge 2$, decay 1 strike and reset count. Also check if `now - last_regression_at > 30 days`.
   - Auto-dispute only if `regression_strikes >= 3` AND not constraint/salience $\ge 0.95$.
   - Log audit events `regression_strike`, `strike_decay`, and `dispute_triggered`.

- [ ] **Step 4: Run test to verify it passes**
Run: `bun test test/failure_attribution.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/types.ts src/quality/utility.ts test/failure_attribution.test.ts
git commit -m "feat(quality): add decaying strike counter and constitutional immunity (closes T-313 part 2)"
```

---

### Task 3: Trajectory Fix-Pair Mining (`T-144`)

**Files:**
- Modify: `src/learning/distill.ts`
- Modify: `src/compaction/harvester.ts`
- Test: `test/fix_pair_mining.test.ts`

**Interfaces:**
- Produces: `mineFixPairsFromObservations(observations: ObservationEvent[], options?: FixPairMiningOptions): FixPairCandidate[]`
- Integrates: `distillSessionObservations` & `harvestSessionMemories` to emit candidate negative memories.

- [ ] **Step 1: Write failing tests for fix-pair mining**
Create `test/fix_pair_mining.test.ts` asserting:
1. A failing test command followed by a green test run produces a candidate negative memory (`AVOID: ...`).
2. Read-only commands (`ls`, `cat`, `git status`) are rejected from remedy pairing.
3. Error signature normalization collapses repetitive compiler line-number shifts.
4. Secret tokens in error logs are scrubbed via Vibeguard before candidate creation.
5. Volume cap limits candidates to at most 3 per session.

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test test/fix_pair_mining.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `mineFixPairsFromObservations` in `src/learning/distill.ts`**
1. Traverse observations window, match failure $\to$ success within $\le 5$ events.
2. Check target affinity and exclude informational commands.
3. Normalize error text by stripping line/column coordinates and memory addresses.
4. Pass through `scanSecrets`.
5. Call `recordNegativeLesson(store, { confirmed: false, ... })` with volume cap of 3.
6. Connect into `distillSessionObservations` and `harvestSessionMemories`.

- [ ] **Step 4: Run test to verify it passes**
Run: `bun test test/fix_pair_mining.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/learning/distill.ts src/compaction/harvester.ts test/fix_pair_mining.test.ts
git commit -m "feat(learning): add trajectory fix-pair mining into negative memories (closes T-144)"
```

---

### Task 4: Source-Tagged Recall Hits & HOT.md (`T-314`)

**Files:**
- Modify: `src/compounding/temporal.ts`
- Modify: `src/retrieval.ts`
- Modify: `src/retrieval/ranking.ts`
- Test: `test/source_tagging_frequency.test.ts`

**Interfaces:**
- Produces: `getHotCandidateIds(store: Store, memoryDir: string): Set<string>`
- Extends: `ScoreFactors` with `source_channels?: RetrievalSourceChannel[]` and `sourceBonus: number`
- Updates: `computeFactors` and `rankAndRetrieveMemories`

- [ ] **Step 1: Write failing tests for HOT.md source tagging**
Create `test/source_tagging_frequency.test.ts` asserting:
1. Entries in `.memory/HOT.md` are tagged with channel `"hot"`.
2. Candidates with channel `"hot"` receive $+0.20$ bonus when applicable to the query.
3. Completely irrelevant hot entries receive $+0$ bonus (relevance gate prevents zombie distraction).
4. `deriveWhyRetrieved` outputs `source:hot` and `source:fts`.

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test test/source_tagging_frequency.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement memoized `HOT.md` lookup and source tagging**
1. In `src/compounding/temporal.ts`: add `getHotCandidateIds` with file `mtime` memoization.
2. In `src/retrieval/ranking.ts`: ingest `HOT.md` candidate IDs and track `candidateSources: Map<string, Set<RetrievalSourceChannel>>`.
3. In `src/retrieval.ts`: add `sourceBonus` to `ScoreFactors` in `computeFactors`, gated on non-zero applicability.
4. Update `deriveWhyRetrieved` with `source:*` reason tokens.

- [ ] **Step 4: Run test to verify it passes**
Run: `bun test test/source_tagging_frequency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/compounding/temporal.ts src/retrieval.ts src/retrieval/ranking.ts test/source_tagging_frequency.test.ts
git commit -m "feat(retrieval): wire HOT.md candidate source tagging into ranking (closes T-314)"
```

---

### Task 5: LangMem Frequency Rank Axis (`T-315`)

**Files:**
- Modify: `src/retrieval.ts`
- Modify: `src/retrieval/ranking.ts`
- Test: `test/source_tagging_frequency.test.ts`

**Interfaces:**
- Extends: `ScoreFactors` with `frequencyScore: number`.
- Updates: `computeFactors` with logarithmic LangMem formula.

- [ ] **Step 1: Write failing tests for logarithmic frequency curve**
In `test/source_tagging_frequency.test.ts`, assert:
1. `access_count = 0` produces `frequencyScore = 0`.
2. `access_count = 5` produces `frequencyScore ≈ 0.11`.
3. `access_count >= 50` smoothly caps at `0.25`.
4. Successful applications boost effective count $2\times$ faster than passive retrieval.
5. Recency boost adds $+0.05$ if accessed within 7 days.

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test test/source_tagging_frequency.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement LangMem frequency curve in `src/retrieval.ts`**
Replace linear `access_count * 0.02` with:
$$\text{effectiveCount} = \text{access\_count} + 2 \times (\text{utility.successful\_applications} \mathbin{??} 0)$$
$$\text{frequencyScore} = 0.25 \times \frac{\ln(1 + \text{effectiveCount})}{\ln(1 + 50)}$$
Incorporate 7-day recency bonus and 60-day decay. Expose in `ScoreFactors` and `deriveWhyRetrieved` (`freq:high`, `freq:moderate`).

- [ ] **Step 4: Run test to verify it passes**
Run: `bun test test/source_tagging_frequency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/retrieval.ts src/retrieval/ranking.ts test/source_tagging_frequency.test.ts
git commit -m "feat(retrieval): implement LangMem logarithmic frequency rank axis (closes T-315)"
```

---

### Task 6: Full Verification Gate & Clean Build

**Files:**
- Entire codebase

- [ ] **Step 1: Run full test suite**
Run: `bun test`
Expected: All 85+ test files pass, 0 failures.

- [ ] **Step 2: Run type check**
Run: `bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Run build**
Run: `bun run build`
Expected: Clean build, 0 warnings.

- [ ] **Step 4: Run pre-ship SecretScan**
Run: `bun ~/.config/LIFEOS/runtime/TOOLS/SecretScan.ts .`
Expected: 0 secrets detected.

---

### Task 7: Documentation & Agent Memory Synchronization (`/updatedocs` & `/updateagents`)

**Files:**
- Modify: `docs/failure-attribution-and-negative-mining.md` (new)
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `.agents/context/ticket-plan.md`
- Modify: `.agents/context/current.md`
- Modify: `.memory/CURRENT.md`

- [ ] **Step 1: Write detailed documentation**
Document scoped failure attribution, fix-pair mining, HOT.md source tagging, and LangMem frequency curves.

- [ ] **Step 2: Update CHANGELOG & README**
Record Wave 22 features, tickets `T-313`, `T-144`, `T-314`, `T-315`.

- [ ] **Step 3: Mark tickets landed in ticket-plan.md & update current.md**
Update tickets `T-313`, `T-144`, `T-314`, `T-315` from `[ ]` to `[x]`, advance shipped capabilities, and update working constraints.

- [ ] **Step 4: Commit documentation & agent context pass**
```bash
git commit -m "docs(wave-22): document failure attribution, fix-pair mining, and frequency ranking"
```
