# 📍 Current Shipped State & Active Invariants

> **Version**: `v3.0.2`  
> **Status**: Patch Release — correctness fixes from the cross-file invariant audit, machine-verified published claims, and the website redesign.

---

## 🔬 Latest Session — Audit, Documentation & Website Redesign (2026-10-21)

A cross-file invariant audit, a documentation audit, and a full website
redesign landed together. Everything below is verified by the test suite.

### Code fixes (all regression-tested)

- **Prompt-injection bypass closed (BLOCKER)**: `setCurrent()` in `src/governor.ts` now sanitises injected context blocks before writing `CURRENT.md`, and the session-handoff discovery line in `src/mcp.ts` is sanitised too. Previously only the *stored memory* was sanitised (by `propose()`), so a `memory_capture(type="constraint")` could persist an injection that was replayed into every later prompt. Fixes T-110's stated scope. Cover: `test/audit_blocker_regressions.test.ts`.
- **Store could fail its own schema (BLOCKER)**: `schema.json` had `additionalProperties: false` but omitted `stale_embedder`, a flag the embedder writes onto entries. Every entry that failed embedding was reported corrupt by `memory validate`, `memory doctor` and `memory verify --strict`.
- **Bi-temporal queries served the wrong snapshot (BLOCKER)**: the L1 context cache key omitted `as_of` (and the include/type/tag flags), so a "what did we believe in Q1?" query could be answered from a 30-second-old current-state cache entry.
- **Tiered context dropped `as_of` (BLOCKER)**: `get_context(tier=1, as_of=...)` returned the current state while the untiered path returned the historical one. Both branches now forward `as_of` and `depth`.
- **Access counter never accumulated (BLOCKER)**: `readEntry()` re-inserted the YAML mirror over the SQLite row, resetting `access_count` to its baseline on every read. The counter fed the access-frequency ranking axis, the LangMem frequency axis and the retention half-life — all were permanently starved. The database row is now authoritative for the counter.
- **Tier token budget was declared but never enforced**: `resolveTierBudget()` was exported and documented but never called, so Tier 0 emitted 327 tokens against a 200-token budget. The budget now bounds the rendered output and reports what it dropped.
- **MCP server advertised version `1.6.0`** while the package was at `3.0.0`. The version now comes from `package.json` (`src/version.ts`).
- **Undiscoverable tools**: `memory_recall`, `memory_get_constraints` and `memory_set_constraints` were callable but absent from `ListTools`. All three are now registered.
- **Undeclared destructive flags**: `memory_delete` honoured undocumented `apply`/`force` aliases that silently disabled the dry-run default. Only the declared `dry_run` and `confirm` can now disable it.
- **Snapshot restore had no path containment**: `restoreSnapshotRing()` now resolves strictly inside `.memory/snapshots/`.
- **`"checkpoint" as any`**: the audit operation is now a declared member of the `AuditOperation` union.
- **Corroboration predicate de-duplicated**: the 13-line "is this source synthetic" predicate existed in two files. The predicate is now shared (`src/quality/corroboration.ts`); the two *bars* it feeds stay deliberately different and are documented as such.
- **Title/tag limits declared but not used**: `MAX_TITLE_LENGTH` and `MAX_TAGS` existed while the enforced values were magic numbers. The store and harvester now use the constants, and the draft-title limit is declared as `MAX_DRAFT_TITLE_LENGTH`.

### Published-claim integrity (new)

`scripts/generate-claims.ts` derives every countable claim from `src/` and
writes `claims.json`; `scripts/generate-cli-reference.ts` writes
`docs/cli-reference.md` and `docs/mcp-tool-matrix.json`. The website imports
`claims.json` instead of hard-coding figures.

This exists because the site advertised **80+ coding agents** (real: 52),
**45+ credential shapes** (real: 8 rule families) and **69 tools across 6
profiles** (real: 115 across 7), while the README was already honest at 52.
`test/marketing_claims.test.ts` now fails the build on any drift, on any
stale figure in the published prose, and on any agent-facing document that
names a tool which does not exist.

### Documentation

- `docs/agent-reference.md` — new: the agent contract (install, layout, mandatory session protocol, trust gates, failure semantics).
- `docs/cli-reference.md` — new: generated CLI + MCP reference.
- `docs/roadmap.md` — new: the sprint board, moved out of the README.
- `README.md` — restructured: 60-second start, "How it works", "Where your memory lives", a documentation map that separates human docs from agent docs, and a 54KB → 39KB reduction.
- `.agents/context/product.md` — rewritten against the live registry; it previously named six tools that do not exist.
- `.agents/standards/frontend-astro.md` — rewritten to match this repo's actual stack (static output, plain CSS, no SSR adapter, no Tailwind, no Motion.dev).

### Website

- Redesigned `apps/website`: shared `Nav`/`Footer`/`Logo` components (the 404 page previously had no navigation at all), a real mobile menu (the nav links were hidden below 860px with no replacement), full SEO head (canonical, OG, Twitter, icons, manifest, skip link), a new "Your memory is a folder" section, and a capability grid that replaces eight long editorial bands.
- New brand system: a redesigned monogram (the previous mark read as a zigzag, not an "M"), favicon, Apple touch icon, PWA icons, OG card, Twitter card, README banner — all generated deterministically with resvg from the fonts already vendored in the repo.
- New agent-readable layer: `llms.txt` and `llms-full.txt`, generated from the built HTML.
- Fixed two real defects the audits caught: a `scrollable-region-focusable` axe failure on `/docs`, and a reveal runtime that stranded any `.reveal` taller than the viewport (the observer used a ratio threshold).

---

## 🔬 Latest Session — Website Rebuild, New Showreel & Published-Copy Contracts (2026-10-22)

A second pass over the same repository, dispatched through the **secretary**
skills: `content` (copy frameworks), `design` (the developer-vertical
anatomy), `animate` (motion), and `qa-launch` (the release gate). Five
findings that were not in the first audit are recorded below; the fixes are
all regression-tested.

### The copy rule

No user-facing surface may state a count of supported agents. The claim is
"the majority of coding agents" — a number would age badly and invite a
precision the registry cannot promise. The precise count stays in
`claims.json`, where it is a fact about the code rather than a promise about
the market. `test/published_copy_contracts.test.ts` enforces this across the
README, all three site pages, the nav, the footer, both asset generators and
the showreel composition.

### The website

- **Rebuilt on the design skill's developer anatomy**: hero → demo →
  architecture → code grid → proof → quickstart → licence, with copy on the
  content skill's AIDA spine and PAS driving the problem block.
- **New design-token system** (`src/styles/global.css`): fluid `clamp()`
  spacing and type scales, logical properties throughout, and no fixed
  values in components. Every container is width-bounded and grid children
  carry `min-width: 0`, so nothing can break out of the viewport.
- **New graphic assets**: a 12-icon line set (`src/assets/icons/`, all on a
  24px grid, measured to a 14–21px optical band) and three inline-SVG
  figures — a latency chart, a lifecycle state machine and an architecture
  topology — each bound to `claims.json` so no figure can drift from the code.
- **A new showreel**, written from scratch: a 12-second "memory lattice"
  film with an AIDA script, rendered deterministically from
  `apps/website/showreel/index.html` by a Playwright + ffmpeg pipeline. The
  previous HyperFrames composition and its private font copy are gone; the
  fonts now live at `src/assets/fonts/` and are shared with the brand
  pipeline.
- **The published latency bounds now live in one place** — `claims.json` →
  `latency` — and both the hero stats and the latency chart read them, so
  the page cannot quote two different numbers for the same path.

### Defects the QA gate found (all fixed)

- **The page read blank without JavaScript (P0)**: all 43 `.reveal` elements
  ship at `opacity: 0` and rely on an `IntersectionObserver`. A `<noscript>`
  fallback in `Base.astro` now restores the static document.
- **The mobile menu overflowed the viewport (P1)**: `.nav-actions` is a flex
  row without `justify-content`, so the group packed to the start and the
  absolutely-positioned sheet anchored off the left edge (`x = -73`).
- **The copy button's fallback hint said "Press ⌘C" on every platform (P1)**.
- **A `<p>` inside a `<dl>`'s wrapper div (P1)** — an axe-core
  `definition-list` violation on the metric grid.
- **Two animated elements combined `filter: blur()` with a transform
  animation (P2)** — a per-frame re-rasterisation of the blur. The softness
  now comes from the gradient stops, so the motion stays on the compositor.

### The gate itself is executable

`apps/website/scripts/qa-gate.ts` runs the qa-launch gate checklist as
code — critical paths, the keyboard-only path, 200% zoom reflow, the
no-JavaScript first frame, animation performance, a placeholder/debug
sweep, the payload budget, and a second rendering engine. It exits non-zero
on any blocking failure, so CI runs it. Report:
`.agents/artifacts/qa-gate-2026-10-22.md` — **16/16, SHIP**.

---

## ⏭️ Next Up (Post-Wave 24 Focus)
- **Production-Grade Showcase Demo**: Re-record high-fidelity terminal demo video/GIF reflecting v3.0.0 capabilities (failure attribution, HOT.md compounding, memory branch/checkout, MCP context recall) to replace removed legacy demo.
- **Wave 24 remainder**: `T-316` (Hebbian co-activation edges into write-time `linked_memory_ids` seeding — **unblocked**, dep `T-095` landed; note the ticket premise is partly stale: `T-307` already landed the retrieval-expansion side) and `T-318` (retrieval weight auto-tuner from ROI telemetry — **unblocked**, deps `T-127` + `T-140` both landed). `T-317` (query-seeded PPR restart set) stays **blocked** on `T-178` (graph retrieval A/B gate).
- **Conflicted memories are still served into agent prompts** (found while fixing `T-320`): `src/retrieval.ts` filters `superseded`/`rejected`/`archived`/`expired` but not `conflicted`, so a genuinely contradicted memory is injected with no badge. Deliberately left out of `T-320` — it changes retrieval output and therefore the golden recall fixtures; it needs its own ticket and test pass.
- **Consolidate the remaining duplicated tables** (deferred from this session as behaviour-changing; full detail with exact locations in [`docs/roadmap.md`](../../docs/roadmap.md) → *Engineering debt*): the three divergent per-type TTL tables in `src/retention.ts`, the eight separate token estimators, the divergent limit-clamping ceilings across retrieval paths, and the remaining zero-caller exports.
- **Remove the legacy `web/` directory** — done in this session. It was a second, hand-written copy of the site that `apps/website/` superseded; keeping it was the same "second copy that gets forgotten" failure mode this session fixed everywhere else.

---

## 🏁 Recently Landed Waves (Verified on `dev`)
- [x] **Wave 24: Per-Project Health Gate Scope**:
  - `T-321`: The health gate, the bug-clustering scanner and the technical-debt scanner all read the whole store, and the report was then labelled with `entries[0].project` — whichever memory happened to sort first. A number covering every project was presented as one project's health, and there was no way to ask for a single project's health at all. `listForProject()` (`src/store.ts`) is now the single owner of the "filter by project, or take the whole store" decision; the gate, the anchor audit, the drift audit, bug clustering and technical debt all take the same `project` option. The report carries a `scope` object (`filter`, `projects`, `entry_count`, `code_scope`), and its `project` label is the requested filter, the sole project present, or `all` — never a guess. Code-side metrics deliberately stay workspace-wide: source code is shared between projects and cannot be attributed to one. Surfaces: `memory health --project P`, a `project` argument on `muse_health`/`muse_tech_debt`/`muse_bug_clusters`, and `?project=` on the studio's `/api/health` (`test/health_project_scope.test.ts`, 9 cases, commits `60b1aa2`, `27bdc81`).
- [x] **Wave 23: Contradiction Engine Calibration**:
  - `T-320`: The contradiction engine compared two memories by testing seven bare regex pairs against their concatenated title and content, so any two memories containing an "enable"-ish and a "disable"-ish word were flagged as contradictory regardless of subject or context. Measured: **8 of 10** realistic non-contradictory pairs were flagged. Flagging flips *both* memories to `conflicted` — 25 health points each (four false positives fail the store-integrity pillar), removal from every future sync broadcast, and still served into agent prompts. Detection now extracts **polarity claims** (`subject`, `relation`, `target`, `scope`) and opposes claims only about the same subject in a compatible scope; re-probe of the same ten pairs: **0 of 10** flagged. New `src/quality/scope.ts` (canonical scope vocabulary, general qualifier extraction, strong/weak scope classification) and `src/quality/polarity.ts` (claim extraction + comparison); scope is now resolved per claim instead of per entry in `src/quality/invalidation.ts`. Dry-run surfaces: `memory conflicts [--dry-run]` (new CLI, read-only preview of what peer-to-peer sync would flag — the one path that flags automatically), `propose({ checkConflict: true, conflictDryRun: true })`, and `detectConflict(store, candidate, { dryRun: true })`. Calibration fixture `test/calibration/contradiction_calibration.json` (21 labelled pairs) gated at precision and recall ≥ 0.9 (`test/contradiction_calibration.test.ts`, `test/cli_conflicts.test.ts`, commits `18bf4f9`, `dc90539`).
- [x] **Wave 22: Failure Attribution, Negative Memory Mining & Retrieval Compounding**:
  - `T-313`: Scoped failure attribution matching code anchors (`file_path`, `symbol_name`), affected paths, and reproduction commands; session-deduplicated strikes (max 1/session); dual-decay strike counter (2 clean runs or 30 days without failure); constitutional immunity protecting constraints, timeless memories, and salience $\ge 0.95$ from auto-dispute (`test/failure_attribution.test.ts`, commit `41feec4`, `3b270b5`).
  - `T-144`: Trajectory fix-pair mining discovering negative memories (`AVOID: ...`) from *Error ➔ Remediation ➔ No Recurrence* observation sequences with affinity filters excluding non-mutating commands (`ls`, `cat`), dynamic line number normalization, Vibeguard secret scrubbing, and session volume cap of max 3 candidates (`test/fix_pair_mining.test.ts`, commit `cc4b5c5`).
  - `T-314`: Source-tagged recall hits wiring `.memory/HOT.md` candidates into retrieval ranking with sub-millisecond memoized `mtime` cache, origin tagging (`source_channels: ("hot" | "fts" | "vector" | "tree" | "distilled")[]`), relevance-gated `sourceBonus` (+0.20), and explainability tokens (`source:hot`, `source:fts`) (`test/source_tagging_frequency.test.ts`, commit `f9f6a93`).
  - `T-315`: LangMem logarithmic frequency rank curve ($0.25 \times \frac{\ln(1 + \text{effectiveCount})}{\ln(1 + 50)}$) replacing unbounded linear frequency scoring; weights verified memory applications $2\times$ over passive context loads; 7-day recency bonus (+0.05) capped at 0.30; outputs `freq:high` tokens (`test/source_tagging_frequency.test.ts`, commit `f3c8f1d`).
- [x] **Wave 21: LifeOS Distillation, Mutation Safety & Knowledge Routing**:
  - `T-050`: Overnight & in-lock mutation safety guards (`verifyMutationSafety`, `MutationSafetyError`, `ESUSPECT_SHRINK`, `ESUSPECT_EROSION`, `allowDrastic`) preventing accidental bulk erasure or semantic erosion during compaction/governance (`test/mutation_guards.test.ts`, commit `439e31c`).
  - `T-177`: Pre-mutation 30-snapshot rolling ring buffer (`captureSnapshotRing`, `listSnapshotRing`, `restoreSnapshotRing`) with zero resident daemons in `.memory/snapshots/` before write transactions and compaction handoffs (`test/snapshot_ring.test.ts`, commit `76c58eb`).
  - `T-324`: Diff-preserving `CURRENT.md` checkpoint merge semantics (`parseCurrentConstraints`, `mergeCurrentConstraints`), preventing mid-session hand-added constraints from being overwritten (`test/current_compaction_guard.test.ts`, commit `f1a4756`).
  - Multi-Channel Distillation Router: Distills verified memories across `system` (rules/fixes), `content` (architecture concepts), and `health` (contradictions/staleness) lanes with SHA-256 state deduplication (`.memory/distill_state.json`) and draft generation (`.agents/drafts/`), exposed via `distill-route` CLI and `memory_distill_route` MCP tool (`test/distill_router.test.ts`, `test/mcp_distill_route.test.ts`, commits `c6badf1`, `e634bdb`).
- [x] **Wave 20: Quality Telemetry, Honesty Gates & Retrieval Fault Signals**:
  - `T-127`: Recall→usage telemetry join (`usage_rate` feeds ROI) (PR #291, Closes #290)
  - `T-128`: `[DRAFT]` marking with separate confident-answer key (PR #293, Closes #292)
  - `T-129`: Config-honesty AST audit (`auditConfigHonesty`, WIRED/DORMANT/UNREAD, build-failing) (PR #295, Closes #294)
  - `T-130`: Storage-version compat tests in CI matrix (`test/storage_version_compat.test.ts`, `schema_versions.json`) (PR #297, Closes #296)
  - `T-131`: Honest benchmark labels (measured-vs-claimed) on all published numbers (PR #299, Closes #298)
  - `T-132`: Constitution contract: rules injected first, trim-exempt, no write tool (PR #301, Closes #300)
  - `T-133`: `degraded − notes` fault signal (`degraded_notes`, `formatDegradedFaultNotice`) (PR #303, Closes #302)
  - `T-134`: Ground-moved reporting for anchors (silent when undeterminable) (PR #305, Closes #304)
  - `T-135`: Tiered retrieval ladder labeling loosened matches (`executeRetrievalLadder`, `formatLoosenedBadge`) (PR #307, Closes #306)
- [x] **Wave 19: Scoring Refinements & Abstract Sidecars**:
  - `T-118`: Query-intent bias multipliers (`detectQueryIntent`, `computeIntentMultiplier`, `taskIntent`) (PR #274, Closes #273)
  - `T-119`: `effective_score = base × reinforcement × decay` with utility reinforcement boosts and floor limits (PR #276, Closes #275)
  - `T-120`: Reciprocal Rank Fusion (RRF) weight tuning + A/B variant presets (control/A vs treatment/B) (PR #278, Closes #277)
  - `T-121`: Typed drop/keep reasons per candidate with granular audit tokens (PR #280, Closes #279)
  - `T-122`: Clean-room MIT L0 (<=120 chars) and structured L1 abstract sidecars with disk and SQLite caching (PR #282, Closes #281)
  - `T-123`: Ratio-batched sidecar refresh (`getSidecarStaleness`, `refreshSidecarsRatioBatched`) (PR #284, Closes #283)
  - `T-124`: Resident INDEX route-map in orchestrator (`buildResidentRouteMap`, `matchResidentRoutes`, `INDEX.json`) (PR #286, Closes #285)
  - `T-125`: Tier budgets as named constants with provenance (`TIER_BUDGET_PROVENANCE`, `resolveTierBudget`) (PR #288, Closes #287)
- [x] **Wave 18: Ingestion, Suppression & Curation Gates**:
  - `T-106`: Curator concept: agent appends empirical evidence/application outcomes, deterministic promotion decides records (PR #256, Closes #255)
  - `T-107`: Two-tier promotion staging (`pending_promotions.json`) and session-end atomic flush (`memory_flush_pending`) (PR #258, Closes #257)
  - `T-108`: Re-injection suppression per session with 6-turn LRU window and constraint/timeless exemptions (PR #260, Closes #259)
  - `T-109`: Self-echo suppression via capture-side provenance within 10-minute horizon (PR #262, Closes #261)
  - `T-110`: `<memory-context>` and injected block sanitization before propose and harvest (PR #264, Closes #263)
  - `T-111`: Seen-chunk TTL suppression in retrieval with 5-minute window and chunk key tracking (PR #266, Closes #265)
  - `T-112`: Topic-overlap >0.6 prefetch skip in retrieval caching context packs on consecutive queries (PR #268, Closes #267)
  - `T-113`: Trivial-prompt gate bypassing recall on conversational greetings while preserving constraints (PR #270, Closes #269)
- [x] **Wave 17: Packing, Graph, Lineage & Provenance**:
  - `T-095`: `linked_memory_ids` write-time graph edges auto-seeded during capture and indexed in SQLite (PR #239, Closes #238)
  - `T-096`: HyAtlas supersede-not-delete lifecycle marking `valid_to`/`valid_to_exact` with hidden-count-aware over-fetching (PR #241, Closes #240)
  - `T-097`: `prefer_observations` recall-time dedup scoped to top-2×budget candidate window with Jaccard threshold $\ge 0.65$ and $+0.10$ veracity boost (PR #243, Closes #242)
  - `T-098`: Progressive multi-hop wikilink expansion after reciprocal rank fusion (`extractWikilinks`, `expandFusedWikilinks`) with token budget bounds (PR #245, Closes #244)
  - `T-099`: Semantic `fact_provenance` append-only SQLite table with triple-unique index `(entity, relation, target)` (PR #247, Closes #246)
  - `T-100`: First-class lineage foreign keys `supersedes_id` and `conflicts_with_id` in SQLite schema and indexing (PR #249, Closes #248)
  - `T-101`: Lineage BFS DAG walker (`walkLineageBfs`) traversing ancestors, descendants, conflicts, and links with cycle prevention (PR #251, Closes #250)
  - `T-102`: Tamper-evident cryptographic hash-chained audit ledger with per-day salt rotation (`audit_salts.json`) and session Merkle checkpoints (`createSessionMerkleCheckpoint`) (PR #253, Closes #252)
- [x] **Wave 16: Temporal Transitions, Contradiction Engine & Verbs**:
  - `T-082`: `valid_to_exact` flag on transitions stamping exact historical cessation boundaries vs runtime transitions (PR #219, Closes #218)
  - `T-083`: `as_of` queries returning `{results, undetermined}` without date invention (PR #221, Closes #220)
  - `T-084`: Five-verb lifecycle (`change`, `end`, `correct`, `revert`, `forget` with GDPR hard/soft tombstones) and typed audit logging (PR #223, Closes #222)
  - `T-085`: `searchTemporal(atTime)` default-excluding superseded knowledge while returning undetermined boundary candidates (PR #225, Closes #224)
  - `T-086`: Keep-both `conflicts` SQLite table (Migration v6) preserving contradictions without deletion (PR #227, Closes #226)
  - `T-087`: Scoped invalidation requiring semantic `(entity, relation, target, scope)` alignment to eliminate Graphiti #1728 false-positive conflicts across environments (PR #229, Closes #228)
  - `T-088`: Federation handshake protocol for mesh-mode conflict deduplication and resolution propagation (`supersede`, `keep_both`, `historical`, `reject`) (PR #231, Closes #230)
  - `T-089`: Provenance veracity rank weighting (`user` 1.0, `agent` 0.7, `external` 0.5, `system` 0.3) with tie-breaker bonuses and `minVeracity` filtering (PR #233, Closes #232)
  - `T-090`: `src_ts` evidence-age stamping (Migration v7) ensuring memory freshness cannot exceed underlying source document age (PR #235, Closes #234)
- [x] **Wave 15: Expiry, Decay & Confidence Hardening**:
  - `T-072`: Tokenizer-matched abstention gate (`evaluateAbstentionGate`) matching FTS5 Unicode61 boundary rules (PR #200, Closes #199)
  - `T-073`: `no_confident_match` result mode across `queryContext`, `formatPromptContext`, and MCP `get_context`/`search` (PR #202, Closes #201)
  - `T-074`: Materialized `decay_score` in SQLite memories table with importance-gated half-life scaling (0.4x to 3.0x) (PR #204, Closes #203)
  - `T-076`: Bayesian corroboration confidence $C(n) = 1 - 0.7^n$ scaling from initial observation to asymptotic certainty (PR #206, Closes #205)
  - `T-077`: Trust-tier-keyed half-life (T1 365d → T4 30d) defending against OWASP ASI06 memory poisoning (PR #208, Closes #207)
  - `T-078`: Per-type admission `expires_at` defaults (fix 90d, op 180d, arch 365d, disc 30d, pref/constraint null) with pin exemptions (PR #210, Closes #209)
  - `T-079`: Stamped `status: 'expired'`, `expired_at` timestamp, and `expired_by` rule tracking with pin-protected sweeps (PR #212, Closes #211)
  - `T-080`: Pin-capable first-match-wins declarative expiry policy YAML engine (`.memory/expiry.yaml`) in store admission and sweeps (PR #214, Closes #213)
  - `T-081`: Optional Weibull per-type decay curves $R(t) = \exp(-(t/\lambda)^k)$ preserving $R(t_{1/2}) = 0.5$ invariant across all shape $k$ values (PR #216, Closes #215)
- [x] **Wave 14: Invalidation, Attribution & Ranking Rigor**:
  - `T-302`: `memory_capture` full propose options passthrough (evidence, source, verification, dedup, valid_from/to, due_at, expires_at, salience, trust, mem_path, idempotency_key, source_ids) (PR #188, Closes #187)
  - `T-304`: Incremental vector index synchronization on `save()` (`upsertIndexEntry`) and `deleteEntry()` (`removeIndexEntry`) (PR #190, Closes #189)
  - `T-307`: Bounded Hebbian plasticity co-activation (8 seeds, 30 edges/node, 500 nodes max), atomic `.tmp` swap, candidate expansion in retrieval (PR #192, Closes #191)
  - `T-309`: IDF-weighted symbol matching downweighting generic verbs (`get`, `set`) to 0.05 and rewarding distinctive compound identifiers (`SessionManager`, `auth_token`) with 1.0 (PR #194, Closes #193)
  - `T-310`: Word-boundary token matching (`matchesWordBoundary`) preventing substring false positives (`race⊂trace`, `port⊂report`, `lock⊂deadlock`) (PR #196, Closes #195)
  - `T-312`: FTS failure degraded signal distinguishing genuine zero-match from SQLite execution errors with loud `[FTS5_DEGRADED]` logging (PR #198, Closes #197)
- [x] **Wave 13: Retrieval Performance & Store Hot-Paths**:
  - `T-021`: Memoized runtime file verification in ranking hot path (PR #172, Closes #171)
  - `T-022`: Precomputed token sets per memory to drop per-query retokenization (PR #174, Closes #173)
  - `T-023`: `openStore` dirty-gate with SQLite fingerprinting to skip redundant wiki recompiles & CURRENT.md sync (PR #176, Closes #175)
  - `T-028`: `recordRetrievals` wiring into `get_context` deferred writes & `memory_recall` (PR #178, Closes #177)
  - `T-029`: `touchActivity` wiring into `save()` with 1-second throttling (PR #180, Closes #179)
  - `T-062`: Clamp model-supplied `limit` values across all retrieval engines and MCP handlers (PR #182, Closes #181)
  - `T-063`: Dry-run-by-default and point-ID-only validation for destructive ops (PR #184, Closes #183)
  - `T-064`: Read-path `stale: true` and `from_cache: boolean` provenance tags for degraded reads (PR #186, Closes #185)
- [x] **Wave 12: Daemon Reliability, Upgrade Signals & Living Decisions**:
  - `T-345`: Daemon server.on("error") collision handling, /publish origin validation, active socket disposal on close (PR #156, Closes #155)
  - `T-346`: Upgrade CLI exit codes with --check registry error truthfulness, --fail-on-update, and --strict (PR #158, Closes #157)
  - `T-350`: Drift endpoint symlink throwIfNoEntry guard, precomputed lowercase corpus, and pure read path (PR #160, Closes #159)
  - `T-352`: ADR status mapping (rejected -> stale, proposed -> candidate) and save-before-supersede atomicity (PR #162, Closes #161)
  - `T-356`: PageIndex search maxDepth node pruning and 3-tier disclosureDepth (L1/L2/L3) (PR #164, Closes #163)
  - `T-358`: Daemon port integer validation (0-65535) and SIGINT/SIGTERM graceful socket shutdown (PR #166, Closes #165)
  - `T-359`: Upgrade audit honesty (scanSecrets in Vibeguard step, distinct agent wiring, RepairResult.errors) (PR #168, Closes #167)
  - `T-365`: Anchor base normalization at write time and unified multi-root path resolution in drift and mesh contracts (PR #170, Closes #169)
- [x] **Wave 0: Pre-Flight Integrity & Baseline Fixes**: `T-402`, `T-403`, `T-404`, `T-401`, `T-370`.
- [x] **Wave 1: Storage Engine, Outbox & Concurrency**: `T-041`, `T-042`, `T-044`, `T-038`, `T-039`, `T-040`, `T-055`, `T-056`.
- [x] **Wave 2: Write Admission, Trust & Anti-Poisoning**: `T-104` (scoreRetain 0.3 gate), `T-075` (trust tiers + withholding), `T-058`/`T-059` (read-path re-validation), `T-103` (FTS index-time secret redaction), `T-105`/`T-105b` (corroboration & syntax promotion gates), `T-391` (citation validation against live registry).
- [x] **Wave 3: Retrieval Quality, Ranking & Token Economics**: `T-035` (iterative safeMax/safeMin scale safety), `T-036` (in-memory IDF caching via WeakMap), `T-037` (drop redundant full-list scans via countMemories), `T-060` (safe FTS5 query token escaping), `T-061` (compound-token expansion), `T-070` (IDF-weighted relevance gate 0.3), `T-114` (Soft-OR evidence fusion formula), `T-115` (low_discrimination conditional reranking), `T-117` (watermark staleness tracking), `T-126` (deterministic why_retrieved reason tokens), and priority knapsack packing for negative anti-pattern lessons.
- [x] **Wave 4: Compaction, Ephemeral Observations & Distillation**: `T-305` (distillation body cap 1500 chars), `T-306` (atomic write + rotation + 256KB size cap for observations), `T-045` (`on_pre_compress` hook + `extractInvariantsPreCompress`), `T-047` (never-empty checkpoint contract), `T-046` (persisted SHA-256 digest dedup store), `T-053` (honest dual-measure token accounting), `T-054` (refuse-incomplete digest contract), `T-091` (compact context-pack formatter), `T-092` (never-drop context manifest TOC), `T-093` (truncation hierarchy with `[N omitted — budget M]`), `T-094` (reserved slots for USER.md profile).
- [x] **Wave 5: Security Hardening & UI Protection**: `T-002`/`T-003` (UI XSS escaping for `p.title`, `p.slug`, `r.entry_id`, `r.actor`, checkpoints, and details), `T-004` (UI optimizer gate dry-run default + localhost/token check), `T-380` (unit test suite for `escapeHtml`), `T-388` (Hook SessionStart `<muse-memory>` block sanitization), `T-389` (`recordObservation` metadata JSON credential scanning), `T-399` (routine step allowlist, flag rejection, and depth > 5 re-entrancy recursion guard), `T-400` (UI read routes `/api/memories` and `/api/snapshot` projection allowlist).
- [x] **Wave 6: Semantic Embeddings & Eval Harness**: `T-381` (llama-cpp wire protocol embeddings spike), `T-071` (dual calibrated thresholds: `SEMANTIC_COSINE_MIN_THRESHOLD = 0.30`, `BM25_MIN_THRESHOLD = 0.25`), `T-136` (engine fingerprint pinning `model|dims|endpoint`), `T-137` (FTS5-floor / vector-upgrade degradation path), `T-138` (in-process brute-force cosine over SQLite `BLOB` raw floats), `T-139` (`stale_embedder` stamp on reindex misses and doctor reporting), `T-140` (recall-set grading: must-return, distractor discrimination, abstention, noise-as-failure), `T-141` (frozen benchmark corpus drift discipline), `T-142` (p50/p95/p99 latency reporting beside recall scores), `T-143` (fixture promotion requires usage telemetry).
- [x] **Wave 7: Team Slice (On-Demand / Opt-In)**: `T-150` (MCP Streamable HTTP transport 2025-06-18 spec, PR #84, Closes #83), `T-151` (Origin validation + session ID + protocol version headers, PR #86, Closes #85), `T-386` (Bearer token auth with per-peer allowlist, PR #88, Closes #87), `T-153` (Multi-DB topology: shared team store `team.db` + per-member local DBs, PR #90, Closes #89), `T-387` (Member wiring docs, client config recipes, and shared vs personal scoping policy, PR #92, Closes #91).
- [x] **Wave 8: Residual Surfaces Audit**: `T-392` (Embedder URL SSRF & metadata IP validator, PR #94, Closes #93), `T-393` (Claims & provenance array/metadata secret scan gaps, PR #96, Closes #95), `T-394` (Enforce decorative settings `mcp.enabledTools` allowlist & `imports.secretScanEnabled`, PR #98, Closes #97), `T-395` (Upgrade failure signal in `playPandaLoader` and non-zero exit, PR #100, Closes #99), `T-396` (`healBunGlobalConfig` safety, `.bak` backup, error surfacing, and opt-in gate, PR #102, Closes #101), `T-397` (`getLatestNpmVersion` command injection defense with `execFileSync`, PR #104, Closes #103), `T-398` (`memory_harvest` schema and handler alignment with validation error on missing text, PR #106, Closes #105).
- [x] **Wave 9: Runtime Integrity, Seams & Drift Elimination**:
  - `T-010`: Align profile tool definitions with live registered MCP tools (PR #112, Closes #111)
  - `T-011`: Align ALL_MEMORY_TOOLS with live registered MCP tools (PR #114, Closes #113)
  - `T-012`: Delete dead zero-caller `maybeAutoOptimize` (PR #116, Closes #115)
  - `T-364`: Unique-ID seam collision prevention with crypto.randomUUID in ADRs & PageIndex (PR #118, Closes #117)
  - `T-341`: Enforce dryRun in upgrade repairInstallation (PR #120, Closes #119)
  - `T-343`: Guard against malformed Host header crashes with HTTP 400 (PR #122, Closes #121)
  - `T-344`: Reject Origin: null in CORS and CSRF defense (PR #124, Closes #123)
  - `T-361`: Sanitize priority badge class & escape item.priority in remediation UI (PR #126, Closes #125)
- [x] **Wave 10: CLI Rigor, Governance & Hardened Parsers**:
  - `T-013`: Formally retire unreachable LSP tier while keeping provider slot in chain signature (PR #128, Closes #127)
  - `T-014`: Delete dead registry methods, registerProvider, and unused governor exports (PR #130, Closes #129)
  - `T-347`: UI Port contract validation & auto-increment on collision when port omitted (PR #132, Closes #131)
  - `T-353`: Wiki frontmatter YAML scalar escaping via JSON.stringify (PR #134, Closes #133)
  - `T-354`: CLI argument parsing hardening (POSIX `--` terminator, split on first `=`, negative values) (PR #136, Closes #135)
  - `T-360`: Clean Web Studio keep-alive socket destruction & numeric parameter clamping (PR #138, Closes #137)
- [x] **Wave 11: Migrator Quarantine, Anti-Poisoning & Validation Hardening**:
  - `T-366`: Intake schema validation, candidate quarantine, and strip self-certified verification (PR #140, Closes #139)
  - `T-338`: Strip unearned verification level from external agentmemory records (PR #142, Closes #141)
  - `T-339`: Prevent Letta core memory (human/persona) prompt injection into CURRENT.md (PR #144, Closes #143)
  - `T-340`: Generic adapter intake sanitization (reject package.json/configs, bound document size, no loose Object.values) (PR #146, Closes #145)
  - `T-348`: Path fallback expansion and empty directory defense to enable truthful skipped status (PR #148, Closes #147)
  - `T-349`: Track deduplication metrics and enforce within-batch dedup in dry runs (PR #150, Closes #149)
  - `T-357`: Memory status validation and normalizeMemoryStatus (default omitted isLatest to candidate) (PR #152, Closes #151)
  - `T-362`: Remove dead global config and tighten normalizeMemoryType against loose op substring (PR #154, Closes #153)
- [x] **Team Onboarding & Documentation**: `docs(team)` Dedicated team getting started guide in `docs/team-getting-started.md` and README team setup section (PR #108, Closes #107).
- [x] **User Documentation Suite**: `docs(user)` Core Concepts (`docs/concepts.md` via ACCA) and Developer Daily User Guide (`docs/user-guide.md` via QUEST) with README documentation hub (PR #110, Closes #109).
- **Full Roadmap**: `.agents/context/roadmap.md` and detailed audit report `.agents/artifacts/audit-and-realigned-roadmap-20261015.md`.

---

## 🚀 Shipped Capabilities

1. **Dual-Scope Cognitive Engine**: Project-local `.memory/` and global `~/.memory/`.
2. **Deterministic Lifecycle Machine**: Propose → Candidate → Confirm → Supersede → Stale → Delete.
3. **Model Context Protocol (MCP)**: Native stdio server implementing MCP 2024-11-05.
4. **Universal Agent Detection**: Auto-detects and connects 80+ coding agent platforms.
5. **Universal Migrator**: Imports memories from 24+ external formats (AgentMemory, Mem0, Letta, etc.).
6. **Vibeguard Secret Defense**: Built-in regex scanner preventing credential commits to memory.
7. **Compounding & Rollups**: Temporal rollups and token-bag centroid clustering.
8. **In-Process L0 Hot Memory Cache & L1 Context Cache**: Sub-50 microsecond entry lookups, O(1) query caching, and mtime-synchronized dual persistence.
9. **SQLite FTS5 BM25 Engine**: Integrated full-text search virtual tables with sub-2ms lexical search.
10. **Memory Quality & Deduplication**: Deterministic SHA-256 content fingerprinting, canonical memory consolidation with supporting evidence arrays, and temporal mode inference (`current`, `historical`, `timeless`).
11. **Contradiction Engine**: Semantic conflict detection, first-class `conflicted` state machine with mutual `conflict_ids`, and multi-strategy resolution (`supersede`, `historical`, `reject`, `keep_both`).
12. **Utility Tracking & Memory ROI**: Operational feedback loop tracking `application_count`, `successful_applications`, `regressions`, `reuse_success_rate`, and automated dispute escalation.
13. **Ephemeral Observation Tier**: Structured append-only event logging in `.memory/observations.jsonl` from tool results, test outputs, build errors, and review comments.
14. **First-Class Negative Memories**: Explicit capture of `DO_NOT_USE`, `FAILED_APPROACH`, and `BUG_PRONE_PATTERN` with reproduction commands and timeless salience.
15. **Autonomous Distillation & Outcome Feedback Loop**: Distills raw observation streams into candidate fixes/architecture, coupled with automatic session command evaluation and memory reinforcement.
16. **Pluggable Code Intelligence Architecture**: Pluggable provider registry with zero-crash fallback chain (CodeGraph → Graphify → LSP → Heuristic AST scanner → Safe Empty) and automated symbol evidence memory enrichment.
17. **Multi-Factor Ranking Engine**: 11-dimension scoring model combining exact symbol matching, path proximity, FTS5 BM25, graph overlap, blast radius, recency decay, utility ROI, negative warning boosts, and knapsack token budget packing.
18. **Context Compaction & Session Handoff Engine**: 70% context usage threshold detector, 5-invariant lockdown protocol, interruption-proof CURRENT.md checkpoint compilation, and continuous conversational knowledge harvesting.
19. **Scoped Promotion, Generalization & Archival Lifecycle Engine**: 3-tier scope ladder (`local` → `project` → `global`), 5× repeated success policy gate, structural generalization of project specifics into universal principles, and extended archival lifecycle (`active` → `cold` → `dormant` → `archived`) with dynamic query rehydration.
20. **Native Code Anchors & Stable Structural Code Identity**: First-class code anchors (`repository`, `file`, `module`, `symbol`, `route`, `test`), line-independent structural fingerprinting with comment/spacing normalization, and live drift/orphan verification (`valid`, `drifted`, `orphaned`) with repository audit scoring.
21. **Flagship Unified Context Orchestrator & Task-Focused MCP Profiles**: Flagship `muse_context` tool fusing active constraints, code anchors, ranked memories, and negative lessons under strict token budgets with suggested next actions; bidirectional code ↔ memory lookups (`muse_code_for_memory`, `muse_memory_for_code`); and 6 task-focused MCP profiles (`core`, `coding`, `debugging`, `review`, `architecture`, `maintenance`) preventing agent tool bloat.
22. **First-Class Architecture Decision Records (ADRs) & Bidirectional Drift Engine**: ADRs as living memory entities (`proposed`, `accepted`, `superseded`, `rejected`) with native code anchors and supersession lineage; bidirectional documentation ↔ code drift engine classifying alignment (`DOCUMENTED`, `IMPLEMENTED`, `PARTIAL`, `CONFLICTING`, `STALE`, `MISSING`) and scoring repository health.
23. **Autonomous Engineering Cognition & "Why" Reasoner**: Historical "Why" explanation engine synthesizing ADRs, bug fixes, trade-offs, and invariants; recurring bug and fragility clustering across 5 root causes; and technical debt scanner detecting TODOs/FIXMEs, `as any` type bypasses, and drifted anchors.
24. **Unified 5-Pillar Project Health Gate (`muse_health`)**: Comprehensive architectural health evaluation auditing store integrity, native code anchors, doc/code alignment, anti-pattern sentry, and technical debt; computes composite grade (A-F), gate status (PASS/WARN/FAIL), prioritized remediation checklist, and CLI dashboard.
25. **Cross-Agent Knowledge Sync & P2P Gossip Protocol (R14)**: Portable sealed `SyncPacket` with SHA-256 integrity, vector clock causal ordering, bidirectional shared pool drop-directory gossip exchange, deduplication, Vibeguard secret scrubbing, and semantic contradiction tagging with mutual `conflict_ids`.
26. **Full Web Observability Studio & Interactive Visual Dashboard (R15)**: Integrated web studio served over local HTTP (`memory studio`), featuring a 5-pillar health scorecard, overall letter grade, prioritized remediation action checklist, ADR registry with code-to-doc drift inspector, autonomous "Why" reasoner, bug friction clusters heatmap, debt hotspots, and live P2P mesh topology visualizer.
27. **Multi-Repo & Monorepo Cross-Project Mesh (R16)**: Automatic workspace detection across pnpm, npm, bun, lerna, and multi-repo sibling groups; cross-project memory querying with origin package provenance; cross-package contract and entrypoint export auditing; explicit mesh linking (`mesh_links.json`); and shared invariant propagation across the entire mesh.
28. **Unified Code & Memory Impact Analysis**: Pre-flight blast radius analysis evaluating AST callers, test suites, governing ADRs, negative warnings, and risk levels (`memory code-impact` / `muse_code_impact`).
29. **PR & Change Context Generator**: Automatically turns git diffs into rich, memory-grounded GitHub PR descriptions linking touched anchors and active constraints (`memory pr-context` / `muse_pr_context`).
30. **Interactive Code Anchor Reconciler**: Audits and repairs code anchors across memories, pruning dead references and updating structural hashes (`memory reconcile` / `muse_reconcile_anchors`).
31. **Latency & Quality Telemetry Suite**: Benchmarks microsecond hot caches, FTS5 BM25 search, knapsack token packing, and ROI in a clean ASCII scoreboard (`memory benchmark`).
32. **Linus-Style Architectural Hardening (v2.2.1, completed by T-001 #58 + T-363 #59)**: template-gated command execution (no shell — memory selects which test file, never what code) replacing the earlier `execFileSync` claim, `resolveWithin`/`resolveExternal` path containment, concurrency-safe `PRAGMA busy_timeout = 5000` on SQLite WAL mode, O(N) stat storm elimination in `list(store)`, structured warnings on YAML dual-write failures, tightened word-boundary/code-anchor ADR matching, and harness-independent hook install (`.agents/` default, `--harness` opt-in). **Verification oracle templates** (`src/verify.ts: checkTemplate`) — only three shapes run: `bun test <relative *.test.ts|*.spec.js>` (must resolve in-root), `bunx tsc --noEmit` (verbatim), `node --check <relative path>`; `-e`/`--eval`-style flags, non-test script paths and bare binaries are refused, nothing executes, and the refusal is audit-logged as `verify_refused`. **Path containment** — `resolveWithin` guards wiki/pageindex-family paths (strict containment: no absolute segments, no `..` escape), `resolveExternal` is the deliberate opt-out for intentionally-external pool/mesh directories, and PageIndex `indexId` must be a bare filename.
33. **Autonomous Memory Optimizer & Auto-Cadence Engine (v2.3.0)**: Multi-factor noise and junk pruning engine with zero-daemon auto-cadence (every 7 days or after 48h idle), SQLite WAL defragmentation (`VACUUM;` + `PRAGMA optimize;`), CLI command `memory optimize`, and dashboard "⚡ Optimize" button.
34. **Concurrent Multi-Agent Workstream Tracking & Clean `CURRENT.md` (v2.3.0)**: Live `AgentWorkstream` tracking table in `CURRENT.md` enabling multi-agent swarms across separate chat sessions to coordinate active tasks and target scopes; injected into prompt context (`formatPromptContext`, `resolveMuseContext`); sanitized single-pane executive summary for humans with strict grounding rules for agents.
35. **Write-Time Citation Verification (v2.3.1, GAP-1)**: Kage-pattern trust gate — every code anchor is verified against the live filesystem before a memory write is admitted. Hallucinated citations (file/symbol does not exist) reject the write under the default `fail_fast` policy; drift is flagged and stamped; all decisions audited (`src/anchors/verify-write.ts`, enforced in `attachAnchorToMemory` + `memory_anchor_create` MCP tool).
36. **Recall-Time Freshness Gate (v2.3.1, GAP-3)**: Memories whose anchors drifted or whose cited files/symbols no longer exist are **withheld from `muse_context` by default** and reported via `withheld_memories` + `freshness_notice` (never silently served). Opt-in `include_drifted: true` returns them with `⚠ FRESHNESS` provenance warnings. Per-`(path, symbol, mtime)` memoized verdicts keep recall sub-ms (`src/orchestrator/freshness.ts`).  37. **Claude Code Lifecycle Hook Pack (v2.3.1, GAP-2)**: Hands-free memory — `SessionStart` injects constraints + top-5 memories before the agent's first turn, `PostToolUse` captures Vibeguard-scanned observations, `Stop` distills the session into candidate memories. Installed via `memory hooks install` or `memory connect --with-hooks`; idempotent, preserves user hooks, every handler fail-open (`src/hooks/pack.ts`).
  38. **Professional Website Copy Pass (v2.3.1)**: Full content-mode rewrite of `apps/website` — AIDA-structured landing copy anchored to a developer reader with one primary action (`npx musememory connect`); FAQPage + SoftwareApplication JSON-LD for AEO; anti-puffery scrub (all claims verifiable: sub-2ms, <50µs, 80+, 24+, 69 tools, 527 tests, 0 daemons); corrected stale 498/86 stats; fixed `BASE_URL` link bug (`/musememorydocs` missing slash) site-wide and duplicated OG meta in Base.astro; compare page heading hierarchy fixed (h2→h1). Second pass fixed real defects found by a new responsive visual audit (`scripts/audit-visual.ts`, 375/768/1280 × 3 pages): motion runtime was silently dead (`initMotion` returned `<style>+<script>` markup nested inside the layout's `<script>` — now returns raw JS only; `.reveal` opacity CSS lives solely in global.css, so no-JS users see all content); docs grid overflow fixed (`.docs-body { min-width: 0 }`); decorative orbs hidden ≤640px + `html { overflow-x: clip }`; prose links underlined (WCAG 1.4.1, caught once audit server served real /docs + /compare instead of the 404 page — both audit servers now resolve directory paths GitHub-Pages style). Gate: 4-page build + WCAG 2.2 AA audit (24/24 pairs, axe clean on all 4 pages) + visual review 9/9 viewports + 527 tests + tsc clean. CI showreel hash reseeded (`public/brand/.showreel-hash`).
  39. **HyperFrames Showreel (v2.3.1)**: The showreel is a motion-designed composition, not a screen capture — `apps/website/showreel-hf/index.html` (HyperFrames: HTML/CSS + one GSAP timeline on `window.__timelines`, self-hosted Inter/IBM Plex Mono), 4 scenes over 10s with only verifiable numbers (sub-2ms recall, <50µs L0, 0 daemons, 80+ platforms, 527 tests). Built via `bun run site:showreel` (`scripts/build-showreel.ts`: master render → 1280×720 H.264 → poster → ffprobe verify). `hyperframes check` is the composition gate (0 errors, 19/19 WCAG AA); CI hash covers composition+fonts+script and fails deploys on drift (manual dispatch can rebuild in CI). Decision: the HyperFrames *skill bundle* stays uninstalled — safe-skills hard-blocked it twice (prompt-injection, credential-file-pattern flags, judged false-positive-prone but unreviewed); the npm `hyperframes` CLI (devDependency) is used instead with public docs as reference.

  40. **Non-Technical Homepage & 3D Depth System (v2.3.1)**: `apps/website` rewritten for a mixed audience with SEO/AEO structure — question-shaped `h2`s, answer-first quotable blocks, a plain-English glossary (`<dl>` term/definition pairs), and FAQ questions phrased the way a non-user actually asks them. Structured data now covers three types (FAQPage, SoftwareApplication, HowTo) and the site gained `robots.txt` + a hand-written `sitemap.xml` (no new build dependency); the favicon link was root-absolute and 404'd under the `/musememory/` base path (now `BASE_URL`-relative). Layout uses a CSS 3D depth system in `global.css` — perspective scenes, layered `--z` planes, pointer tilt, scroll parallax on a wrapper (never on `.reveal`, since both own `transform`), a clipping marquee band, and a drifting gradient mesh — all disabled under `prefers-reduced-motion` and flattened below 640px. Text sitting on the new lit glass surfaces moved from `--text-faint` to `--text-dim` to hold AA. Two audit fixes: `audit-visual.ts` now skips elements inside a clipping ancestor (marquee tracks are deliberately oversized) and `<pre>` blocks wrap instead of scrolling (`scrollable-region-focusable` was a real axe failure). Gate: 4-page build + 24/24 contrast pairs + axe clean on 4 pages + visual review 9/9 viewports + 527 tests + tsc clean.
  41. **Template-Gated Test Execution (`T-001`, PR #58)**: Strict template allowlist (`bun test <relative-test>`, `bunx tsc --noEmit`, `node --check <relative-path>`). Direct execution with zero shell invocation; eliminates RCE via memory-stored commands; audit-logged refusals (`verify_refused`).
  42. **Strict Boundary Path Containment (`T-363`, PR #59)**: `resolveWithin` containment on all wiki, pageindex, pool, and mesh boundary paths, with `resolveExternal` explicit opt-out.
  43. **Harness-Independent Hook Resolution (`T-390`, PR #61)**: Global standard first (`~/.agents`), explicit `--harness` opt-in.
  44. **Read-Path Purity Engine (`T-301`, PR #69)**: Asynchronous non-blocking write queue in `mcp.ts` ensuring read operations (`get_context`, `muse_context`) never execute synchronous store mutations.
  45. **Row-Level Lifecycle & Project Filtering (`T-303`, PR #70)**: `hybridSearch` row filters applied before vector/FTS fusion; eliminates superseded/archived/cross-project leakage at scale (>100 entries).
  46. **Additive Schema Migrations Framework (`T-368`, PR #71)**: Ordered `MIGRATIONS` array with `PRAGMA user_version` stamps and automatic backfills from existing `data` JSON blobs.
  47. **Store Invalidation & FTS Parity (`T-020`, `T-024`, `T-025`, `T-026`, PR #73)**: Query cache invalidation on writes, bounded FTS preflight token caps, single-transaction atomic batch writes, and automated FTS-to-row parity audits and repair.
  48. **Authoritative Retrieval Unification & Unicode Tokenization (`T-308`, `T-311`, PR #74)**: Unified scoring model between `get_context` and `muse_context`; multilingual unicode-aware tokenization across CJK and accented scripts with non-lexical penalties.
  49. **Tombstones, Memory Restoration & Audit Replay (`T-030`, `T-031`, `T-032`, PR #75)**: Soft-delete tombstone architecture (`deleted_at`, `deleted_by`) with automatic read-path exclusion; `memory restore` CLI and `memory_restore` MCP tool; and ledger rebuild from `audit.jsonl` via `replayFromAudit`.
  50. **Storage Engine, Outbox State Machine & Concurrency (Wave 1: `T-041`, `T-042`, `T-044`, `T-038`, `T-039`, `T-040`, `T-055`, `T-056`)**: Durable SQLite `outbox` table via migration v3 (`pending` → `processing` → `sent` / `held` / `failed`), 300s stale-lock recovery sweep on store open, single-writer file flock (`.lock`) that fails loud, crash-durable `fsync` on every JSONL audit event, `idempotency_key` unique index with divergent-retry conflict detection, case/whitespace-normalized `content_hash` fast SQLite deduplication, store circuit breaker (5 failures → 120s cooldown → graceful degradation), and `beforeExit`/`closeStore` bounded join (5000ms max) for async write workers.

---

### Website Competitor-Reference Cleanup (session)
Removed remaining competitor product names and external comparison links from website content to satisfy the no-competitor-references constraint:
- `index.astro`: Replaced "Mem0, Letta, AgentMemory…" benchmark note with "legacy memory systems"; replaced FAQ body mentioning those names with "from other memory systems".
- `compare.astro`: Removed hyperlink to `ai-memory-comparison` project (lists competitors); replaced with capability-only methodology statement.
- Gate: 527 tests pass, `tsc --noEmit` clean, website build succeeds (4 pages).

## 🔒 Active System Invariants

- **Zero External Daemons**: All operations must execute in-process via SQLite (`memory.db`) or flat files. Never depend on background servers.
- **Fail Fast**: Throw loudly on secret detection, invalid schema shapes, or unconfirmed supersessions.
- **Verification Gate**: Before declaring changes complete, `bun test`, `bun run build`, and `tsc --noEmit` must pass.

## 1. Verified Shipped Reality
- **2026-10-22**: T-321 per-project health gate scope
- **2026-10-22**: T-320 contradiction engine calibration
- **2026-10-20**: Wave 21: LifeOS Distillation, Mutation Safety & Knowledge Routing (T-050, T-177, T-324)
