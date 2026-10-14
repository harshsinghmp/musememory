# Memory Poisoning Trust Tiers (R28)

**Status**: Planned — spec for review · **Roadmap**: R28 · **Base**: main

## Why
OWASP ASI06 (2026): memories ingested from untrusted sources poison every
future session. Muse ingests transcripts and (soon) web content with no
trust distinction — recalled content is treated as untrusted data by
convention, but nothing enforces it.

## What already exists (reuse)
- `src/provenance.ts` — source ledger; trust derives from it
- `src/orchestrator/freshness.ts` — GAP-3 withhold-and-report pattern
- `muse_context` already reports `withheld_memories`

## Smallest implementation
- `trust: "trusted" | "candidate" | "untrusted"` on entries, defaulted by
  ingest source (agent transcripts = candidate, web/external = untrusted)
- `muse_context` filters untrusted by default; `include_untrusted: true`
  opt-in, mirroring `include_drifted`
- No schema migration pain: default value backfills on read

## Acceptance criteria
- Web/external-sourced memories never appear in default `muse_context`
- `withheld_memories` + notice reports them (same shape as freshness gate)
- Provenance source unchanged for existing entries (existing tests pass untouched)

## Gate
bun test · tsc --noEmit · bun run build
