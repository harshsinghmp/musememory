# I/O Budget & NVMe Telemetry (R29)

**Status**: Planned — spec for review · **Roadmap**: R29 · **Base**: main

## Why
SQLite WAL + dual YAML persistence + append-only JSONL ledgers write more
bytes than the user sees. On NVMe/SSD, write amplification is the wear
vector. Nothing measures it today.

## What already exists (reuse)
- `src/retention.ts` — rotation policy engine
- `src/optimize.ts` — VACUUM cadence; extend with telemetry, not new cron
- SQLite WAL config in `src/sqlite.ts`

## Smallest implementation
- `memory io` command: reads the kernel's per-task I/O counters
  (`write_bytes`) plus store file sizes, reports bytes/day with an alert
  threshold
- YAML mirror: async-batch writes per turn (config `yaml_mirror: sync|batched|off`,
  default batched — flushes at turn end, not wall clock)
- Rotation caps for audit.jsonl / observations.jsonl via retention.ts
- `PRAGMA wal_autocheckpoint` documented in optimize output

## Acceptance criteria
- `memory io --json` prints write_bytes delta + per-file sizes
- Batched mode passes every existing test (read-after-write within a turn unchanged)
- Ledger rotation never drops rows still referenced by audit invariants

## Gate
bun test · tsc --noEmit · bun run build · before/after write_bytes measured
