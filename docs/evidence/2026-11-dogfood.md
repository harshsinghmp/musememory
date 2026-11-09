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
| Hot cache | **109.87 µs** | **176.25 µs** |
| FTS5 BM25 | **10.22 ms** | **15.66 ms** |
| Knapsack ranking | **9.77 ms** | **12.58 ms** |
| Context assembly | **16.63 ms** | **26.69 ms** |

(50 iterations, 817 active memories. Earlier 10-iteration run showed a 149 ms
FTS p95; the 50-iteration run is the stable measurement.)


Token economy: 195,077 raw store tokens → 1,422 injected tokens (**99%** saved).

## What the evidence does not show

1. **No human/agent task-outcome comparison.** “Memory improves task success”
   is still unmeasured; the study measures retrieval, not outcomes.
2. **Latency claim mismatch.** The benchmark advertised `Hot Cache < 50 µs` and
   `FTS5 < 15 ms` as if they were p95 bounds; measured p50 is 109.87 µs and
   10.22 ms, and p95 is 176.25 µs / 15.66 ms. The advertised bounds are now
   explicit p95 targets (250 µs / 50 ms), and the measured values are shown above.
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
