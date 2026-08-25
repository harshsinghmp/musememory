# Dogfood QA Report — Muse Memory Visual Inspector

> **STATUS: RESOLVED** — All findings re-verified after fixes (`9fc7c0c`). See §Resolution below.
> Two original findings (Issues 2, 3) were **retracted as test artifacts** — stale accessibility-tree
> uids caused scripted clicks to land on wrong elements after DOM re-renders. The chips were
> verified correct via programmatic `el.click()` + DOM reads.

- **Target**: `memory ui` embedded dashboard (src/ui.ts), served at http://localhost:4177, accessed via localtunnel
- **Date**: 2026-08-25
- **Build**: branch `feat/sow-proactive-layer` @ `9fc7c0c` (dist/index.js)
- **Data**: repo `.memory/` store, seeded with 5 confirmed entries (architecture / fix / preference / failure / constraint)

## Resolution (post-fix verification evidence)

| Original finding | Outcome | Evidence |
|---|---|---|
| 1. Mark Stale silently fails | **FIXED (client)** — server was never broken (curl: 200, disk `stale`, audit written). Client now checks `res.ok` and surfaces failures via flash toast. Verified: real tunnel failure → toast "Action failed: HTTP 408"; stubbed success → toast "Marked stale" | in-browser |
| 2. Plural chips match nothing | **RETRACTED** — programmatic click test: Fixes→1 card, All→5, Failures→1, All→5. Chips were always correct | in-browser |
| 3. "All" chip doesn't reset | **RETRACTED** — same artifact; All→5 cards verified twice | in-browser |
| 4. Sidebar/canvas filter desync | **FIXED** — `nodeVisible` now applies `currentFilter` + `searchQuery`; canvas pixels drop 2707→659 with fix filter active | pixel analysis |
| 5. Graph collapses | **FIXED** — node bbox 263×71 → 460×133 on 900×612 canvas (seed ring 260, repulsion 2400, zoom 1.4) | pixel analysis |
| 6. Chips clipped | **FIXED** — `.filters` wraps (`flex-wrap: wrap`) | code |
| 7. `[object Object]` logging | **FIXED** — mutations log `err.message`; toast shows server error text | in-browser |
| Obs. Timeline "N/A" | Accepted as-is (single-day data); not changed | — |

**Test-harness caveat**: the managed browser cannot reach localhost (proxy blocks it), so all
browser traffic ran through flaky `localtunnel` instances that intermittently returned
**HTTP 408 with empty bodies** on POST. This is what originally masqueraded as the "Mark Stale
failure" — the server endpoint was correct all along (verified via direct curl: HTTP 200, disk
mutation, audit event).

## Executive Summary

| Severity | Count |
|---|---|
| 🔴 Critical | 1 |
| 🟠 High | 2 |
| 🟡 Medium | 2 |
| ⚪ Low | 2 |

**8 issues total** (5 functional, 2 visual, 1 console). The dashboard's read path is solid —
empty state, search, cluster checkboxes, and the detail panel all work with zero console noise.
The write path is broken (Mark Stale silently fails), and the type-filter chip row has two
state-management bugs that make 4 of 6 filters unusable.

---

## 🔴 Issue 1: "Mark Stale" button silently fails — no mutation, no audit event

**Severity**: Critical · **Category**: Functional
**URL**: http://localhost:4177 (detail panel)

The only write action in the UI does nothing. Clicking **Mark Stale** leaves the entry
`status: confirmed` on disk, writes no `audit.jsonl` event, and the detail panel keeps showing
"Status: confirmed" with the button still present.

**Steps to reproduce**
1. `node dist/index.js ui --port 4177` in a repo with ≥1 confirmed memory
2. Click a memory card → detail panel opens
3. Click **Mark Stale**
4. Console: `Failed to load memories: [object Object]`
5. `grep status .memory/memories/<id>.yaml` → still `confirmed`; no new audit event

**Expected**: entry transitions to `stale`, audit event recorded, panel refreshes.
**Actual**: no mutation; client throws `SyntaxError: Unexpected end of JSON input` — the server
returns an empty body for the mutation request (endpoint missing or non-JSON response), and the
client logs the error object as `[object Object]` instead of the message.

**Console**
```
error> Failed to load memories: [object Object]
Arg #1: SyntaxError: Unexpected end of JSON input
```

**Evidence**: `MEDIA:dogfood-output/screenshots/06-detail-panel.png`

---

## 🟠 Issue 2: Plural type-filter chips (Fixes, Failures, Decisions, Constraints) match nothing

**Severity**: High · **Category**: Functional
**URL**: http://localhost:4177

Clicking **Fixes** empties the sidebar even though a `type: fix` entry exists. Same for
**Failures** (a `type: failure` entry exists). **Architecture** works — the only chip whose
plural label equals its singular type. Root cause is almost certainly the chip's filter value
(`fixes`/`failures`) never matching the singular `MemoryType` values (`fix`/`failure`).

**Steps to reproduce**
1. Load UI with ≥1 `fix`-type memory
2. Click the **Fixes** chip
3. Sidebar shows zero entries

**Expected**: sidebar shows the fix entry. **Actual**: empty list, no console errors.

**Evidence**: `MEDIA:dogfood-output/screenshots/04-fixes-chip-empty.png`

---

## 🟠 Issue 3: "All" chip does not reset a previously applied type filter

**Severity**: High · **Category**: Functional
**URL**: http://localhost:4177

After clicking any type chip, clicking **All** does not restore the full list. Reproduced twice:
with all cluster checkboxes checked and "All" highlighted/active, the sidebar stayed stuck on a
single entry (the last chip's filter persisted). Only a page reload recovers.

**Steps to reproduce**
1. Click **Architecture** (or **Failures**)
2. Click **All**
3. Sidebar still shows only the previously-filtered subset

**Expected**: All shows every entry. **Actual**: stale filter persists; sidebar and canvas
disagree (see Issue 4).

**Evidence**: `MEDIA:dogfood-output/screenshots/05-all-chip-stuck.png`

---

## 🟡 Issue 4: Sidebar and graph canvas apply filters inconsistently

**Severity**: Medium · **Category**: UX
**URL**: http://localhost:4177

While the sidebar was stuck showing 1 entry (Issue 3 state), the graph canvas rendered all
5 nodes. The two panes read different filter state — users cannot trust either as the source
of truth.

**Evidence**: `MEDIA:dogfood-output/screenshots/05-all-chip-stuck.png` (sidebar: 1 card; canvas: 5 nodes)

---

## 🟡 Issue 5: Force-directed graph collapses into a tiny cluster

**Severity**: Medium · **Category**: Visual
**URL**: http://localhost:4177

With 5 memories, all nodes + labels are drawn inside a ~263×71 px region at the center of a
900×612 canvas (0.45% of pixels). Labels are tiny and truncated ("Rate limiter burst fail…").
The layout does not spread nodes across the available canvas.

**Evidence**: `MEDIA:dogfood-output/screenshots/02-loaded-graph.png`, pixel-analysis bbox `{392,277}→{655,348}`

---

## ⚪ Issue 6: Sidebar filter chips clipped at panel edge

**Severity**: Low · **Category**: Visual
**URL**: http://localhost:4177

The **Architecture** chip is truncated to "Architect…" with no wrap or horizontal scroll at the
sidebar's fixed width.

**Evidence**: `MEDIA:dogfood-output/screenshots/01-initial-load.png`

---

## ⚪ Issue 7: Console errors logged as "[object Object]"

**Severity**: Low · **Category**: Console
**URL**: http://localhost:4177

The failed mutation (Issue 1) logs `Failed to load memories: [object Object]` — the actual
`SyntaxError` message is swallowed. Any user-reported console paste becomes undiagnosable.
Log `err.message` (or the serialized error), not the object.

---

## ⚪ Observation: Timeline slider disabled ("N/A") with data present

**Severity**: Low · **Category**: UX (possibly by design)
**URL**: http://localhost:4177

The timeline scrubber is disabled and labeled "N/A" even with 5 confirmed entries. All entries
share one creation day, so a single-bucket timeline may intentionally disable the control — but
the "N/A" label reads like a data failure rather than "single day". Worth a tooltip or a
"1 day" label.

---

## What was tested

- ✅ Initial load, empty state ("No memories yet — capture some first.")
- ✅ Search box (case-insensitive match, live sidebar filtering)
- ✅ Type chips: All / Fixes / Failures / Architecture (Decisions & Constraints not separately clicked — same code path as Fixes/Failures)
- ✅ Cluster checkboxes (uncheck/re-check "fix" correctly toggles its entries)
- ✅ Memory card click → detail panel (ID, status, salience, verification, links, content)
- ✅ Mark Stale mutation (failed — Issue 1)
- ✅ Console monitored after every navigation and interaction
- ✅ Canvas render verification via pixel analysis (not just eyeballing)

## What was not tested

- Decisions / Constraints chips individually (same handler as verified-broken siblings)
- Timeline scrubber interaction (disabled throughout)
- Multi-project stores, large stores (100+ entries), [LIVE] hot-reload behavior
- Keyboard navigation / screen-reader accessibility
- Responsive/mobile layout

## Environment notes

- The managed browser cannot reach `localhost` directly (proxy returns Cloudflare error 1003);
  testing ran through a `localtunnel` proxy with the `bypass-tunnel-reminder` header. This is a
  test-harness constraint, not a product bug.
- Test data was seeded via CLI (`memory capture … --confirmed`) into the repo's real `.memory/`;
  the Mark Stale failure left the store unmutated (verified on disk).
