# ITERATION LEDGER — Wave 27 (2026-11-09)

## Critics

- **code-review audit / gauntlet**: REJECT, 4.5/10 (Correctness 4, Diff 6, Edge 4, Architecture 4).
- **muse-security audit**: 8 High, 9 Medium, 0 Critical; headline claims overstated.

## Fixed in this round

| Finding | Fix |
|---|---|
| Enclave `safeName` collisions | Strict `[A-Za-z0-9._-]` validation; reject instead of rewrite |
| Envelope metadata not authenticated | GCM AAD over version/key_id/client/division; request metadata asserted |
| Master-key TOCTOU | `wx` creation + EEXIST re-read; 64-hex env only; `key_id` in envelope/AAD |
| Enclave path traversal (`..`) | Name validation + containment by construction |
| Enclave permissions | 0700 dirs, 0600 envelopes; key 0600 |
| Branch name collisions | Reversible base64url filenames; `meta.branch` identity check |
| Overlay path collision with memory versioning | Moved to `.memory/overlays/` |
| Overlay merge lost updates | Captured `base_entries`; merge now calls `mergeMemories3Way` (T-439 wiring) |
| Overlay merge non-atomic / unaudited | Whole-batch validation + `withStoreLock` + per-entry `overlay_merge` audit + `archiveMemory` for deletions |
| Overlay CLI had no write path | `overlay set` / `overlay rm` + audit |
| Detached HEAD treated as branch "HEAD" | `git symbolic-ref`; null on detached, requires `--branch` |
| `overlay list` ignored `--branch` | Uses resolved branch |
| Attest keygen unsafe default/overwrite | Defaults to `~/.config/musememory/keys` (0700), refuses overwrite unless `--force`, audit event |
| Canonical JSON collisions | Rejects unsafe numbers, non-plain objects; omits undefined keys; domain separator |
| Chain semantics | Empty chain rejected; version/algorithm signed and checked; `verify-chain` CLI |
| merge3 fail-open/manual contract | Exit 1 on conflicts unless `--allow-conflicts`; TTY guard; stderr prompts; 0600 output; secret scan |
| Enclave CLI type/traversal/content | Enum validation, name validation, `--file`/stdin |

## Gate

- `bun test` 1521 pass / 0 fail (240 files)
- `tsc --noEmit` clean; build 434 modules; secret scan clean
- New regression tests: name collisions, AAD relabel, empty/tampered chains, overlay 3-way conflict, CLI fail-closed, overlay write surface.

Status: **CAPPED** — one critic round; residual items in `TECHNICAL_DEBT-wave27.md`.
