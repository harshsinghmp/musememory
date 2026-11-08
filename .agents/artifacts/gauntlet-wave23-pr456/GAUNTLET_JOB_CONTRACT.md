# GAUNTLET JOB CONTRACT — Wave 23 PR 4–6 (`T-460`–`T-468`)

> Frozen 2026-11-08. Classification: **bounded** (three merged PR groups: agents hub, About/onboarding/deck, performance).
> Bar: **Grafana Play** dashboard shell (live) as the external reference; the repository's own website as the internal design reference.
> Budget: 2 rounds (hard ceiling 5). Round 1 = audit; code changes start in the fix round.

## Goal

Verify the Wave 23 PR 4–6 surfaces are correct, secure, responsive and honestly tested:

- **T-460–T-462**: agents hub with WIRED/UNWIRED/ABSENT discovery, one-click wire/unwire (harness opt-in + config backup), point-any-agent manifest.
- **T-463–T-465**: poster About panel with live facts, quick-start cards, searchable command deck.
- **T-466–T-468**: projection cache with write invalidation, hidden-tab pause, sub-10ms cached projections.

## Acceptance criteria (binary)

1. `bun test` 0 failures; `tsc --noEmit` exit 0; `bun run build` exit 0.
2. Headers: CSP (no wildcard), XFO DENY, nosniff, Referrer-Policy; HSTS N/A on localhost HTTP.
3. 375 / 768 / 1280: `scrollWidth <= innerWidth`; no clipped primary controls.
4. Agents: statuses are exactly WIRED/UNWIRED/ABSENT; wire requires explicit harness opt-in; an existing config is backed up before writing; unwire removes the memory server; unknown agent fails loud.
5. Manifest: returns the memory directory, DB path, `memory mcp`, and a snippet containing `memory_search`; no secret-shaped content.
6. About/onboarding/deck: live facts render; four quick-start commands; seven deck commands filtered by input; every copy action is wired.
7. Cache: second read is `X-Cache: HIT`; any UI POST makes the next read `MISS`; cached bodies match.
8. Visibility: hidden tab stops the loop; visible tab wakes it; no `setInterval`.
9. Benchmark: median cached `/api/memories` and `/api/stats` < 10ms.
10. No lowered bar (no skips/only/weakened assertions); `scan-secrets src` clean.

## Proof commands

```bash
bun test
bunx tsc --noEmit
bun run build
bun bin/musememory.ts scan-secrets src
curl -sI http://127.0.0.1:3899/ | rg -i '(content-security-policy|x-frame-options|x-content-type-options|referrer-policy)'
# viewport + shell audit via the Playwright script used in PR 1
```

## Scoring

`S = 0.40·Correctness + 0.25·MinimalDiff + 0.20·EdgeCases + 0.15·Cleanliness`. Pass: `S >= 9.0`, zero blockers, all criteria true.
