# Graph baseline — Workstream C, measurement pass

**Date**: 2026-10-01
**Harness**: `scripts/bench-graph.ts` (`bun run bench:graph`), raw run data in
`.agents/artifacts/bench-graph-baseline.json`
**Scope**: measurement only — no source file was edited to produce these numbers.

## Method

The harness boots the real `startUiServer()` in-process on a throwaway port against a
synthetic store, seeds memories through the public `propose()` API (one structural link
each), then measures the server over `fetch` and the client over Playwright.

- Sizes 100 / 1,000 / 10,000 memories; seeds are cached under `/tmp/muse-bench-graph/<n>`
  and reused on later runs (`--fresh` re-seeds).
- Server numbers are the median of 5 warm calls; the first (cold) call is in parentheses.
- Client numbers are the **median of 3 chromium repeats** by first graph paint, with the
  spread shown — a single sample is not a baseline, chromium startup jitter is
  non-monotonic (one run at 100 memories measured 1,965 ms where two others measured
  ~200 ms, with no corresponding long task).
- First graph paint is probed from page pixels (`drawImage` → `getImageData` on a 32×18
  downscale of `#graphCanvas`), so it cannot be faked by a blocked main thread.
- The Google Fonts CDN is blocked by default (`--cdn-fonts` to allow it) so the client
  numbers measure the dashboard rather than an unreachable network dependency. See F6.

## Server-side

| memories | store | /api/memories | /api/snapshot | /api/stats | /api/search |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 100 | 0.8 ms / 90.0 KB | 1.0 ms / 90.1 KB | 0.7 ms / 0.2 KB | 4.3 ms / 22.5 KB |
| 1,000 | 1,000 | 6.5 ms / 905.6 KB | 5.5 ms / 905.7 KB | 7.7 ms / 0.3 KB | 31.0 ms / 22.7 KB |
| 10,000 | 10,000 | 81.2 ms / 9,105.5 KB | 73.1 ms / 9,105.5 KB | 53.8 ms / 0.3 KB | 339.1 ms / 22.8 KB |

Payload growth is linear at ~0.9 KB per memory. `/api/stats` costs 53.8 ms to return a
0.3 KB body because the handler iterates every memory in JS to build `typeCounts`.

## Client-side

| memories | first graph paint | DOM nodes | graph nodes | graph edges | long tasks | interaction |
| ---: | ---: | ---: | ---: | ---: | --- | --- |
| 100 | 213 ms (197–1,965 over 3 runs) | 1,714 | 100 | 198 | 1 / 68 ms (max 68 ms) | 59.9 fps, 0/55 frames >33 ms |
| 1,000 | **268 ms** (260–310) | 11,614 | 1,000 | 1,998 | 2 / 191 ms (max 116 ms) | **loop dead — 0 repaints** |
| 10,000 | **2,028 ms** (2,021–2,087) | **110,614** | 10,000 | 19,998 | 3 / 1,874 ms (max 1,689 ms) | **loop dead — 0 repaints** |

DOM node count is linear at ~11 nodes per memory. Graph node/edge counts match the store.

## Findings

### F1 — the graph canvas dies permanently at ≥1k memories (critical)

```
IndexSizeError: Failed to execute 'arc' on 'CanvasRenderingContext2D':
The radius provided (-81.1292) is negative.
```

`drawGraph` computes `radius = (6 + min(10, degree * 2)) * p.scale`, and `project()`
returns `scale = (fov / (fov + z2 + 400)) * zoom`. Any node pushed past the camera plane
(`z2 < -1000`) makes the denominator negative, so the radius goes negative and `arc()`
throws. With 100 nodes the layout stays inside ±260; at 1k+ the repulsion term
(`2400 * alpha / dist²`) spreads nodes far enough to cross that plane.

The throw escapes `tick()` **before** `requestAnimationFrame(tick)` is called, which is on
the last line of the function — so the render loop never reschedules itself. The canvas
then shows a single frozen frame forever: no pan, no zoom, no redraw on filter change.

Reproduced **3/3 runs at 1,000 and 3/3 at 10,000, 0/3 at 100.** The harness reports this as
`interaction: loop dead (0 repaints)`; the 0-frame measurement is the defect, not a harness
gap.

### F2 — the force simulation is O(n²) in a single task

`simulateStep()` iterates every node pair per frame. At 10,000 nodes that is ~50 M pairs
per frame and 232 frames before `simAlpha` decays to the 0.03 stop threshold. The measured
single long task is **1,689 ms at t+338 ms**, and it is what pushes first paint to 2 s.

### F3 — `/api/snapshot` and `/api/memories` are the same 9.1 MB payload

Both return `9,105.5 KB` at 10k memories, and the dashboard's `loadData()` fetches the full
set while other panels fetch snapshots — roughly 18 MB per load at 10k, with the same data
serialized twice.

### F4 — `/api/stats` computes in JS what SQL should aggregate

53.8 ms for a 0.3 KB response at 10k; the handler loops all memories for `typeCounts`,
`confirmedCount`, and `linksCount`.

### F5 — `/api/search` scales worse than the store

339.1 ms at 10k (31.0 ms at 1k) with a fixed 22.8 KB response — the retrieval path, not the
payload, is the cost.

### F6 — the local dashboard depends on Google's font CDN

`src/ui.ts:664-666` injects a render-blocking stylesheet from `fonts.googleapis.com`, and
the CSP whitelists both Google font hosts. For a product positioned as local-first with
zero cloud dependencies this is an external network call on every dashboard load, a privacy
leak, and a latency source outside our control: in this environment the request never
resolves, which produced a spurious multi-second load stall in early runs.

### F7 — the render loop never idles

`tick()` calls `requestAnimationFrame(tick)` unconditionally, so the dashboard keeps
requesting frames forever even with the graph tab idle and `simAlpha` fully decayed.

## Verdict on the plan's hypotheses

| # | Hypothesis | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Provider index re-read per request | **Refuted for the graph view** | The graph's data source is `/api/memories` → SQLite list + L0 cache, 0.8–6.5 ms warm. `loadGraphSymbolIndex()` lives on the retrieval path, not the dashboard path. |
| 2 | Client re-fetches everything and fully re-renders per poll | **Half confirmed** | No polling exists (`setInterval` appears twice in `src/`, both in `cli/upgrade.ts`); but every load does re-fetch the full set and rebuild the entire graph — 11,614 DOM nodes at 1k. |
| 3 | Layout/edges computed on the server per request | **Refuted** | No `/api/graph` route exists; layout is client-side (`initGraph` + `simulateStep`). |
| 4 | No virtualization; DOM grows linearly | **Confirmed** | 1,714 → 11,614 → 110,614 nodes, exactly linear at ~11 per memory. |

## Acceptance targets vs baseline

| Target | Baseline | Status |
| --- | --- | --- |
| First graph paint ≤ 150 ms @1k | 268 ms | 1.8× over |
| Incremental update ≤ 50 ms | not measurable — no revision/delta API | blocked on step 2–3 |
| Steady-state ≥ 55 fps pan/zoom @2k | 0 fps — loop dead at ≥1k | fails harder than the target |
| No full re-fetch when revision unchanged | not measurable — no `/api/graph` route | blocked on step 2 |

## Fix order, with the baseline as the gate

1. **F1 first** — clamp `scale` to a positive minimum in `project()` (and guard `radius`)
   so a node behind the camera can never throw. This is a correctness fix, not a perf fix:
   without it nothing else is observable at scale. Test: deterministic seed that pushes a
   node past the camera plane, asserting `drawGraph` does not throw and the loop survives.
2. **F2** — replace per-frame O(n²) with a decaying Barnes–Hut or grid-bucketed repulsion,
   or run the layout once to convergence off the render path and stop. Gate on the 1.69 s
   long task disappearing at 10k.
3. **F3/F4** — one graph payload route returning only the fields the canvas needs (id,
   title, type, status, project, updated_at, degree, links), a SQL `GROUP BY` for stats,
   and an ETag/revision short-circuit. This is also where the `≤50 ms` and
   `no full re-fetch` targets become measurable.
4. **F7 + item 4 of the plan** — stop the loop when idle and when the tab is hidden;
   add node caps above a threshold, and stop emitting a DOM row per memory (11 nodes each).
5. **F6** — self-host the two font families (the website already ships self-hosted Inter and
   IBM Plex Mono) or fall back to a system stack; drop both hosts from the CSP.
