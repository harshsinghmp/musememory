# TECHNICAL_DEBT — Waves 24–25 review (2026-11-08)

| # | Finding | Location | Fix |
|---|---|---|---|
| D1 | ~~`episodes.ts` has no production caller~~ **wired**: `memory briefing` prints recent causal episodes | `src/cognition/episodes.ts` | — |
| D2 | **partially wired**: `evaluateAsOf` respects `asserted_at`; no SQL column/index yet | `src/retrieval.ts`, `src/sqlite.ts` | Add an `asserted_at` column + migration if SQL filtering is needed |
| D3 | ~~duplicate decay module~~ **removed**: `retention.ts` owns decay and reinforcement | — | — |
| D4 | ~~`muse_playbook_*` schemas declare no `required` array~~ **done**: `muse_playbook_record` has two modes, so a flat `required` would be wrong for one of them. Declared `anyOf` with each mode's minimum (`[id, success]` to record an outcome, `[title, goal, steps]` to save). The handler still validates at runtime — MCP tool schemas are advisory and are not compiled server-side, so this tells clients what to send instead of making them discover it from an error | `src/mcp.ts` | — |
| D5 | ~~Playbook writes use a fixed `.tmp` name (concurrent writers collide)~~ **done**: per-write temp name (`pid`+`randomUUID`) with `fsync` before rename and cleanup on failure. The audit also exposed a deeper bug the temp-name fix alone does not solve: `savePlaybook` and `recordPlaybookOutcome` are read-modify-write, so two processes both read the same list and the later rename silently drops the earlier write. Both now run inside `withStoreLock`. Verified: 8 concurrent processes persist 8/8; without the lock, 6 writers persisted 3 | `src/cognition/playbooks.ts` | — |
| D6 | ~~Site prerender blocked~~ **fixed**: Node-based Astro launcher; `site:qa` 17/17 SHIP | `apps/website/scripts/astro.mjs` | — |
| D7 | ~~`--run` is a show alias; no step execution~~ **done**: `--run` now refuses loudly (exit 2) instead of silently printing the playbook, and explains that playbooks are advisory. Execution was deliberately not implemented: steps carry arbitrary shell commands, so running them needs a confirmation gate and its own security review, not a debt-sweep change | `src/cli/playbook.ts` | — |
| D8 | `assets/showreel/README.md` had an executable bit; demo script uses `set -e` inside a recording | `assets/showreel` | Fixed mode; review recording ergonomics |
