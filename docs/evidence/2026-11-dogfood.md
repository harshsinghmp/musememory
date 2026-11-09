# Dogfood Evidence — 2026-11-09

## Question

Does memory retrieval actually surface the right memory, within the latency
and token budget the product claims? This is a **retrieval-quality** study,
not a human task-outcome study.

## Method

- Synthetic corpus: 10 target memories (fix, constraint, architecture,
  operation, discovery) + 24 noise memories in a fresh SQLite store.
- 10 queries, one known target each; `queryContext` with `limit: 3`,
  `project` scoped.
- Metrics: hit@3, MRR, precision@3, in-process latency, retrieved characters
  vs raw corpus characters.
- Receipt: `bun dogfood_bench.ts` (scratch script, output below).
- Production benchmark on the real store: `bun bin/musememory.ts benchmark --iterations 10`.

## Results

| Metric | Value |
|---|---|
| Corpus entries | 34 |
| Queries | 10 |
| hit@3 | **10/10** |
| recall@3 | **1.000** |
| MRR | **0.933** |
| precision@3 | 0.333 |
| avg latency | **2.69 ms** |
| p95 latency | **6.95 ms** |
| token savings vs raw corpus | **68.0%** |

Production store (799 active memories), `[MEASURED]` benchmark table:

| Signal | p50 | p95 |
|---|---|---|
| Hot cache | (see benchmark output) | — |
| FTS5 BM25 | **12.81 ms** | **149.06 ms** |
| Knapsack ranking | **9.29 ms** | **18.49 ms** |
| Context assembly | **15.64 ms** | **50.15 ms** |

Token economy: 195,077 raw store tokens → 1,422 injected tokens (**99%** saved).

## What the evidence does not show

1. **No human/agent task-outcome comparison.** “Memory improves task success”
   is still unmeasured; the study measures retrieval, not outcomes.
2. **Latency SLA mismatch at p95.** The benchmark’s claimed FTS5 bound is
   `< 15 ms`, but p95 is **149 ms**. The claim appears to describe p50. Reword
   or optimize before repeating the claim.
3. **precision@3 is structurally 0.333** because three results are always
   returned for one known target; this is not a precision failure by itself,
   but it does show there is no abstention/empty-result path in this setup.

## Defect found and fixed

`memory benchmark` crashed on title-less memories:
`item.entry.title.length` in the token-budget packing loop. Fixed with
null-safe length accounting; a regression test covers a title-less memory
under a token budget.

## Reproduction

```bash
bun bin/musememory.ts benchmark --iterations 10
bun test test/ranking_titleless.test.ts
```
