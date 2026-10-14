# Studio Recall-Debug (R32)

**Status**: Planned — spec for review · **Roadmap**: R32 · **Base**: main

## Why
When memory is recalled (or missed), neither the agent nor the human can
see why. `ranking.ts` already computes all 11 factor scores per candidate —
they're just never surfaced. This is the debugging surface for R21/R27.

## What already exists (reuse)
- `src/retrieval/ranking.ts` — `ScoreFactors` already returned per entry
- `src/ui.ts` — Observability Studio (R15); add a panel, don't rebuild
- A22 per-store medians — same "show the numbers" philosophy

## Smallest implementation
- Studio panel: run a query, see top-K with per-factor score breakdown
  (bm25, symbol, path, recency, utility…) and token budget used
- R27 eval results panel (recall@5 trend) once the harness lands
- No new dependencies; studio is already served over local HTTP

## Acceptance criteria
- Query → factor breakdown visible in studio
- Factor values match `calculateMultiFactorScore` output exactly (no second scoring path)
- Studio remains zero-config local HTTP

## Gate
bun test · tsc --noEmit · bun run build
