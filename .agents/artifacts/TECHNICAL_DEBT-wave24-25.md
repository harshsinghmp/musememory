# TECHNICAL_DEBT — Waves 24–25 review (2026-11-08)

| # | Finding | Location | Fix |
|---|---|---|---|
| D1 | `episodes.ts` has no production caller; CHANGELOG/benchmark page claimed per-session narratives | `src/cognition/episodes.ts` | Wire `buildEpisodes` into brief/recall, or keep the capability marked as scaffolding |
| D2 | `temporal.ts` has no production caller and `asserted_at` has no SQL column/index | `src/temporal.ts`, `src/sqlite.ts` | Add an `asserted_at` column + migration and use `filterBiTemporal` in the `as_of` read path |
| D3 | `quality/decay.ts` duplicates `retention.ts` math and is unused | `src/quality/decay.ts` vs `src/retention.ts` | Fold reinforcement into `computeDecayScore` and delete the duplicate module |
| D4 | `muse_playbook_*` schemas declare no `required` array | `src/mcp.ts` | Declare required fields or document the runtime validation |
| D5 | Playbook writes use a fixed `.tmp` name (concurrent writers collide) | `src/cognition/playbooks.ts` | Random temp suffix + fsync |
| D6 | Site prerender fails on Astro's `cookie` CJS interop before page generation | `apps/website` | Resolve the Astro/cookie version interop, then run visual/a11y QA on `agents`/`playground` |
| D7 | `--run` is a show alias; no step execution | `src/cli/playbook.ts` | Implement execution with confirmation or amend the ticket wording |
| D8 | `assets/showreel/README.md` had an executable bit; demo script uses `set -e` inside a recording | `assets/showreel` | Fixed mode; review recording ergonomics |
