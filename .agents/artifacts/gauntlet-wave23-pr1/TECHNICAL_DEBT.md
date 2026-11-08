# TECHNICAL_DEBT — Wave 23 PR 1 run (2026-11-08)

Findings the gauntlet loop knowingly left open after five rounds. Root cause → file → one-line fix. Closed items are listed at the bottom for the record.

| # | Root cause | Location | One-line fix | Severity |
| :--- | :--- | :--- | :--- | :--- |
| T1 | The browser scope-race guard has no behavioural test; only a source-string assertion pins it | `test/ui.test.ts` (scopeGeneration count) | Add a Playwright check that delays the first `/api/memories` response, switches scope, and asserts the stale payload is never painted | P2 |
| T2 | The mesh cache-invalidation test only fails inside the 2s TTL window | `test/ui.test.ts` ("linking a mesh store…") | Expose the invalidation epoch (or a discovery counter) so the test is deterministic, and add a "two reads inside the window do not re-discover" case | P2 |
| T3 | CSP must keep `script-src 'unsafe-inline'` because the studio markup uses inline `onclick=` handlers | `src/ui_assets.ts` markup, `src/ui.ts` CSP | Move handlers to `addEventListener` in the client module, then drop `'unsafe-inline'` | P2 |
| T4 | `.chip` is 24px tall at 768 (44px only at ≤640); WCAG 2.2 AA passes but the AAA/44 target does not | `src/ui_assets.ts` chip rules | Raise chips to 44px at ≤900 or accept AA explicitly in the gate contract | P3 |
| T5 | Memory list cards are clickable `div`s with no keyboard path | `src/ui_assets.ts` `renderList` | Render cards as `<button>` (or add role/tabindex/key handlers) | P2 |
| T6 | Standalone export sets `STANDALONE_DATA` and skips every API fetch, so stats/wiki/audit render empty | `src/ui_assets.ts` `renderStandaloneHtml` | Serialize the auxiliary payloads into the export or hide those panels in standalone mode | P3 |
| T7 | Mesh reads still call `openStore` on a sibling, which can mint `memories/` and the DB if absent | `src/mesh/resolver.ts:98` | Skip nodes without an existing `memories/` + DB, or add a read-only store opener | P2 |
| T8 | `escapeHtml` exists twice (server module + client string); only the server copy is unit-tested | `src/ui.ts`, `src/ui_assets.ts` | Add a parity test over both implementations, or generate the client copy from the server one | P3 |
| T9 | CSS-text assertions (`toContain("min-height: 44px")`) cannot fail on a real sizing defect | `test/ui.test.ts` T-451 | Treat the Playwright viewport gate as authoritative; keep text checks as documentation | P3 |
| T10 | Flat 200-entry mesh cap is a latency guard, not a product decision | `src/ui.ts` mesh scope | Add explicit "showing first N" paging or raise the cap once joins are bounded | P3 |

## Closed during the run

- Topology discovered twice per scope switch → topology + aggregate memoized (2s), invalidated on link.
- Mesh scope rewrote sibling `CURRENT.md`/wiki → resolver opens read-only; regression test proves byte-identical.
- Global scope rewrote/re-created the store → requires an existing DB, opens with `skipSyncConstraints`/`skipAutoWiki`.
- Non-keyboard filter/persona/wiki cards → real `<button type="button">` with valid children.
- Persona panel read `.raw` off a string profile → string handled.
- `gzip;q=0`, `identity;q=0`, spaced q-values, no header → full negotiation with 406.
- 375px overflow, three-row mobile rail, 641–900px drawer clipping → fixed.
- Overclaiming banner → enumerates the exact scoped panels.
- Underivable `aria-pressed` on archetype cards → removed; `.active` remains the visual state.
