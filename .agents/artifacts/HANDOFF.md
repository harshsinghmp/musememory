# HANDOFF — 2026-10-19T21:05:00Z
branch: dev @ 5cd0e28 | phase: Wave 18 complete; dev green 1129/0 (v2.8.0)

## Next Step
Advance to Wave 19 (Scoring Refinements & Abstract Sidecars: T-118–T-125).

## In-Flight
- Wave 18 landed on dev via Ticket=Issue=Branch=PR=Merge (PRs #256–#270):
  - T-106: Curator evidence protocol & deterministic promotion (PR #256)
  - T-107: Two-tier promotion staging & session-end flush (PR #258)
  - T-108: Re-injection suppression with 6-turn session LRU (PR #260)
  - T-109: Self-echo suppression via 10-min age provenance (PR #262)
  - T-110: Injected-block sanitization before capture & propose (PR #264)
  - T-111: Seen-chunk TTL suppression with 5-min window (PR #266)
  - T-112: Topic-overlap >0.6 prefetch skip & cache reuse (PR #268)
  - T-113: Trivial-prompt gate skipping recall for greetings (PR #270)
- Docs pass: docs/ingestion-suppression-and-curation.md, user-guide.md, README.md (1129 passed).

## Decisions
- Curator separation: agents record empirical observations; code gates arbitrate promotion.
- Context cleanliness: injected context packs are stripped before store ingestion.
- Adaptive suppression: 6-turn LRU, seen-chunk TTL, and >0.6 topic overlap conserve context.

## Verify
`bun test` 1129/0 + `bunx tsc --noEmit` + `bun run build`
