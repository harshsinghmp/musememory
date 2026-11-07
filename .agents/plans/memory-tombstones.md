# Tombstones & Scoped Deletion (R30)

**Status**: Planned — spec for review · **Roadmap**: R30 · **Base**: main

## Why
Deleting a memory today removes the bytes; a replayed event (sync, retry,
harvest) can re-add the same content under a new ID. Agency use needs
durable "this content is gone" — per client scope — plus crash-safe
deletion (qdrant-memory fence pattern).

## What already exists (reuse)
- A7 suppress state (planned) — tombstones extend it with content hashes
- `audit.jsonl` — append-only ledger already logs every mutation
- `src/store.ts` delete path — single funnel for all callers

## Smallest implementation
- On delete: write a tombstone row (scope + content SHA-256, never the text)
  in SQLite; write path checks tombstones and refuses resurrection
- `memory delete-all --scope <user|client> --confirm`: durable deletion
  intent first; interrupted runs fail closed with `recovery_required`
  until resumed
- Tombstones retained until explicit `memory purge-tombstones`

## Acceptance criteria
- Replaying a deleted memory's event does not re-add it
- Interrupted delete-all leaves `recovery_required`; resume completes
- Tombstone contains no recoverable content (hash only)

## Gate
bun test · tsc --noEmit · bun run build
