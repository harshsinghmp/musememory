# ITERATION LEDGER — site build + Wave 25 wiring audit (2026-11-08)

## Audit (code-review, audit mode) — REQUEST-CHANGES

| Finding | Resolution |
|---|---|
| B1 global `cookie` override rewrote express's dependency and fixed nothing | Override removed; lock regenerated |
| B2 `patch-astro-cookie.mjs` was cargo-cult and could mask a bad resolution | Script and call sites deleted; Node launcher alone builds |
| R3 `asserted_at` had readers and no writer | `propose` accepts `asserted_at`; `memory_write` schema declares it; persistence tested |
| R4 two absent-value semantics | `temporal.ts` and `retrieval.ts` now both treat absent as "no belief constraint" |
| R5 briefing test used type-illegal observation sources | Fixtures use `manual`/`test`; failure provenance still classified as verification (debt) |
| R6 briefing truncated observations before episodes | Episodes built over the full stream, then sliced |
| R7 "wired" claims were one shared string | Ticket/debt notes now state per-ticket facts |
| D6 site prerender open in debt | Struck as fixed |

Also updated `.agents/standards/frontend-astro.md` (Astro 7.4.7 + Node launcher note).

## Gate

- `bun test`: 1487 pass / 0 fail (227 files)
- `tsc --noEmit`: clean
- `bun run build`: 434 modules
- `scan-secrets src`: clean
- `node scripts/astro.mjs build`: 6 pages
- `site:qa`: 17/17 passed, VERDICT SHIP

Status: **CAPPED** — fixes applied after the audit; no second audit round.
