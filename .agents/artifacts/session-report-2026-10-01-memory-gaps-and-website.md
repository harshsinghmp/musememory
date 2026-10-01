# Session Report — Muse Memory: Agent-Memory Gaps, Website & Showreel

**Date**: 2026-10-01 · **Repo**: `harshsinghmp/musememory` · **Branch**: `main`
**Scope**: deep research → gap-driven engine features → professional website → motion-designed showreel

---

## 1. Objective

Close the highest-value gaps between Muse Memory and the state of the art in agent memory (from a first-party study of 86 systems), then present the product through a professional, accessible, SEO/AEO-optimized website with a designed showreel — all independently verified.

---

## 2. Research foundation

- **`deep-research-memory-mechanisms-2026-09.md`** — 86-system comparison; deep dives into deja-vu (0.7–0.8 ms lookup), Wax (6.1 ms p95), Vestige, Kage (write-time citation verification, 0% stale-served), agentmemory (12 lifecycle hooks), hindsight, Memvid, OpenViking, gbrain, engram, claude-mem.
- **Gap analysis (§14) scorecard** — Muse: speed 15/16, observability 8/8, **hands-free 4/10**, **trust 7/10**. Three gaps chosen for implementation: GAP-1 (write-time verification), GAP-2 (lifecycle hooks), GAP-3 (recall freshness gate).

## 3. Engine features shipped (GAP-1/2/3)

| Feature | Module | Behaviour |
|---|---|---|
| Write-time citation verification | `src/anchors/verify-write.ts` | Every code anchor is checked against the live filesystem before a write is admitted; hallucinated citations are rejected under the default `fail_fast` policy; decisions audited with existing ops |
| Recall-time freshness gate | `src/orchestrator/freshness.ts` | Drifted/orphaned-anchor memories are **withheld from `muse_context` by default** and reported via `withheld_memories` + `freshness_notice`; `include_drifted: true` opts in with provenance warnings; memoized per `(path, symbol, mtime)` |
| Claude Code lifecycle hook pack | `src/hooks/pack.ts` | `SessionStart` injects constraints + top memories before the first turn; `PostToolUse` captures Vibeguard-scanned observations; `Stop` distills candidates. Idempotent install, preserves user hooks, every handler fail-open |
| Surface wiring | `src/cli*`, `src/mcp.ts` | `memory hooks install/uninstall/…`, `connect --with-hooks`, `include_drifted` on `muse_context` |

**Tests**: `test/verify-write.test.ts` (9), `test/freshness.test.ts` (6), `test/hooks.test.ts` (10) → **527 tests / 88 files, fully offline**.

## 4. Website (Astro 7 · static · GitHub Pages `/musememory`)

Four pages — home, docs, compare, 404 — with brand assets (banner 1280×640, OG 1200×630, Twitter card), zero-JS-dependency motion runtime, and a hash-gated CI pipeline.

**Copy pass (content/copy mode)**: named reader (developer evaluating agent memory), one action (`npx musememory connect`), AIDA→AIDCA structure, FAQ written as 18-token standalone quotables, **FAQPage + SoftwareApplication JSON-LD** for AEO, anti-puffery scrub. All claims traceable: sub-2ms FTS5 recall, <50µs L0 cache, 80+ platforms, 24+ migrator formats, 69 MCP tools/6 profiles, 527 tests, 0 daemons, 45+ credential shapes.

**Layout (this pass)**: capabilities rebuilt as **editorial bands** — oversized numbered indices, hairline rules, alternating asymmetric columns, responsive collapse; section copy tuned to search intent ("AI agent memory", "persistent memory for AI coding agents", MCP, local-first).

## 5. Defects found and fixed

| # | Defect | Impact | Fix |
|---|---|---|---|
| 1 | Stale stats on site (498 tests / 86 files, "0% stale-served") | Unverifiable claims | Corrected to 527/88; unsupported stat removed |
| 2 | `BASE_URL` cross-page links missing slash (`/musememorydocs`) | Broken nav on the deploy | 10 links + 3 anchors base-corrected |
| 3 | Duplicated OG/Twitter meta block | Invalid head markup | Deduped |
| 4 | 404 page hardcoded `/` + `/musememory/docs` | Broken links under base path | Base-aware |
| 5 | Compare page had no `h1` | Heading hierarchy | Promoted |
| 6 | **Motion runtime silently dead** — `initMotion()` returned `<style>+<script>` markup injected *inside* the layout's `<script>` | **Whole sections rendered invisible** (`.reveal{opacity:0}` with no runtime) | `initMotion()` returns raw JS only; reveal CSS lives in `global.css` |
| 7 | Audit harness served 404.html for `/docs` and `/compare` | Earlier a11y runs measured the wrong page (phantom passes) | Servers resolve directory routes GitHub-Pages style |
| 8 | Prose links colour-only | WCAG 1.4.1 violation | Underlined; caught only after #7 was fixed |
| 9 | `/docs` horizontal overflow (409px @375, 30px @768) | Mobile page scroll | `.docs-body { min-width: 0 }` |
| 10 | Decorative orbs overflowed phones (199px) | Layout overflow | Hidden ≤640px + `html { overflow-x: clip }` |
| 11 | Visual/a11y audits force-revealed elements before measuring | Masked defect #6 | Audit now checks **natural reveals first** (with instant-scroll sweep) |

**Lesson recorded**: any audit that mutates the page before measuring can only confirm its own assumptions — reveal/motion checks must run before, not after, a freeze step.

## 6. Showreel redesign

**Decision**: the HyperFrames *skill bundle* was **hard-blocked twice by safe-skills** (prompt-injection ×18; then credential-file-access ×9 in `media-use`). Sources reviewed (`SKILL.md`, `prefs.mjs`) read as false-positive-prone but unreviewed at scale — so the skill bundle is **not installed**. Instead: the `hyperframes` npm CLI (devDependency) + public docs; vendor-generated agent instruction files were deleted from the scaffold.

**Composition** (`apps/website/showreel-hf/index.html`, 1080p master → 1280×720 web): four scenes in 10s — hook ("Your agent forgets. / Muse doesn't."), live terminal type-on (`npx musememory connect`, 1.9ms fused recall), benchmark stat cards with count-up motion (`<50µs`, `1.9ms`, `0`), logo-sting CTA hold. Brand tokens, self-hosted Inter + IBM Plex Mono, one GSAP timeline; **every number on screen is a measured benchmark**.

**Contracts learned the hard way**: never animate framework-owned `.clip` elements (visibility is framework-managed — animate inner wrappers); the occlusion inspector must be satisfied with a pseudo-element scrim rather than an opaque overlay.

**Pipeline**: `bun run site:showreel` → master render → 1280×720 H.264 → poster → ffprobe assertions. CI hash-gates composition + fonts + script and **fails the deploy on drift**; a manual dispatch can rebuild in CI.

## 7. Verification evidence

| Gate | Result |
|---|---|
| Engine tests | **527 pass / 0 fail** (88 files, offline) |
| Typecheck | `tsc --noEmit` clean |
| Site build | 4 pages |
| WCAG 2.2 AA audit | 24/24 token pairs, axe-core **0 issues** on 4 real pages |
| Visual review | **9/9** viewports (375/768/1280 × 3 pages) incl. natural-reveal checks |
| HyperFrames `check` | **0 errors**, motion clean, layout clean, **19/19 WCAG AA** |
| Showreel render | ffprobe: 1280×720 h264, 10.00 s, 738 KB |

## 8. Commits (pushed to `main`)

| Commit | Summary |
|---|---|
| `faeaaff` | `feat(memory)`: write-time citation verification, freshness gate, hook pack |
| `18db5f2` | `feat(website)`: site + verified copy + audit tooling |
| `6ff1598` | `feat(website)`: HyperFrames showreel composition |
| `0aa8500` | `feat(website)`: editorial capability bands + reveal-integrity audit check |

Deploy: `d938ac2..0aa8500` pushed; GitHub Pages redeploy carries the motion-runtime fix that restored the previously invisible sections.

## 9. Remaining work

1. **Full SEO/AEO copy-mode pass** across hero, flow, benchmarks, trust, FAQ, comparison (capabilities section was tuned this session; the rest carry the earlier pass).
2. **Editorial consistency**: extend the band language to the flow / benchmarks / trust / comparison sections so the page reads as one system.
3. **Showreel variants**: 9:16 vertical cut for social.
4. Optional: promote the browser-driven audit scripts into the PR CI gate (currently local-only gates).
