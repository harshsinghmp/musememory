# ACCEPTANCE PACKET — Wave 23 PR 4–6

**Status: `CAPPED` — not a gauntlet PASS.** One critic round scored 7.35/10 and named four blockers; all four were fixed on `fix/wave23-gauntlet` and verified by the automated gate, but were not re-critiqued.

## Criteria

| # | Result |
|---|---|
| 1 gate | PASS — 1471/0, tsc clean, build 434 |
| 2 headers | PASS — CSP, XFO, nosniff, Referrer-Policy; HSTS N/A |
| 3 viewports | PASS — 375/768/1280 no overflow; 44×44 controls at 375/768 |
| 4 agents | PASS after fix — three statuses, typed unknown 404s, complete XDG-aware backups, fail-loud backup errors, `all` rejected |
| 5 manifest | PASS — memory/DB paths, `memory mcp`, `memory_search` snippet, no secrets |
| 6 About/deck | PASS — live facts, 4 setup cards, 7 filtered commands, wired copy actions |
| 7 cache | PASS — HIT/MISS, external-write freshness, mutation allowlist |
| 8 visibility | PASS — hidden tab stops the loop, visible wakes it, no `setInterval` |
| 9 benchmark | PASS — median cached memories/stats < 10ms |
| 10 bar | PASS — no new skips/only, secret scan clean |

Code review (diff mode) returned REQUEST-CHANGES; both blockers were fixed (WAL/layout freshness probe; cache and backup-failure tests) and the doc claims were aligned. See `ITERATION_LEDGER.md` § Code review.

Residual: agents detection runs on every load; perf test is wall-clock; the visibility/count checks are source-level; unwire leaves `allowedTools` grants; `.bak` files accumulate.
