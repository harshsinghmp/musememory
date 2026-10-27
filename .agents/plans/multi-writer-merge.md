# Multi-Writer Merge (R31)

**Status**: Planned — spec for review · **Roadmap**: R31 · **Base**: main

## Why
Agency/team use: several agents (or a human + agents) write to one shared
store. Today: single-writer assumption; the sync mesh moves packets
between stores but doesn't merge concurrent writes into one.

## What already exists (reuse)
- `src/sync/` — vector clocks + sealed SyncPackets (R14)
- Contradiction engine — `conflicted` state + mutual conflict_ids
- Observations tier — already append-only, merge-safe by construction

## Smallest implementation
- Merge mode (opt-in flag): on ingest of a SyncPacket whose entry exists
  with a concurrent vector clock, route to the contradiction engine
  (flag, never clobber) instead of last-write-wins
- Observations: append-only union, dedupe by event ID
- No distributed locks; single-writer stays the documented default
  (the qdrant-memory plugin makes the same call)

## Acceptance criteria
- Concurrent writes to the same memory produce `conflicted`, not silent overwrite
- Observation merge is idempotent (re-ingesting a packet changes nothing)
- Default (single-writer) behavior byte-identical to today

## Gate
bun test · tsc --noEmit · bun run build
