# Evidence Ledger

## Dashboard

| Category | Count |
|---|---|
| DECISION | 1 |
| CLAIM | 6 |
| STATUS | 1 |

| Status | Count |
|---|---|
| VERIFIED | 6 |
| ACTIVE | 2 |
| QUARANTINED | 0 |

**Health score**: 6 / 6 claims verified (100%) — the previous quarantine on EVD-005 is resolved by EVD-008; the remaining two entries are an active fix record and an active decision.

---

### EVD-001 | 2026-11-09 | STATUS
**Statement**: `memory benchmark` crashed on title-less memories; fixed in the token-budget packing loop.
**Category**: `STATUS`
**Confidence**: `[RAW]` — reproduced with `bun bin/musememory.ts benchmark --iterations 5` (TypeError at `item.entry.title.length`), then passed after the null-safe patch.
**Epistemology**: `[EMPIRICAL]`
**Evidence**: `src/retrieval/ranking.ts` token estimate; `test/ranking_titleless.test.ts`.
**Status**: `ACTIVE`

---

### EVD-002 | 2026-11-09 | CLAIM
**Statement**: On a 34-entry synthetic corpus, retrieval hit the target in the top 3 for 10/10 queries (MRR 0.933, 2.69 ms average, 68% token savings).
**Category**: `CLAIM`
**Confidence**: `[RAW]` — scratch benchmark run, output JSON retained in session.
**Epistemology**: `[EMPIRICAL]`
**Evidence**: `docs/evidence/2026-11-dogfood.md`; query set and metrics table.
**Status**: `VERIFIED`

---

### EVD-003 | 2026-11-09 | CLAIM
**Statement**: On the real 799-memory store, the benchmark reports FTS5 p50 12.81 ms, context assembly p50 15.64 ms, and 99% token compression.
**Category**: `CLAIM`
**Confidence**: `[RAW]` — `bun bin/musememory.ts benchmark --iterations 10`.
**Epistemology**: `[EMPIRICAL]`
**Evidence**: benchmark table in `docs/evidence/2026-11-dogfood.md`.
**Status**: `VERIFIED`

---

### EVD-004 | 2026-11-09 | CLAIM
**Statement**: The engine targets p95 latency: hot cache < 250 µs, FTS5 < 50 ms, context < 50 ms.
**Category**: `CLAIM`
**Confidence**: `[RAW]` — 50-iteration benchmark: 176.25 µs, 15.66 ms, 26.69 ms.
**Epistemology**: `[EMPIRICAL]`
**Evidence**: `docs/evidence/2026-11-dogfood.md`; benchmark `[TARGET]` line.
**Status**: `VERIFIED` — the earlier "< 15 ms" claim was a p50 value mislabeled as a bound; it has been corrected.

---

### EVD-005 | 2026-11-09 | CLAIM
**Statement** *(revised)*: On convention-sensitive coding tasks, an agent that can recall the project's stored conventions produces more correct implementations than the same agent without them.
**Category**: `CLAIM`
**Confidence**: `[EMPIRICAL]` — a ten-task condition-blind study (EVD-008) measured 10/10 with memory against 6/10 without it; four tasks discriminated and none regressed.
**Epistemology**: `[EMPIRICAL]`
**Evidence**: `docs/evidence/2026-11-outcome-study.md`; task prompts and hidden graders in `.agents/artifacts/outcome-study-2026-11/`.
**Status**: `VERIFIED` — scoped to convention recall in this study. The original unqualified sentence ("improves coding-agent task success") is too broad for n=10 and has been narrowed rather than marked proven.

---

### EVD-006 | 2026-11-09 | DECISION
**Statement**: Before starting Wave 28, fix the benchmark defect, record evidence, harden the enclave key lifecycle, then cut a release candidate.
**Category**: `DECISION`
**Confidence**: `[RAW]` — based on EVD-001 through EVD-005.
**Epistemology**: `[EMPIRICAL]`
**Options considered**: (a) continue feature waves; (b) evidence + security + release gate; (c) release immediately without evidence.
**Trade-offs**: (b) delays new features but converts unverified claims into measurable ones and protects client data.
**Evidence**: this ledger + `TECHNICAL_DEBT-wave27.md`.
**Status**: `ACTIVE`

---

### EVD-007 | 2026-11-09 | CLAIM
**Statement**: In a 2-task pilot, an agent with memory passed 2/2 hidden tests; the same model without memory passed 1/2 (missed the 32-character tag cap).
**Category**: `CLAIM`
**Confidence**: `[RAW]` — hidden Bun tests run against both fixture implementations.
**Epistemology**: `[EMPIRICAL]`
**Evidence**: `docs/evidence/2026-11-outcome-pilot.md`.
**Status**: `VERIFIED` — pilot only (n=2, single run). Superseded as primary evidence by EVD-008.

---

### EVD-008 | 2026-11-09 | CLAIM
**Statement**: In a ten-task condition-blind study, an agent told to consult memory passed 10/10 hidden tests when the conventions were seeded and 6/10 when they were not; the four discriminating tasks were duration units, UTC dates, the slug length cap and CSV whitespace quoting.
**Category**: `CLAIM`
**Confidence**: `[RAW]` — hidden Bun tests graded all twenty solutions mechanically under a non-UTC timezone; Fisher's exact one-sided p = 0.043.
**Epistemology**: `[EMPIRICAL]`
**Evidence**: `docs/evidence/2026-11-outcome-study.md`; `.agents/artifacts/outcome-study-2026-11/`.
**Status**: `VERIFIED` — n=10, one run per arm, one model. Supports EVD-005 within that scope only.
