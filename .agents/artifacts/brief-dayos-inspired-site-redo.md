# Brief — Muse Memory site redo (Dayos-inspired) + copy-mode landing pass

**Status**: ready to execute (analysis complete, not yet built)
**Reference**: https://www.dayos.com/ (fetched 2026-10-01)
**Skills to load**: `content` (`references/copy.md`, copy mode) · `animate` (motion discipline) · `webdev` (frontend mode)
**Non-negotiables**: all claims verifiable (sub-2ms FTS5, <50µs L0, 80+ platforms, 24+ migrator formats, 69 MCP tools/6 profiles, 527 tests/88 files, 0 daemons, 45+ credential shapes, MIT); WCAG 2.2 AA; one primary action (`npx musememory connect`).

---

## 1. What the reference actually does (observed structure)

| # | Device | How Dayos uses it | Muse adaptation |
|---|---|---|---|
| 1 | **Oversized stacked display headline** | "Born From / The AI era. / Not Bolted / Onto It." — three-line statement, huge, tight tracking, asymmetric break | "Your agent / forgets. / Muse / doesn't." |
| 2 | **Marquee statement band** | "WE'RE REVOLUTIONIZING THE WAY GOOD WORK GETS DONE." repeated across the band | "MEMORY THAT VERIFIES ITSELF · LOCAL-FIRST · ZERO DAEMONS ·" scrolling band |
| 3 | **Numbered triptych** | `AI. / GAP. / CLOSED.` — big label + 1–2 sentence body each | `CAPTURE. / VERIFY. / RECALL.` (the real pipeline) |
| 4 | **Negation ladder** | "You don't need to replace your ERP. / …vendor AI… / …another consulting firm… / You need AI that operates across all of them" | "You don't need another vector store. / You don't need an embedding API key. / You don't need a cloud round-trip at query time. / You need memory that verifies itself before it is stored." |
| 5 | **INTRODUCING X block** | Eyebrow in caps + two substantive paragraphs (mechanism + compounding benefit) | "INTRODUCING MUSE MEMORY" + mechanism (FTS5 + 11-dim ranking + write-time gate) + compounding (lifecycle, forgetting, distillation) |
| 6 | **Named capability trio** | Answers / Actions / Experts — three one-line-defined blocks | Retrieve / Verify / Govern |
| 7 | **Card + "More details →" grid** | repeated across use cases and departments | capabilities grid (per pillar) + "Read the docs →" per card |
| 8 | **Logo strip (marquee)** | Oracle, SAP, Workday, ServiceNow, Coupa, Jira, Anaplan, Slack | Claude Code, Cursor, Codex, Windsurf, Gemini CLI, OpenCode, Hermes, OpenClaw, Zed, Aider + "+70 more" |
| 9 | **Stat/proof band** | 70% / 30% / 2 weeks — concrete numbers inline | sub-2ms · <50µs · 0 daemons · 527 tests |
| 10 | **4-column footer** | Platform / Solutions / Resources / Company + contact + address + socials + legal | Product / Capabilities / Docs / Project + contact + MIT licence + GitHub/npm |
| 11 | **"Back to top"** + repeated CTA at page end | | keep |

**Voice notes**: short declaratives, second person, zero hype adjectives, concrete numbers, statement-caps section headers reused as marquees. Copy devices worth stealing structurally (not verbatim): the negation ladder and the numbered triptych.

**Token ideas to adopt**: high-contrast dark canvas, one accent pair, oversized display type with tight tracking, uppercase micro-labels with wide tracking, hairline rules between major bands, generous vertical rhythm, marquee bands as section dividers.

---

## 2. Target page architecture (single landing page)

1. **Nav** — brand, 4 links, single CTA (`Install in one command`).
2. **Hero** — stacked 3-line statement + one-paragraph mechanism line + terminal chip (`npx musememory connect`) + dual CTA. *Copy mode: AIDA attention + interest.*
3. **Marquee band** — "MEMORY THAT VERIFIES ITSELF · LOCAL-FIRST · ZERO DAEMONS · MCP-NATIVE".
4. **Triptych** — CAPTURE / VERIFY / RECALL, each with one real detail (Vibeguard scan; live-filesystem citation check; sub-2ms fused recall).
5. **Negation ladder** — the four "You don't need…" lines + the pivot line. *Strongest new copy block; keep it literal and true.*
6. **INTRODUCING MUSE MEMORY** — mechanism paragraph + compounding paragraph (76→0 lifecycle, archival ladder with rehydration, distiller).
7. **Proof band** — sub-2ms · <50µs · 0 daemons · 527 tests/88 files · 24+ formats · 69 tools.
8. **Capability trio** — Retrieve / Verify / Govern.
9. **Capability cards + links** — the six pillars as cards with "Read the docs →" (pairs with existing editorial band treatment; choose one, don't mix).
10. **Live pipeline** — the existing 4-step flow (capture → verify → consolidate → recall).
11. **Platform marquee** — 8 named + "+70 more".
12. **Showreel** — existing HyperFrames composition (keep; caption already accurate).
13. **Comparison** — existing 10-row table (keep; methodology note stays).
14. **FAQ** — existing answer-first FAQ + JSON-LD (keep; add 2 keyword-bearing questions).
15. **Final CTA**.
16. **Footer** — 4 link columns + licence + contact.

---

## 3. Copy-mode requirements per section

- Formula: hero = **AIDA**; negation ladder = **PAS** agitation turned into positioning; FAQ = answer-first AEO (18-token standalone sentences); CTA = First-Person/RAD with friction-killers ("no API key, no account, MIT").
- SEO/AEO targets: `agent memory`, `AI agent memory`, `persistent memory for AI coding agents`, `MCP memory server`, `local-first memory`, `self-verifying memory`, `Claude Code memory`, `Cursor memory`.
- Keep **one** primary action; secondary links only to docs/GitHub.
- Banned: seamless, robust, cutting-edge, elevate, empower, revolutionary, unlock, supercharge. No exclamation marks.
- Every number on the page must trace to a repo fact; the 11-defect table in `session-report-2026-10-01-memory-gaps-and-website.md` lists the traps already hit (stale stats, unsupported metrics).

---

## 4. Assets & mockups to produce

- `public/brand/og.png` (1200×630) — refresh to the new hero statement.
- Hero device mockup: terminal window (already a real component style) + optional CLI screenshot rendered from the built site.
- Marquee strips: text-based (CSS), no image assets needed.
- Platform logo strip: text wordmarks (no third-party logos — avoid trademark issues; wordmarks in mono type).
- Icon set: 6 small inline SVGs for the capability cards (stroke, 1.5px, currentColor) — no icon dependency.
- Showreel: existing `public/showreel.mp4` (1280×720 h264 10s) — optionally a 9:16 vertical cut.

---

## 5. Execution checklist (next session)

1. Load `content` copy mode; write all section copy to the brief's structure **before** touching layout.
2. Rebuild `index.astro` to the architecture above; move shared chrome to `global.css`; keep tokens; adapt the editorial band CSS already in place (do not keep both band and card treatments for the same content).
3. Implement marquee + triptych + negation ladder with the existing one-IntersectionObserver motion runtime (`src/scripts/motion.ts`) — no new JS deps; respect `prefers-reduced-motion`.
4. Regenerate brand assets; update OG/Twitter meta + JSON-LD (FAQPage + SoftwareApplication).
5. Gates: `bun run site:build` · `bun scripts/audit-a11y.ts` · `bun scripts/audit-visual.ts` (both must stay green — the visual audit now also verifies natural reveals) · `bun test` · `bun run typecheck`.
6. If the showreel composition changes, `bun run site:showreel` and commit the refreshed video + `.showreel-hash` (CI fails the deploy on drift).
7. Update `.agents/context/current.md` capability 38/39 and commit with Why/What/Verification.

## 6. Known constraints carried forward

- HyperFrames **skill bundle stays uninstalled** (safe-skills hard-blocked twice); the CLI devDependency is used for renders.
- The audit servers resolve directory routes GitHub-Pages style; keep that when touching them.
- Do not animate framework-owned `.clip` elements in the showreel composition.
- `.reveal` opacity is owned by `global.css`; the runtime lives in `src/scripts/motion.ts` (raw JS only, injected by `Base.astro`).
