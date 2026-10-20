# Retirement & Hygiene Audit — 2026-10-14

Two independent read-only lanes (surface inventory + judgment audit), reconciled. Baseline: 30,787 LOC `src/`, 12,450 LOC tests, 101 MCP tools (104 dispatch cases, 0 orphans), 165 npm downloads/month.

## Headline

There is almost nothing dead to delete. The cleanup is **drift**: hand-maintained name lists that no longer match the registered surface, and two write paths where disk shadows the database. The one true defect outranks every cleanup row: `verify.ts` executes memory-supplied strings through `/bin/sh` (RCE-class). Fix that first, then the free drift rows, then the deprecations.

## Verdict table (risk-adjusted, safest first)

| # | Item | Evidence | Verdict |
|---|---|---|---|
| 1 | 6-profile system: 7 phantom tool names silently dropped | `orchestrator/profiles.ts` (`memory_record_observation`, `memory_capture_negative`, `memory_conflict_detect`, `memory_wiki_page`, `memory_tree_index`, `memory_dedup`, `memory_audit_query` — none registered) | FIX registry (free), KEEP mechanism; default-profile change is a v2.5 decision (see below) |
| 2 | `ALL_MEMORY_TOOLS` allowlist: 3 phantom names auto-approved, 61 real tools omitted | `connect.ts:9-50` (40 names) written into `settings.json` `allowedTools` at `:160` | RETIRE array; write nothing or `["*"]` |
| 3 | `maybeAutoOptimize` | `optimize.ts:362`, 0 callers (superseded by dashboard/CLI optimize path) | RETIRE |
| 4 | LSP intelligence tier | `intelligence/lsp.ts:16` `_lspActive = false`; only setters are internal → `isAvailable()` unreachable; 1413 LOC | RETIRE (keep the provider slot in the chain signature) |
| 5 | 4 unused registry methods + `registerProvider` | `intelligence/registry.ts:68-117`, 0 external call sites (only `getBlastRadiusWithFallback` used) | RETIRE (~70 LOC + adapter impls) |
| 6 | `musememory-comparison.html` at repo root | 63KB, not in npm `files`, research residue per identity rules | RETIRED in this change: moved to `docs/research/`, README link updated |
| 7 | 3 dead governor exports | `governor.ts`: `registerAgentWorkstream`, `linkMemoriesToSession`, `isValidConstraintLine` — 0 refs | RETIRE |
| 8 | 20 of 24 migrator providers → GenericAdapter | `migrator/detect.ts` reports hits for 20 providers with only 4 real parsers (`agentmemory`, `beads`, `letta`, `generic`); mis-imports silently | DEPRECATE the 20 (delete before adapters, never after — stale detectors mis-import data) |
| 9 | YAML mirror read precedence | `store.ts:174-202` reads YAML first and re-imports disk into SQLite (`:193-196`): hand-edited YAML silently overwrites DB (same silent-LWW class as the concurrent-write bug) | KEEP the mirror (63 module imports route through it; largest blast radius in the repo), FLIP `get()` to DB-first (~6 lines) |
| 10 | Dockerfile test-on-build | `Dockerfile:12-13` runs `bun test` + `tsc` at image build; npm-excluded anyway | RETIRE |
| 11 | 20 dormant connect platforms | `agents/registry.ts` = 52 entries; `nullclaw`/`nanoclaw`/`picoclaw`/`ironclaw`/`zeroclaw`/`pool`/`ante`/`san`/`tau`/`waveloom`/`openharness`/`codewale` class rows never installed; detection already marks `installed=false` | DEPRECATE (freeze the list), and fix the "80+" README claim to the real count |
| 12 | CLI `recall` vs MCP `search` vs `get_context` | three retrieval paths with different default limits | DEPRECATE `recall` as a separate path (keep as alias) |
| 13 | `verify.ts` `/bin/sh -c` | `verify.ts:23` execs `entry.test_command` (memory content, MCP-writable by any connected agent) | FIX — outranks every row; lateral-movement primitive on every install |
| 14 | Studio UI XSS + optimizer endpoint | `ui.ts:1510` injects `p.title`/`p.slug`, `:1557` injects `r.entry_id`/`r.actor` into innerHTML (unescaped, despite `escapeHtml` at `:1588`); `/api/optimize` (`ui.ts:362`) exposes the regex-deleting optimizer over HTTP; 47+ routes on 127.0.0.1:2222 | KEEP the surface, FIX the injection + gate the optimizer endpoint |
| 15 | `daemon.ts` docs drift | README markets "WebSocket Hub"; implementation is SSE, opt-in via `memory daemon` | KEEP, fix README |
| 16 | 12 "circular" MCP tools + 20 full-profile-only zero-test tools | asserted only in `test/mcp.test.ts` registration smoke, or not at all | FIX (hygiene): real dispatch tests or documented-untested |
| 17 | CodeGraph/Graphify chain tiers | gate on `.codegraph/`/`.graphify/` existence; self-disabling | KEEP |
| 18 | YAML mirror full delete | breaks bootstrap/store tests/README git-diff claim; buys one write/commit | KEEP (row 9 supersedes) |
| 19 | All 101 MCP tools | 0 orphans; bloat is cost, not dead code | KEEP; tool-bloat reduction rides the R17b P2 dashboard/tool-packaging work |

## Cheap evidence tests before acting on 8/11

```bash
grep -rn "GenericAdapter\|provFilter" src/migrator/engine.ts      # which providers actually parse
memory detect-agents --json | jq '[.[]|select(.installed)]|.id'   # on 3+ machines over 90 days
```

## Notes

- Rows 1-3 and 7 are free: pure list-vs-registry drift, no runtime path, no migration.
- Row 13 is a security defect, not retirement. Ship before any cleanup lands.
- Row 14 makes `ui.ts` the second-priority code fix after row 13.
- Executed in this change: row 6 only (pure move). Everything else awaits principal go-ahead.
