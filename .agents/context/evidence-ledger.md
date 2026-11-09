# Evidence Ledger

## Dashboard

| Category | Count |
|---|---|
| DECISION | 1 |
| CLAIM | 4 |
| STATUS | 1 |

| Status | Count |
|---|---|
| VERIFIED | 2 |
| QUARANTINED | 2 |
| ACTIVE | 1 |

**Health score**: 3 / 4 verifiable entries (75%) — two claims are quarantined, not contradicted.

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
**Statement**: The FTS5 latency SLA is `< 15 ms`.
**Category**: `CLAIM`
**Confidence**: `[RAW]` — same benchmark shows p50 12.81 ms but **p95 149.06 ms**.
**Epistemology**: `[EMPIRICAL]`
**Evidence**: `docs/evidence/2026-11-dogfood.md`; benchmark `[CLAIMED]` line.
**Status**: `QUARANTINED` — the bound is only true at p50; reword to “p50 < 15 ms” or optimize p95.

---

### EVD-005 | 2026-11-09 | CLAIM
**Statement**: Muse Memory improves coding-agent task success.
**Category**: `CLAIM`
**Confidence**: `[INFER]` — plausible from retrieval quality, but no with/without task-outcome study exists.
**Epistemology**: `[SPECULATIVE]`
**Evidence**: none yet; retrieval evidence only (EVD-002/003).
**Status**: `QUARANTINED` — do not repeat as an empirical claim.

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
