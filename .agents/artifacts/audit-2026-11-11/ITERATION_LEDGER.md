# ITERATION_LEDGER — Gauntlet 2026-11-11

## Round 1

**Scope**: audit findings F1, F2, F3, F8 (contract: `GAUNTLET_JOB_CONTRACT.md`)

### RED receipts (captured before any fix)

```
(fail) audit F1: idempotency key must not delete a tombstoned row
(fail) audit F2: as_of must not bypass lifecycle gates [conflicted]
(fail) audit F2: as_of must not bypass lifecycle gates [expired]
(fail) audit F8: secret scanner covers common password shapes
(pass) audit F8: still ignores prose that merely says the word password   <- negative control
```

4 failing, 1 passing negative control → the tests were not vacuous.

### Builder

| Fix | File | Change |
|---|---|---|
| F1 | `src/sqlite.ts` | NULL the colliding `idempotency_key` on other rows before `INSERT OR REPLACE` |
| F2 | `src/retrieval.ts` | Hoist superseded/conflicted/archived/expired gates out of the `as_of` guard; judge expiry at the queried instant |
| F3 | `src/store.ts` | Reject the mirror only when both payload timestamp AND file time are older than the row |
| F8 | `src/secrets.ts` | Widen the generic credential value class to `[^\s'"]{8,}` |

### Fresh Critic (independent, blind)

The critic subagent exhausted its turn budget without a verdict, so its two sharpest questions were executed by the orchestrator directly:

1. **"Does F2 break historical queries?"** — **Yes, it did.** First hoist applied `isExpired(e, now)` unconditionally, so a memory that expired last month became unretrievable for a date when it *was* valid. Verified: `history at valid time -> [] LOST`. Fixed by judging expiry at the queried instant. Re-verified retrievable at the valid date and withheld today.
2. **"Does F3 lose a real external edit under clock skew?"** — **Yes, it did.** First version compared file mtime only; a genuine external edit with a backdated mtime (rsync, restore, clock skew) was silently discarded. Verified: `external edit with older mtime -> original / SILENTLY IGNORED`. Fixed by requiring BOTH payload and file time to be older. Re-verified all three scenarios.
3. **"Does F8 over-match prose?"** — No. `the password field is required`, `set password = to enable`, `the api_key column is nullable`, `auth_token handling is described above` all return zero matches; all four punctuated-password cases are caught.

**Score**: the critic's questions found two real regressions in my own first attempt. Without them the round would have shipped a history-query loss and a silent-edit loss.

### Automated Gate

```
bun test            -> 1620 pass, 0 fail (256 files)
bunx tsc --noEmit   -> clean
check-changelog.ts  -> 2 behavioural commits covered
```

### Load-bearing verification (each fix reverted individually)

| File reverted | Audit tests failing |
|---|---|
| `src/sqlite.ts` | 1 |
| `src/retrieval.ts` | 2 |
| `src/secrets.ts` | 1 |
| `src/store.ts` | 1 |

Every fix is load-bearing; none is decorative.

### Two pre-existing tests caught by the gate

- `sovereignty_gate` failed because my widened secret rule matched the **literal credentials in my own fix comment**. The scanner was correct; the comment was the leak. Reworded.
- `cache.test.ts` "detects external YAML file edits" failed because the first F3 version rejected a past-`updated_at` external edit — the documented contract. This is what forced the mtime rule, and then the skew fix.

### Convergence

- Findings at round start: 4 targeted (of 10 in the audit)
- Fixes landed: 4
- New defects introduced and caught within the round: 2 (F2 history loss, F3 skew loss)
- New findings outnumbering fixes: **no** — both were found and closed inside the round
- Rounds used: 1 of 3

**Verdict: CONVERGED at round 1.** No round 2 needed.

### Deferred to tickets (not in this round)

Audit findings 4 (list() tombstone resurrection + duplicate entries), 5 (list() O(N) writes corrupting `access_count`), 6 (wikilink gate bypass), 7 (cache aliasing), 9 (`hidden_count` dropped), 10 (dead legacy fallback). All real; bundling them would have exceeded the diff budget and they interact with the ranking pipeline.
