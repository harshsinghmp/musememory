# TECHNICAL_DEBT — Waves 24–25 review (2026-11-08)

| # | Finding | Location | Fix |
|---|---|---|---|
| D1 | ~~`episodes.ts` has no production caller~~ **wired**: `memory briefing` prints recent causal episodes | `src/cognition/episodes.ts` | — |
| D2 | **partially wired**: `evaluateAsOf` respects `asserted_at`; no SQL column/index yet | `src/retrieval.ts`, `src/sqlite.ts` | Add an `asserted_at` column + migration if SQL filtering is needed |
| D3 | ~~duplicate decay module~~ **removed**: `retention.ts` owns decay and reinforcement | — | — |
| D4 | `muse_playbook_*` schemas declare no `required` array | `src/mcp.ts` | Declare required fields or document the runtime validation |
| D5 | ~~Playbook writes use a fixed `.tmp` name (concurrent writers collide)~~ **done**: per-write temp name (`pid`+`randomUUID`) with `fsync` before rename and cleanup on failure. The audit also exposed a deeper bug the temp-name fix alone does not solve: `savePlaybook` and `recordPlaybookOutcome` are read-modify-write, so two processes both read the same list and the later rename silently drops the earlier write. Both now run inside `withStoreLock`. Verified: 8 concurrent processes persist 8/8; without the lock, 6 writers persisted 3 | `src/cognition/playbooks.ts` | — |
| D6 | ~~Site prerender blocked~~ **fixed**: Node-based Astro launcher; `site:qa` 17/17 SHIP | `apps/website/scripts/astro.mjs` | — |
| D7 | `--run` is a show alias; no step execution | `src/cli/playbook.ts` | Implement execution with confirmation or amend the ticket wording |
| D8 | `assets/showreel/README.md` had an executable bit; demo script uses `set -e` inside a recording | `assets/showreel` | Fixed mode; review recording ergonomics |
