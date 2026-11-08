# TECHNICAL_DEBT — Wave 23 PR 1 run (2026-11-08)

Findings the gauntlet loop knowingly left open. Root cause → file → one-line fix. These are candidates for ticket rows, not silently accepted risk.

| # | Root cause | Location | One-line fix | Severity |
| :--- | :--- | :--- | :--- | :--- |
| D1 | Mesh topology is discovered twice per scope switch (`/api/memories` + `/api/stats`), each walking the workspace and opening sibling stores | `src/ui.ts:196-205` (`meshMemories`), `:303-304` | Cache the topology per request (or per server tick) and pass it to both handlers | P2 |
| D2 | CSP must keep `script-src 'unsafe-inline'` because the studio markup uses inline `onclick=` handlers | `src/ui_assets.ts` (markup), `src/ui.ts:232-239` | Move handlers to `addEventListener` in the JS module, then drop `'unsafe-inline'` | P2 |
| D3 | `.chip` filter pills and `.archetype-card` tiles are clickable `div`s with no keyboard path | `src/ui_assets.ts` (filter bar, archetype grid) | Convert to `<button>` (or add `role`/`tabindex`/key handlers) | P2 |
| D4 | `escapeHtml` exists twice (server module + client string); only the server copy is unit-tested | `src/ui.ts:96-103`, `src/ui_assets.ts` client block | Move the server copy to a shared util imported by both build targets, or add a parity test over the two strings | P3 |
| D5 | Persona panel reads `data.profile.raw` / `.archetype` but `/api/user-profile` returns a string | `src/user.ts:119,187`; client `fetchUserProfile` | Branch on `typeof profile === "string"` in the client (or return an object from the API) | P2 (pre-existing) |
| D6 | `Accept-Encoding` parsing returns on the first coding token; `identity;q=0` is served identity instead of 406 | `src/ui.ts:105-117` | Parse all codings, take max q for gzip, honour `identity;q=0` | P3 |
| D7 | CSS-text assertions in the T-451 test (e.g. `toContain("min-height: 44px")`) cannot fail on a real sizing defect | `test/ui.test.ts` T-451 | Rely on the Playwright viewport gate as the authoritative target-size proof; keep text checks as documentation only | P3 |
| D8 | Flat 200-entry mesh cap is a latency guard, not a product decision; the stats counter can disagree with a future paged list | `src/ui.ts:284`, `:303-304` | Add explicit "showing first N" pagination or raise the cap once the graph joins are bounded | P3 |
| D9 | The mobile chrome (199px header + 126px rail at 375) consumes ~53% of a 667px viewport before content | `src/ui_assets.ts` ≤640 media query | Collapse the tools group behind a "More" control and reduce the rail to one scrollable row | P2 |
| D10 | `.refresh-icon` / `.optimize-icon` are now CSS glyphs (`↻`, `◇`); their spinning state rotates a pseudo-element | `src/ui_assets.ts:76-78` | Confirm the animation reads correctly across browsers, or replace with a progress bar | P3 |
