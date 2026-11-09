# GAUNTLET JOB CONTRACT — Wave 23 PR 1 (`T-451`–`T-453`)

> Frozen: 2026-11-08. Classification: **bounded** (fixed 3-ticket scope) with one structural element (the studio template split). Once frozen, criteria do not move; a lowered bar zeroes the round.

## Goal

Raise the Wave 23 PR 1 studio shell, dual-scope switcher and cached-asset architecture to a shippable bar:

- `T-451`: fixed 76px numbered left rail, warm-dark palette, Archivo Black + JetBrains Mono, English-only (no emoji/kanji in the rail).
- `T-452`: project / global / mesh scope switcher with live refetch, honest read isolation, no read-side store creation.
- `T-453`: modular assets served with strong ETag, pre-compressed gzip buffers, 304 fast paths, and a working standalone export.

## The Concrete Bar (named, fetchable, comparable)

**Primary bar: `https://play.grafana.org`** — Grafana Play, a named public dashboard shell with a fixed left navigation rail, header controls and dense data panels. Fetched live at identical viewports (375 / 768 / 1280) for the blind A/B comparison.

**Secondary bar: this repository's own shipped website (`apps/website`)** — it passed its qa-gate 16/16 (WCAG 2.2 AA, no-JS first frame, 9/9 viewports). Same brand, same product family.

Comparable measurable half: zero horizontal overflow, visible focus/labels, target sizes, header correctness, and the 5 OWASP headers.

## Acceptance Criteria (binary — all must pass)

1. **Gate green**: `bun test` exit 0 with 0 failures; `bunx tsc --noEmit` exit 0; `bun run build` exit 0.
2. **Security headers**: `Content-Security-Policy` (no wildcard `*`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. HSTS is recorded as **N/A on the localhost HTTP studio** (dev server; no TLS listener) — the bar's HTTPS receipt is captured separately and not claimed as ours.
3. **Viewports**: at 375px, 768px and 1280px, `document.documentElement.scrollWidth <= window.innerWidth` (no horizontal overflow); the rail is fixed at desktop and collapses without clipping below 900px.
4. **T-451**: six numbered rail sections (`01`–`06`), pre-existing views reachable from the tools group, rail text contains zero emoji, body/display fonts resolve to JetBrains Mono / Archivo Black, palette is the warm `#0c0a09` family.
5. **T-452**: the three scope buttons exist and are labelled; `?scope=global` reads the global store and never creates it; `?scope=mesh` aggregates; project scope is unaffected; non-project scope shows an honest banner.
6. **T-453**: `/assets/studio.css` and `/assets/studio.js` return strong ETags, gzip when negotiated, and 304 on `If-None-Match`; `/` shell contains no client monolith; the standalone export still parses and escapes `</script>`.
7. **No lowered bar**: the round diff contains no skipped/deleted tests, no weakened assertions, no threshold edits. At least one test per ticket can fail on its defect class.
8. **Secret scan**: `bun bin/musememory.ts scan-secrets src test .agents/context` reports no credentials.

## Automated Proof Commands (pinned)

```bash
bun test
bunx tsc --noEmit
bun run build
curl -sI http://127.0.0.1:3899/ | rg -i '(content-security-policy|x-frame-options|x-content-type-options|referrer-policy|strict-transport-security)'
bun bin/musememory.ts scan-secrets src test .agents/context
```

Visual + header audit is executed by the gate script captured in `ITERATION_LEDGER.md`.

## Iteration Budget

Max 3 rounds (hard ceiling 5). Round 1 is audit-only: contract + gate + blind critic, no code changes until the human approves the #1 fix.

## Scoring

`S = 0.40·Correctness + 0.25·MinimalDiff + 0.20·EdgeCases + 0.15·Cleanliness`. Pass = `S >= 9.0`, zero blockers, all acceptance criteria true.
