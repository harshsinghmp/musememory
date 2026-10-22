# Failure Attribution, Negative Memory Mining & Retrieval Compounding (Wave 22)

> **Status**: Production Ready · Shipped in `v3.0.0`  
> **Tickets Covered**: `T-313`, `T-144`, `T-314`, `T-315`  
> **Key Modules**: [`src/learning/feedback.ts`](../src/learning/feedback.ts), [`src/quality/utility.ts`](../src/quality/utility.ts), [`src/learning/distill.ts`](../src/learning/distill.ts), [`src/learning/negative.ts`](../src/learning/negative.ts), [`src/compounding/temporal.ts`](../src/compounding/temporal.ts), [`src/retrieval.ts`](../src/retrieval.ts)

---

## 1. Executive Summary

Wave 22 introduces closed-loop learning integrity and retrieval compounding across four major pillars:
1. **Scoped Failure Attribution (`T-313`)**: Eliminates the naive global failure penalty where any non-zero exit code penalized all memories recalled in a session. Replaces it with anchor-aware relevance matching, deduplicated per-session strikes, a dual-axis decaying strike counter (clean runs & elapsed time), and constitutional immunity for hard constraints.
2. **Trajectory Fix-Pair Mining (`T-144`)**: Mines candidate negative memories (`AVOID: ...`) from sequential observation logs adhering to the *Error ➔ Remediation ➔ No Recurrence* pattern. Filters non-remedial commands, sanitizes dynamic line numbers, scrubs secrets via Vibeguard, and enforces strict session volume caps.
3. **Source-Tagged Recall & HOT.md (`T-314`)**: Wires the compiled active working set in `.memory/HOT.md` directly into retrieval ranking. Extracts and memoizes candidate IDs with sub-millisecond mtime invalidation, applies a relevance-gated source bonus (+0.20), and tracks origin channels (`source:hot`, `source:fts`, `source:vector`).
4. **LangMem Logarithmic Frequency Rank Axis (`T-315`)**: Incorporates a sub-linear frequency curve ($0.25 \times \frac{\ln(1 + \text{effectiveCount})}{\ln(1 + 50)}$) into candidate scoring, granting double utility weight for verified applications and a 7-day recency bonus.

---

## 2. Scoped Failure Attribution (`T-313`)

### The Problem
Previously, when a command exited with a non-zero exit code (`exitCode !== 0`), every memory retrieved in the current session was marked as regressed (`isRegression = true`). If a memory accumulated 3 regressions, it was immediately demoted from `confirmed` to `disputed`. This caused severe false-positive demotions:
- A CSS styling memory retrieved during a session would be penalized when a backend JWT unit test failed.
- A command retry loop could levy 3 strikes in 5 seconds, auto-disputing valid architectural rules.
- Constitutional invariants and timeless project constraints were vulnerable to automated dispute.

### The Solution

#### A. Anchor & Path Relevance Gate (`isMemoryRelevantToFailure`)
Before attributing failure to a retrieved memory, the engine verifies relevance against the failed command and error output across four progressive tiers:
1. **Code Anchors**: Checks if the failure command or error stack trace references `anchor.file_path` (or its basename) or distinctive `anchor.symbol_name` (filtered by symbol specificity $> 0.3$).
2. **Graph Affected Paths**: Checks if any path in `entry.graph.affected_paths` matches the failure context.
3. **Reproduction Test Command**: Checks if `entry.test_command` is part of the executed command string.
4. **Distinctive Keyword Fallback**: If the entry has no anchors, extracts distinctive keywords (specificity $> 0.3$, length $\ge 4$) to verify topic relevance before applying attribution.

#### B. Per-Session Strike Deduplication
- Multiple consecutive failures within the same working session (e.g., test iteration, debugging retries) are deduplicated by `session_id`.
- At most **1 strike** can be levied against a memory per session.

#### C. Dual-Axis Decaying Strike Counter
Strikes are no longer permanent marks that inevitably lead to demotion:
- **Clean Run Decay**: If 2 consecutive clean runs pass without regressions, active strikes decay toward zero.
- **Temporal Inactivity Decay**: If 30 days elapse without recurring failure, active strikes decay toward zero.

#### D. Constitutional Gate & Corroborated Demotion
- Only memories with $\ge 3$ distinct, corroborated strikes are demoted to `status: "disputed"`.
- Demotion is strictly blocked for:
  - `type === "constraint"` (Constitutional constraints)
  - `temporal_mode === "timeless"` (Permanent project invariants)
  - `salience >= 0.95` (Core foundational architectural decisions)
- Demotion events trigger explicit audit trail events: `operation: "dispute_triggered"`.

---

## 3. Trajectory Fix-Pair Mining (`T-144`)

### The Pattern
The harvester scans `.memory/observations.jsonl` for the *Error ➔ Remediation ➔ No Recurrence* signature:
```
[Observation 1: Exit != 0] ──► [Observation 2: Remediation Command] ──► [Observation 3: Exit == 0]
 (Failure & Error Log)        (Code Edit or Specific Flag)             (Clean Execution)
```

### Safety & Hygiene Guards
1. **Affinity Filter**: Discards pairing if the remediation command is purely informational or non-mutating (e.g., `ls`, `cat`, `grep`, `pwd`, `git status`, `git branch`).
2. **Line Number Normalization**: Replaces dynamic compiler line/column coordinates (`:42:15`, `line 103`) with wildcards to avoid generating duplicate candidates across code shifts.
3. **Vibeguard Secret Scrubbing**: All error traces and mined command strings pass through `redactSecrets()` before drafting candidate records.
4. **Session Volume Cap**: At most 3 mined fix-pair candidates are produced per harvest pass to eliminate cognitive bloat.
5. **Negative Memory Structure**: Emitted candidates use `type: "fix"`, `title: "AVOID: <Error Reason>"`, and high initial salience with actionable remediation advice.

---

## 4. Source-Tagged Recall & HOT.md (`T-314`)

### Active Working Set Compounding
The engine pre-compiles active working context into `.memory/HOT.md`. Wave 22 integrates this artifact into the primary retrieval pipeline:
- **Memoized Reading (`readHotCandidateIds`)**: Fast sub-millisecond regex parsing with memoization keyed on `fs.statSync().mtimeMs`.
- **Source Channels Metadata**: Retrieved candidates are tagged with `source_channels: ("hot" | "fts" | "vector" | "tree" | "distilled")[]`.
- **Relevance-Gated Source Bonus**: Candidates present in `HOT.md` receive a $+0.20$ score boost (`sourceBonus`), gated strictly by:
  ```ts
  if (relevanceScore > 0.1 && lexicalRelevance > 0.05) {
    sourceBonus += 0.20;
  }
  ```
  If an entry in `HOT.md` is irrelevant to the active query, its source bonus is zeroed out to prevent context pollution.
- **Explainability**: Recall logs emit explicit attribution tokens: `source:hot`, `source:fts`, `source:vector`.

---

## 5. LangMem Logarithmic Frequency Rank Axis (`T-315`)

### Sub-Linear Utility Curve
Memory frequency is modeled as a sub-linear logarithmic rank dimension rather than unbounded linear addition:
$$\text{effectiveCount} = \text{access\_count} + 2 \times \text{application\_count}$$
$$\text{baseFrequency} = 0.25 \times \frac{\ln(1 + \text{effectiveCount})}{\ln(1 + 50)}$$

### Recency & Calibration
- **Application Weight**: Verified successful applications carry $2\times$ the weight of passive context retrievals.
- **Smooth Ceiling**: Base frequency smoothly saturates at $0.25$ once effective accesses reach 50.
- **7-Day Recency Bonus**: Entries retrieved or applied within the past 7 days receive an additional $+0.05$ bonus (capped at $0.30$ total).
- **Signal Transparency**: When `frequencyScore > 0.15`, the engine includes `freq:high` in `why_retrieved`.

---

## 6. Verification & Test Evidence

| Test Suite | Focus | Tests | Status |
| :--- | :--- | :--- | :--- |
| `test/failure_attribution.test.ts` | Scoped attribution, anchor matching, decaying strikes, constitutional immunity | 10 | ✅ PASS |
| `test/fix_pair_mining.test.ts` | Error ➔ Remediation trajectories, line normalization, Vibeguard, volume caps | 5 | ✅ PASS |
| `test/source_tagging_frequency.test.ts` | HOT.md memoization, relevance gate, logarithmic frequency curve, recency | 9 | ✅ PASS |
| `test/learning.test.ts` | Autonomous observation distillation and feedback loops | 7 | ✅ PASS |
| `test/quality.test.ts` | Memory deduplication, conflict resolution, utility ROI tracking | 12 | ✅ PASS |
