# ITERATION LEDGER — Wave 23 PR 4–6

> Contract: `GAUNTLET_JOB_CONTRACT.md`. Budget 2 rounds; Round 1 audit, fix round applied.

## Round 1 — audit (2026-11-08)

- **Gate**: green. 1471/0, tsc clean, build 434 modules, headers 4/4, 375/768/1280 no overflow, cache MISS→HIT, secret scan clean.
- **Fresh Critic: 7.35/10 — FAIL**, criterion 4 false:
  - **B1** wire backed up only `detected.configPath`; `claude-json` also rewrites `~/.claude/settings.json` with no backup; backup failures were swallowed; fixed `.bak` name overwrote the pristine copy; `id:"all"` wrote every agent with zero backups; XDG divergence.
  - **B2** projection cache invalidated only by in-process POSTs, so external writes were invisible until a UI POST; read-only POSTs (`/api/search`, `/api/cognition/why`) invalidated unnecessarily.
  - **B3** unwire unknown agent returned 200 `success:false`; the client flashed success on any 200; harness opt-in was a silent client constant.
  - **B4** 44×44 claim was contradicted by bare `.btn-icon` copy buttons and a 24px chip override.
- Non-blocking: agents detection on every load (sync `$HOME` sweep), source-grep-only tests, missing count assertions.

## Fix round (branch `fix/wave23-gauntlet`)

- Wire: rejects `id:"all"`; typed unknown-agent 404 for wire and unwire; backs up every target the write can touch (`~/.claude.json` + `~/.claude/settings.json`, XDG-aware via the detector path); timestamped backups that never overwrite; backup failure aborts the request with 500; response carries the backup paths.
- Cache: key includes directory + DB mtime freshness, so external writes miss; version bump restricted to an explicit mutating-route allowlist.
- Client: explicit confirm before wiring; only flashes success when `data.success === true`; failure shows the report message; backup path surfaced.
- CSS: 44px applies to every phone control (`btn-icon`, chips, buttons, inputs), 24px chip override removed.

**Verification**: `bun test` **1471 pass / 0 fail**, tsc clean, build 434 modules, secret scan clean, cache MISS→HIT, 375/768 targets 44×44.

Status: **CAPPED** — fixed after the only critic round (budget 2); no second critic. Code review follows.

## Code review — diff mode (Linus style)

Verdict: **REQUEST-CHANGES** on the gauntlet fix commit. Findings and resolution:

- **CR1 (blocking)** `freshnessToken` probed only `<memoryDir>` and a hardcoded `memory.db`, so WAL commits (`memory.db-wal`) and the `memories/` mirror were invisible; a failed stat collapsed to `0`. Fixed: probe `dir`, `getStorageLayout(dir).memoriesDir`, `dbPath`, `dbPath-wal`, `dbPath-journal`; a missing path contributes `"-"`, never a fake zero.
- **CR2 (blocking)** neither new cache behavior had a test, and the fail-loud backup path was unverified. Added: read-only POST (`/api/cognition/why`) stays `HIT`; an external `propose` through a second open store yields `MISS` and the new memory; an unwritable backup directory returns 500 and leaves the config without a memory server.
- **Doc drift** the contract said "any UI POST" while the packet scored a mutation allowlist. Both now say: mutating POST or external WAL/dir change → `MISS`; read-only POSTs stay `HIT`. The harness row now names the confirm dialog as the consent surface.
- **Accepted nitpicks**: invalidation inverted to a read-only set (forgotten routes miss, never stale), backup names carry a monotonic counter, all backup paths are surfaced to the user.
- Noted, not changed in this branch: unwire leaves `allowedTools` grants; `.bak` files accumulate; mesh projections have no freshness signal.

**Post-review gate**: `bun test` 1471/0, tsc clean, build 434 modules, secret scan clean.
