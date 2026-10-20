# Local Vector Embeddings via llama.cpp (R21)

**Status**: Planned — spec for review · **Roadmap**: R21 · **Base**: main

## Why
Muse recall is lexical (FTS5 BM25 + hashed-trigram "vectors"). Terminology
mismatches ("rate limit" stored vs "why is sync failing" asked) miss
semantically related memories. The October research deferred dense vectors
(A12) *only* until a "zero-cost, zero-API-key local embedding" existed —
llama.cpp server meets that condition. Unblocks A12 without breaking the
keyless promise: opt-in, off by default, lexical path unchanged.

## What already exists (reuse)
- `src/vector.ts` — trigram embed + cosine + BM25 hybrid (stays as fallback)
- `src/retrieval/engine.ts` — mode routing already switches on index presence
- `src/retrieval/ranking.ts` — 11-dim scoring; semantic cosine becomes dim #12

## Smallest implementation
- New `src/retrieval/embedders.ts`: `Embedder` interface (`probe()`, `embed(texts[])`)
- One adapter: OpenAI-compatible `/v1/embeddings` over bun `fetch` — covers
  llama.cpp, Ollama, hosted providers, and a future Hermes embedding facade
  by URL alone. Zero npm dependencies.
- Vectors as float32 BLOB column in SQLite; brute-force cosine
  (`ponytail:` no ANN index until measured at 10k+ entries)
- Fingerprint `model|dims|endpoint` stored with the index; mismatch refuses
  reuse, `memory embed reindex` rebuilds (qdrant-memory `init` pattern)
- CLI: `memory embed status | reindex`; config key `retrieval.embedder_url`
  (unset = trigram fallback, today's behavior)

## Acceptance criteria
- No embedder configured → identical behavior to today (existing tests pass untouched)
- Configured → `memory embed status` reports model, dims, fingerprint
- Mismatched fingerprint refuses to load; reindex succeeds
- New dim #12 wired into `ranking.ts`; `bun test` + `tsc --noEmit` + build green

## Gate
bun test · tsc --noEmit · bun run build · R27 recall@5 measured before/after
