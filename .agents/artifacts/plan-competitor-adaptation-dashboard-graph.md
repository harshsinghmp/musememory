# Plan — competitor adaptation, dashboard refactor, instant graph

**Status**: planned, not started. Reconnaissance done (file/line facts below are verified).
**Scope**: three workstreams. Run them in order — A informs C, and B is independent.

---

## Reconnaissance (verified this session)

| Fact | Evidence |
|---|---|
| Graph engine is small and provider-backed | `src/graph.ts` ≈ 322 lines; `detectProvider` → `codegraph` \| `graphify` \| `none`; `indexGraph()` walks provider dirs, `loadGraphSymbolIndex()` reads `.memory/graph-symbols.json` |
| Symbol index is a flat JSON cache, file-read per call | `graph.ts:108–218` — `JSON.parse(readFileSync(...))` in loops over candidates → files → symbols |
| Graph intelligence adapters exist | `src/intelligence/adapters/{codegraph,graphify}.ts` |
| Vector path is thin | `src/vector.ts` = 182 lines |
| **Dashboard is a monolith** | `src/ui.ts` = **2,475 lines**, serving inline HTML/CSS/JS, CSP `'unsafe-inline'`; `startUiServer()`; `/api/export-html` produces a standalone graph HTML |
| Tests that constrain refactors | `test/graph.test.ts`, `test/graph_ast.test.ts`, `test/ui.test.ts`, `test/optimize.test.ts`, `test/governor.test.ts` |

**Latency hypotheses to verify before changing anything** (do not assume):
1. Provider index re-read per request instead of a memoized, mtime-invalidated index.
2. Client graph view likely re-fetches the whole memory set per poll and re-renders the full SVG/graph (no diffing, no ETag/version short-circuit).
3. Layout/edge computation possibly done on the server per request.
4. No virtualization for large graphs; DOM node count grows linearly with memories.

---

## Workstream A — competitor mechanism deep-dive (adaptation shortlist)

**Method**: `deep-research` skill, depth *wide*. Study mechanisms from **primary sources in the repos**, not blog summaries. For each candidate, require: (a) the exact mechanism, (b) its measured cost claim and how it was measured, (c) what Muse already has (we shipped write-time citation verification, the recall freshness gate, and the hook pack — do not re-propose those), (d) a concrete adaptation with an acceptance test.

**Targets to study** (carry-over from the 86-system study plus new angles):
- deja-vu — 0.7–0.8 ms lookup path (what indexing makes it possible)
- Kage — write-time citation verification (already shipped; study the *rest* of its model)
- Memvid — single-file memory container and its I/O pattern
- OpenViking — L0/L1/L2 tiering (compare with the existing L0 cache + archival ladder)
- agentmemory — 12 lifecycle hooks (we shipped 3; what are the other 9?)
- hindsight — observations vs mental models (does Muse's distiller produce equivalent abstractions?)
- Wax — 6.1 ms p95 under load; what its load profile reveals
- Vestige — signed-log exact-handle retrieval
- **New angles worth a look**: incremental code-index maintenance (tie into Workstream C), hybrid lexical+dense retrieval ranking, MCP resource *subscriptions* (push vs poll), time-decay + negative-memory scoring, and graph-native recall (edges as a retrieval signal rather than a visualization only).

**Deliverable**: `.agents/context/deep-research-memory-adaptation-2026-10.md` — scored gap table (impact × effort), top-3 ranked adaptations, each with acceptance criteria and the tests it must extend. No implementation in this workstream.

---

## Workstream B — dashboard refactor (designscope) with polished, mobile-first UI

**Problem**: `src/ui.ts` is a 2,475-line monolith with inline everything; not structured for responsive design, tokens, or states.

**Approach** (`designscope` for the system, `webdev` frontend mode to implement):
1. **Extract** the current dashboard's implicit design system (palette, spacing, type scale, component inventory) and reconcile with `.agents/brand/design.md` + tokens under `.agents/brand/tokens` — one token source, no parallel literals.
2. **Split** `ui.ts` into: server/routes (thin), static assets (`ui/` HTML, CSS, JS), and view templates — keeping the existing behaviours (`/api/*`, `/api/export-html`, harvest actions) byte-compatible in contract; add contract tests before moving code.
3. **Rebuild the layout mobile-first**: fluid type, container queries, logical properties, safe-area insets; graph + tables + filters usable at 375 px (drawer for filters, non-scrolling data tables, 24 px minimum targets).
4. **States**: loading, empty, error, success for every panel; skeletons over spinners; optimistic actions with rollback.
5. **A11y**: WCAG 2.2 AA — focus order, landmarks, labels for icon-only controls, `prefers-reduced-motion` respected.
6. **Gate**: add `scripts/audit-dashboard.ts` mirroring `apps/website/scripts/audit-visual.ts` (375/768/1280, overflow, tap targets, console errors, plus axe on the dashboard routes) and keep it green.

**Acceptance**: no behaviour regressions (all `test/ui.test.ts` cases pass), dashboard usable and non-overflowing at 375 px, audit script green, no new runtime dependency.

---

## Workstream C — make the graph instant

**Measure first** (budget: one session of profiling, no code changes):
1. Instrument `/api/*` graph routes with timing (server-side) and add a client-side long-task/`performance.mark` capture.
2. Record baselines: index load, payload bytes, JSON parse time, render time, frame time during pan/zoom, at 100 / 1k / 10k memories.
3. Confirm or discard the hypotheses above with numbers.

**Then fix, in this order** (each guarded by a test):
1. **Memoized, mtime-invalidated index** — load `.memory/graph-symbols.json` once per process keyed by mtime+size; invalidate on `indexGraph` write. (Hypothesis 1.)
2. **Version/ETag short-circuit** — a store revision counter; `/api/graph` returns `304`-equivalent empty payload when unchanged. (Hypothesis 2.)
3. **Incremental payloads** — send deltas (add/remove/update) after the initial snapshot instead of the full set per poll.
4. **Client-side layout + render diffing** — compute layout in the browser, reuse nodes across frames, batch DOM writes; no layout thrash (read/write separation).
5. **Budget guards** — cap rendered nodes above a threshold (aggregate clusters), virtualize lists.

**Acceptance criteria** (target, to be confirmed against the measured baseline):
- First graph paint ≤ 150 ms at 1k memories; incremental update ≤ 50 ms.
- Steady-state pan/zoom ≥ 55 fps with 2k nodes (Chrome, mid-tier laptop).
- No full re-fetch when the store revision is unchanged.
- Regression tests: `test/graph.test.ts` + `test/graph_ast.test.ts` extended with a latency/`no-full-refetch` assertion.

---

## Sequencing & handoff notes

1. **A** (research, no code) — 1 session.
2. **C** (profile → fix) — 1–2 sessions; A's findings on incremental indexing feed step C2/C3.
3. **B** (designscope refactor) — 1–2 sessions; independent, can run in parallel if a second agent is available (use `dispatching-parallel-agents`, but note `src/ui.ts` and `src/graph.ts` are the shared-file collision risk — hold the worktree lease).

Carried-forward constraints from this session: engine gate is `bun test` (527 pass / 88 files) + `tsc --noEmit`; HyperFrames skill bundle stays uninstalled (CLI only); audit servers resolve directory routes GitHub-Pages style; `.reveal` opacity is owned by `global.css` with the runtime in `src/scripts/motion.ts`.
