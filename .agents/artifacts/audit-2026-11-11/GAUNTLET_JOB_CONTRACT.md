# GAUNTLET_JOB_CONTRACT — 2026-11-11

**Intake classification**: **bounded** — four defects with reproductions and named fixes. Not architectural (no schema/protocol redesign), not a spike.

## Goal

Close the four highest-severity findings from `CODE_REVIEW.md` with test-first fixes, without regressing the 1612-test suite or any previously verified behaviour.

## The Bar (named, fetchable, comparable)

**Bar**: SQLite's own `INSERT … ON CONFLICT DO UPDATE` semantics and the project's existing `withStoreLock` discipline.

- **Named**: SQLite 3 documentation for UPSERT + this repo's `src/lock.ts` contract.
- **Fetchable**: `src/lock.ts` is in-tree; SQLite semantics are verifiable by execution.
- **Comparable**: the fix either preserves the documented invariant (SQLite authoritative, tombstones immovable, prompt gates always applied) or it does not. No taste involved.

The measurable half: **each defect's reproduction must flip from failing to passing, and the reproduction must first be seen RED.**

## Acceptance criteria (binary)

1. [ ] An unrelated write sharing an `idempotency_key` no longer deletes a tombstoned row; reproduction flips RED→GREEN.
2. [ ] `as_of` queries still withhold conflicted, archived and TTL-expired memories; reproduction flips RED→GREEN.
3. [ ] A stale YAML mirror can no longer overwrite newer SQLite state on read; reproduction flips RED→GREEN.
4. [ ] `password: "hunter2!extra"` and peers are detected by the secret scanner; reproduction flips RED→GREEN.
5. [ ] `bun test` ≥ 1612 passing, zero failures.
6. [ ] `bunx tsc --noEmit` clean.
7. [ ] No test weakened, skipped, or deleted; no threshold edited down.
8. [ ] `scripts/check-changelog.ts` passes (each fix has an entry).

## Automated proof commands

```bash
bun test
bunx tsc --noEmit
bun run scripts/check-changelog.ts
```

## Iteration budget

`max_rounds = 3` (hard ceiling 5).

## Explicit non-goals

- Findings 4, 5, 6, 7 (list() reconciliation, read amplification, wikilink gate, cache aliasing) are **deferred** — they are real but interact with each other and with the ranking pipeline; bundling them into this round would exceed the diff budget. They become tickets.
- D2 (asserted_at SQL column): **not implementing** — evidence says it is a premature optimisation. Closing as answered.
- Nitpicks 9–10: deferred to the ticket backlog.
