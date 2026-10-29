# Recall Quality Eval Harness (R27)

**Status**: Planned — spec for review · **Roadmap**: R27 · **Base**: main

## Why
Current benchmarks measure speed, not recall. "Search got better" is a
feeling; R21 and every future retrieval change need a falsifier. The 2026
standard (LoCoMo / LongMemEval / LME-V2) tests recall against distractors —
Muse ships zero equivalent.

## What already exists (reuse)
- `src/benchmark/` — latency harness; extend, don't replace
- `test/` — bun test infra; the gate is a normal test file
- LME-V2's five abilities map to shipped features (gotchas = negative
  memories, premise = constraints, dynamic tracking = bi-temporal)

## Smallest implementation
- `test/recall-eval.test.ts` + fixture `test/fixtures/recall-golden.json`:
  ~60 queries, each with relevant IDs + same-topic distractor IDs
  (paraphrase + terminology-mismatch cases — the documented vector-only failure)
- Report recall@5 + p50 latency; fail the suite below a threshold constant
- Fixture grows from real `.memory/` stores, not invented data

## Acceptance criteria
- recall@5 ≥ 0.8 on the golden fixture (threshold in one named constant)
- Distractor discrimination reported (relevant vs near-miss margin)
- Runs in the existing `bun test` suite; no network, no LLM
- Needed before judging R21 and every future retrieval change

## Gate
bun test (the gate itself) · tsc --noEmit · bun run build
