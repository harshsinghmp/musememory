# ITERATION_LEDGER — Wave 23 PR 1 (`T-451`–`T-453`)

> Protocol: `gauntlet-loop`. Contract: `GAUNTLET_JOB_CONTRACT.md` (frozen 2026-11-08).
> Budget: 3 rounds (hard ceiling 5). Round 1 = audit-only; code changes start Round 2.
> This ledger is the source of truth. Scores are the Fresh Critic's, not the builder's.

## Round summary

| Round | Builder delta | Gate | Fresh Critic | Weighted score | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| R1 | none (audit) | **BLOCKED-VISUAL-OVERFLOW** (375px: 729 > 375) | impl. audit | **5.95** | FAIL |
| R2 | scope wiring, 375 overflow, HEAD, q=0, layout guard, origin tag | green | impl. re-audit | **7.63** | FAIL |
| R3 | side-effect-free global reads, truthful banner, a11y, mesh cap, per-encoding ETags, cleanup | green | impl. re-audit | **7.90** | FAIL (budget) |
| Integrator | mesh read-only (blocker), 640px regressions, scope race, dead imports | **green** | not re-critiqued (budget) | — | CAPPED |

Score trajectory: `5.95 → 7.63 → 7.90`. Net +1.95. No plateau (each round improved); the loop stopped on the contract budget, not on convergence.

## R1 — audit (2026-11-08)

- **Gate**: FAIL. `BLOCKED-VISUAL-OVERFLOW` at 375px (`scrollWidth 729` vs `innerWidth 375`, offenders `.header-actions` 709px and graph-controls). All other gates green.
- **Blind A/B** (bar = Grafana Play dashboard shell): X (bar) 6.98 vs Y (artifact) 5.13. Biggest gap named: mobile overflow hides the primary surface; targets 21×25px; three stacked navigation bands.
- **Implementation critic (5.95/10)**: S1 client sends `?scope=` on only 2 of 6 scope-aware routes while the banner claims all panels are global; S2 375 overflow; S3 HEAD on assets 404s; S4 `gzip;q=0` still gzipped; S5 global guard hardcodes `memories`; S6 `origin_project` produced and never consumed. Also: Persona profile shape bug (pre-existing).
- **Fixed in R2**: all six.

## R2 — fixes and re-audit (2026-11-08)

Changed: `apiUrl()` on all scope-aware reads, responsive ≤640 layout, `header-actions` wrap, target sizes 44px at 375/768, HEAD allowed on asset routes + body omitted, q-value parser, `getStorageLayout(dir).memoriesDir`, `origin_project` pill, tests for each.

- **Gate**: green. 1447/0, tsc clean, build 434 modules, no overflow at 375/768/1280, 44×44 targets at 375/768, 4/4 headers, ETag/gzip/HEAD/304 correct.
- **Implementation critic (7.63/10) — FAIL**, new findings:
  - B1 global read (`openStore`) rewrote CURRENT.md and compiled the wiki.
  - B2 banner overclaimed: Health/ADRs/Cognition/Sync/Mesh stayed project-scoped.
  - B3 `.scope-filter-label { display:none }` deleted the only label of the project filter.
  - B4 `aria-current` hardcoded on Overview.
  - B5 write controls visible in a scope labelled read-only; archetype POST unguarded.
  - B6 mesh scope fed 2000 entries into the O(n²) graph sim.
  - B7 one strong ETag reused for gzip and identity; `*`/`W/` unhandled.
  - B8 dead `.nav-tabs`, empty icon spans, unused imports, standalone export dropped FONT_LINKS.
  - B9 weak CSS-text assertions; no client-scope-propagation test.
- **Root cause, not symptom**: the scope application was split-brained (server had 6 scoped routes, client sent 2). Fixed by wiring the client and narrowing the banner to the truth.

## R3 — fixes and re-audit (2026-11-08)

Changed: global reads open with `skipSyncConstraints`/`skipAutoWiki` and require the DB to pre-exist; banner enumerates scoped vs project-only panels; mesh capped at 200; per-encoding ETags + `*`/`W/`; sr-only label; `aria-current` maintained; `[write-action]` hidden outside project scope + `requireProjectScope()`; `<title>`-safe inline SVG search icon; duplicate header logo removed; dead imports/rules removed; FONT_LINKS in standalone.

- **Gate**: green. 1448/0, tsc clean, build 434, no overflow, 44×44 at 375/768, per-encoding ETags differ, wildcard 304, q=0 identity.
- **Implementation critic (7.90/10) — FAIL**, blocking finding:
  - **Mesh scope writes to linked stores**: `resolveMeshMemories` opened siblings with default options → `syncConstraints` rewrote `CURRENT.md` and `autoCompileWiki` wrote wiki files, while the banner said "read-only". New route, pre-existing engine behaviour.
  - Also: mobile detail drawer clipped (440px, masked by `overflow:hidden`); `.brand-tag` hide removed handoff status and wiki count at ≤640; archetype POST unguarded; `available:false` dead payload; scope race; two dead imports survived.
- **Budget**: 3 rounds consumed. Loop terminated per the stop matrix (`BUDGET`), not a PASS.

## Post-budget Integrator delta (single highest-impact fix + small regressions)

- **Blocker closed**: `src/mesh/resolver.ts` now opens sibling stores with `{ skipSyncConstraints: true, skipAutoWiki: true }`; a new `test/mesh.test.ts` case proves a sibling `CURRENT.md` is byte-identical after `resolveMeshMemories`. All mesh callers (UI, MCP, CLI) are read paths, so the fix is shared.
- **640px regressions closed**: `.detail-pane { width:100%; min-width:0 }`, `.close-btn` 44×44, `.chip` ≥24px, `.header .brand-tag` scoped so `#handoffStatus`/`#wikiCountBadge` survive.
- **Scope honesty**: archetype POST guarded; `available:false` renders an explicit absent-global-store banner; `loadData` drops stale responses when the scope changes mid-flight.
- **Dead imports removed**: `get`, `compileWiki`.
- **Verification**: `bun test` **1449 pass / 0 fail**, `bunx tsc --noEmit` clean, `bun run build` 434 modules, 375/768/1280 no overflow, 44×44 targets at 375/768, headers 4/4 + HSTS N/A, HEAD 200, wildcard 304, q=0 identity, `scan-secrets src` clean, zero new skip/only/todo.

## Gate receipts (final)

```
bun test                       1449 pass / 0 fail  (217 files)
bunx tsc --noEmit              exit 0
bun run build                  434 modules, index.js 1.99 MB
375px                          scrollWidth 375 / innerWidth 375
768px                          scrollWidth 768 / innerWidth 768
1280px                         scrollWidth 1280 / innerWidth 1280
targets (375, 768)             min 44x44 ; scope buttons 44px tall
headers                        CSP (no *), XFO DENY, nosniff, Referrer-Policy
HSTS                           N/A (localhost HTTP)
/assets/studio.css HEAD        200 + ETag + text/css
/assets/studio.js  gzip        different strong ETag from identity
If-None-Match: *               304
Accept-Encoding: gzip;q=0     identity (no content-encoding)
scan-secrets src               clean
lowered-bar scan               0 new skips/only/todos
```

## Residual risks carried into the packet

- Mesh topology is discovered twice per scope click (`/api/memories` + `/api/stats`); correctness unaffected, latency unbounded on very large workspaces.
- `identity;q=0` returns identity instead of 406; `*;q=0, gzip` resolves on the first coding token.
- `.chip` and `.archetype-card` are clickable `div`s (not keyboard reachable); pre-existing.
- Inline `onclick=` keeps `script-src 'unsafe-inline'` in the CSP.
- `escapeHtml` is duplicated across the server and the client string; tests only exercise the server copy.
- Persona panel shape bug (`profile` is a string; client reads `.raw`/`.archetype`) is pre-existing and unchanged.
- Browser evidence was measured on the default Overview view; audit tables and the open detail drawer were not re-measured at 375 after the drawer width fix.
