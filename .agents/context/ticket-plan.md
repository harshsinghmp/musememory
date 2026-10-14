# 🎫 Exploded Ticket Plan — R17b + R18 (generated 2026-10-14)

> Every atomic deliverable from the 50-item catalog and the retirement audit, as its own ticket.
> Source of truth: `.agents/research/ecosystem-teardown-2026-10.md` §10 + `.agents/research/retirement-audit-2026-10.md`.
> Gate legend: `U` = unit test · `F` = full gate (bun test + tsc --noEmit + bun run build) · `N` = none (docs/spec only).
> Branch column maps to existing spec branches on `docs/roadmap-memory-upgrades` and existing `feat/*` branches; `new` = not yet covered.

---

## Wave A — SECURITY (do first; outranks every feature)

- [ ] T-001 · verify.ts exec: replace `/bin/sh -c` with `execFileSync` + allowlist parse · src verify.ts:23 · dep: — · new · F
- [ ] T-002 · UI XSS: escape `p.title`/`p.slug` interpolation · ui.ts:1510 · new · F
- [ ] T-003 · UI XSS: escape `r.entry_id`/`r.actor` interpolation · ui.ts:1557 · new · F
- [ ] T-004 · UI optimizer gate: `POST /api/optimize` requires dry-run default + localhost/token check · ui.ts:362 · new · F

## Wave B — DRIFT (free fixes; no runtime path changes)

- [ ] T-010 · profiles.ts: remove 7 phantom tool names (record_observation, capture_negative, conflict_detect, wiki_page, tree_index, dedup, audit_query) · orchestrator/profiles.ts · new · F
- [ ] T-011 · connect.ts: retire ALL_MEMORY_TOOLS allowlist (auto-approves 3 phantom, omits 61 real) · connect.ts:9-50 · new · F
- [ ] T-012 · delete `maybeAutoOptimize` (0 callers) · optimize.ts:362 · new · F
- [ ] T-013 · retire unreachable LSP tier; keep provider slot in chain signature · intelligence/lsp.ts:16 · new · F
- [ ] T-014 · delete 4 unused registry methods + `registerProvider` + 3 dead governor exports · registry.ts:68-117, governor.ts · new · F
- [ ] T-015 · docs truth pass: README 80+→52 platforms, daemon SSE≠WebSocket, remove profile_switch · README, docs · new · N

## Wave C — P0 RELIABILITY (v2.4.0)

- [ ] T-020 · query-cache self-destruction fix (writes no longer poison read cache) · store.ts:281 vs cache.ts:124/212 · new · F
- [ ] T-021 · memoized file verification in ranking hot path · retrieval.ts:199-204 · new · F
- [ ] T-022 · precomputed token sets per memory (drop per-query retokenization) · retrieval.ts · new · F
- [ ] T-023 · `openStore` dirty-gate: skip wiki recompile + CURRENT.md sync per MCP call · store.ts openStore · new · F
- [ ] T-024 · bounded FTS preflight (cap term count; reject oversized queries) · store.ts · new · F
- [ ] T-025 · single-transaction writes (replace 3-commit paths; ~180ms→~60ms) · store.ts · new · F
- [ ] T-026 · FTS↔row parity check + repair command · store.ts · new · F
- [ ] T-027 · `dedup` feature: wire into propose() or delete · mcp.ts:55, quality · new · F
- [ ] T-028 · `recordRetrievals`: wire into recall or delete · mcp.ts:1692, quality · new · F
- [ ] T-029 · `touchActivity`: wire into store or delete · optimize.ts:77 · new · F
- [ ] T-030 · tombstone schema + ops (soft-delete, never hard-delete) · schema, store · branch: memory-tombstones · F
- [ ] T-031 · `memory_restore` CLI+MCP command · cli, mcp · branch: memory-tombstones · F
- [ ] T-032 · audit-replay restore (rebuild from audit.jsonl) · store · branch: memory-tombstones · F
- [ ] T-033 · optimizer: replace regex deletion with tombstone+restore · optimize.ts · branch: memory-tombstones · F
- [ ] T-034 · `secure_delete` = tombstone + VACUUM + audit seal · optimize.ts · branch: memory-tombstones · F
- [ ] T-035 · `Math.max(...arr)` spread crash at scale → iterative max · retrieval.ts · new · F
- [ ] T-036 · IDF caching (stop recomputing per query) · retrieval.ts · new · F
- [ ] T-037 · drop redundant full-list scan in hybridSearch · retrieval.ts · new · F
- [ ] T-038 · `idempotency_key` column + UNIQUE index on capture · schema, store · branch: multi-writer-merge · F
- [ ] T-039 · divergent-retry → named conflict naming existing id · store.ts · branch: multi-writer-merge · F
- [ ] T-040 · `content_hash` normalize (whitespace/case) + dedup on propose · store.ts, quality · branch: multi-writer-merge · F
- [ ] T-041 · write outbox states pending→processing→sent/held/failed · schema, store · branch: multi-writer-merge · F
- [ ] T-042 · `recover_stale_locks` sweep (300s) on open · store.ts · branch: multi-writer-merge · F
- [ ] T-043 · non-idempotent ops default `auto_replay=0` (held, manual replay) · store.ts · branch: multi-writer-merge · F
- [ ] T-044 · append-only fsync JSONL event log + single-writer flock (fails loud) · store · branch: multi-writer-merge · F
- [ ] T-045 · `on_pre_compress` hook in compaction engine (extract before compact) · compaction · new · F
- [ ] T-046 · persisted digest-dedup set for extracted facts · compaction · new · F
- [ ] T-047 · never-empty checkpoint contract (raise instead of emit partial) · compaction, orchestrator · new · F
- [ ] T-048 · wake gate: background passes exit unless actionable-keys allowlist matches · optimize, cognition · new · F
- [ ] T-049 · gate exit-0 contract (never blocks a turn) · optimize · new · F
- [ ] T-050 · overnight loss guard: snapshot entry-head hashes; >25% loss → alert-only · optimize · new · F
- [ ] T-051 · memory_pressure as first-class event (store near ceiling) · store.ts · new · F
- [ ] T-052 · pressure alert in CLI (non-silent refusal) · cli · new · F
- [ ] T-053 · honest dual-measure token accounting (harness + pessimistic model) · compaction · branch: io-budget-telemetry · F
- [ ] T-054 · refuse-incomplete digest contract in get_context · orchestrator · new · F
- [ ] T-055 · circuit breaker around every store path (5 fail → 120s cooldown → degraded mode) · store.ts · new · F
- [ ] T-056 · `atexit` bounded join for async write workers · store · new · F
- [ ] T-057 · generation-counter invalidation for in-flight prefetch · orchestrator · new · F
- [ ] T-058 · read-path re-validation: injection markup/credentials/invisible chars excluded from recall, logged once · retrieval · branch: poisoning-trust-tiers · F
- [ ] T-059 · log-once dedup for revalidation skips · retrieval · branch: poisoning-trust-tiers · F
- [ ] T-060 · safe FTS5 query construction (quote every token — injection surface) · store.ts · new · F
- [ ] T-061 · compound-token expansion (camelCase/snake_case split) · retrieval · new · F
- [ ] T-062 · clamp model-supplied `limit` values · mcp tools · new · F
- [ ] T-063 · dry-run-by-default, point-id-only destructive ops · mcp, cli · new · F
- [ ] T-064 · read-path `stale:true` provenance tag for degraded/cache reads · retrieval · new · F

## Wave D — P1 MEMORY QUALITY (v2.5.0)

### Abstention + decay
- [ ] T-070 · IDF-weighted relevance gate before FTS5 (0.3, identifier-decisive, greeting short-circuit) · retrieval · new · U
- [ ] T-071 · dual calibrated thresholds (cosine max + BM25 min, engine-pinned constants) · retrieval · branch: local-embeddings-llama-cpp · U
- [ ] T-072 · FTS5-tokenizer-matched abstention gate · retrieval · new · U
- [ ] T-073 · `no_confident_match` result mode · retrieval, mcp · new · U
- [ ] T-074 · materialized `decay_score` column, importance-gated half-lives · schema, retrieval · new · U
- [ ] T-075 · veracity tiers (stated 1.0/inferred 0.7/unknown 0.8/imported 0.6/tool 0.5) · schema, store · branch: poisoning-trust-tiers · U
- [ ] T-076 · Bayesian confidence `1-0.7^n` per corroboration · quality · new · U
- [ ] T-077 · trust-tier-keyed half-life (T1 365d → T4 30d) · quality · branch: poisoning-trust-tiers · U
- [ ] T-078 · per-type `expires_at` (fix 90d/operation 180d/architecture 365d/discovery 30d) · types, store · new · U
- [ ] T-079 · stamped expiry status/expired_at/expired_by rule name · store · new · U
- [ ] T-080 · pin-capable first-match-wins expiry policy YAML · store · new · U
- [ ] T-081 · optional Weibull per-type decay curves (re-derived, not ported) · quality · new · U

### Temporal + contradiction + trust
- [ ] T-082 · `valid_to_exact` flag on transitions · schema, store · new · U
- [ ] T-083 · `as_of` queries returning `{results, undetermined}` (invent no dates) · retrieval · new · U
- [ ] T-084 · five-verb lifecycle: change/end/correct/revert/forget · store · new · U
- [ ] T-085 · `searchTemporal(atTime)` default-excluding superseded · retrieval · new · U
- [ ] T-086 · keep-both conflicts table (never delete) · quality · new · U
- [ ] T-087 · scoped invalidation requiring (entity, relation, target) alignment · quality · new · U
- [ ] T-088 · federation handshake for mesh-mode conflict dedup · sync · new · U
- [ ] T-089 · veracity rank weights user 1.0/agent 0.7/external 0.5/system 0.3 · retrieval · branch: poisoning-trust-tiers · U
- [ ] T-090 · `src_ts` evidence-age stamping (memory only as fresh as evidence) · schema, store · new · U

### Packing + graph + provenance
- [ ] T-091 · TOON-style row-wise context-pack compaction (verify 77.6% claim ourselves) · orchestrator · new · U
- [ ] T-092 · never-drop manifest TOC + descending summary caps (entry line never omitted) · orchestrator · branch: io-budget-telemetry · U
- [ ] T-093 · truncation order pin > provenance > recency > salience + `[N omitted — budget M]` marker · orchestrator · new · U
- [ ] T-094 · reserved slots for global/USER.md-class entries · orchestrator · new · U
- [ ] T-095 · `linked_memory_ids` write-time edges seeded during capture · schema, store · new · U
- [ ] T-096 · supersede-not-delete + hidden-count-aware over-fetch · store, retrieval · branch: memory-tombstones · U
- [ ] T-097 · `prefer_observations` recall-time dedup, top-2×budget scope · retrieval · new · U
- [ ] T-098 · progressive wikilink expansion after fusion · retrieval · new · U
- [ ] T-099 · `fact_provenance` append-only table, triple-unique index · schema, store · new · U
- [ ] T-100 · `supersedes_id`/`conflicts_with_id` lineage FKs · schema · new · U
- [ ] T-101 · lineage BFS walker · store · new · U
- [ ] T-102 · hash-chained audit (per-day salt) + session Merkle checkpoints · audit · new · U
- [ ] T-103 · index-time credential redaction keeping text searchable · store · branch: poisoning-trust-tiers · U

### Gates + hygiene
- [ ] T-104 · `scoreRetain` 0.3 write gate (refuse junk writes) · store · new · U
- [ ] T-105 · corroboration-gated promotion (≥2 independent days; machine sources excluded) · promotion · branch: poisoning-trust-tiers · U
- [ ] T-106 · curator concept: agent appends evidence, deterministic promotion decides · promotion · new · U
- [ ] T-107 · two-tier promotion (pending tier → session-end flush) · promotion · new · U
- [ ] T-108 · re-injection suppression per session (6-turn LRU) · retrieval · new · U
- [ ] T-109 · self-echo suppression via capture-side provenance (age-bounded) · retrieval · new · U
- [ ] T-110 · `<memory-context>`/injected-block strip before capture · harvester, store · branch: poisoning-trust-tiers · U
- [ ] T-111 · seen-chunk TTL · retrieval · new · U
- [ ] T-112 · topic-overlap >0.6 prefetch skip · retrieval · new · U
- [ ] T-113 · trivial-prompt gate (skip recall for greetings) · orchestrator · new · U
- [ ] T-114 · soft-OR evidence fusion `P=1-(1-pv)(1-pl)` · retrieval · new · U
- [ ] T-115 · `low_discrimination()` conditional rerank · retrieval · new · U
- [ ] T-116 · semantic threshold gate BEFORE BM25/entity fusion · retrieval · branch: local-embeddings-llama-cpp · U
- [ ] T-117 · watermark staleness from `last_memory_seen_at` (data, not clock) · retrieval · new · U
- [ ] T-118 · query-intent bias multipliers · retrieval · new · U
- [ ] T-119 · `effective_score = base × reinforcement × decay` · retrieval · new · U
- [ ] T-120 · RRF weight tuning + A/B · retrieval · branch: recall-eval-harness · U
- [ ] T-121 · typed drop/keep reasons per candidate · retrieval · new · U
- [ ] T-122 · L0/L1 abstract sidecars (reimplement; source is AGPL) · store · new · U
- [ ] T-123 · ratio-batched sidecar refresh · store · new · U
- [ ] T-124 · resident INDEX route-map · orchestrator · branch: io-budget-telemetry · U
- [ ] T-125 · tier budgets as named constants with provenance · retrieval, orchestrator · branch: io-budget-telemetry · U
- [ ] T-126 · `why_retrieved` deterministic reason tokens · retrieval · new · U
- [ ] T-127 · recall→usage telemetry join (`usage_rate` feeds ROI) · quality · branch: io-budget-telemetry · U
- [ ] T-128 · `[DRAFT]` marking with separate confident-answer key · store · new · U
- [ ] T-129 · config-honesty AST audit (WIRED/DORMANT/UNREAD, build-failing) · new module · new · U
- [ ] T-130 · storage-version compat tests in CI matrix · test · new · U
- [ ] T-131 · honest benchmark labels (measured-vs-claimed) on all published numbers · docs, benchmark · new · U
- [ ] T-132 · constitution contract: rules injected first, trim-exempt, no write tool · orchestrator · new · U
- [ ] T-133 · `degraded − notes` fault signal · retrieval · new · U
- [ ] T-134 · ground-moved reporting for anchors (silent when undeterminable) · anchors · new · U
- [ ] T-135 · tiered retrieval ladder labeling loosened matches · retrieval · new · U
- [ ] T-136 · embeddings engine fingerprint pinning · intelligence/embed · branch: local-embeddings-llama-cpp · U
- [ ] T-137 · FTS5-floor/vector-upgrade degradation path · retrieval · branch: local-embeddings-llama-cpp · U
- [ ] T-138 · brute-force cosine in SQLite BLOB (no ANN daemon, ever) · retrieval · branch: local-embeddings-llama-cpp · U
- [ ] T-139 · `stale_embedder` stamp on reindex-miss entries · store · branch: local-embeddings-llama-cpp · U
- [ ] T-140 · recall-set grading: must/must-not return, abstention, noise-as-failure · test · branch: recall-eval-harness · U
- [ ] T-141 · frozen benchmark corpus + drift discipline · test · branch: recall-eval-harness · U
- [ ] T-142 · p50 latency reported beside recall scores · benchmark · branch: recall-eval-harness · U
- [ ] T-143 · fixture promotion requires usage telemetry · quality · branch: recall-eval-harness · U
- [ ] T-144 · fix-pair mining (error→command→no-recurrence) → negative-memory candidates · harvester, learning · new · U

## Wave E — P2 TEAM / SERVER / UI

- [ ] T-150 · MCP Streamable HTTP transport (2025-06-18 spec) · mcp.ts · new · F
- [ ] T-151 · Origin validation + session id + protocol version headers · mcp.ts · new · F
- [ ] T-152 · SSE resumability for long polls · mcp.ts · new · F
- [ ] T-153 · per-tenant SQLite DB files (team mode) · store, root · new · F
- [ ] T-154 · extend `sync/pool.ts` to HTTP transport · sync · new · F
- [ ] T-155 · git/YAML-mirror distribution path for team sync · sync · new · F
- [ ] T-156 · Litestream sidecar backup docs+compose · docs, scripts · new · N
- [ ] T-157 · dashboard: recall-debug per-factor breakdown panel · ui · branch: studio-recall-debug · F
- [ ] T-158 · dashboard: provenance/lineage graph panel · ui · new · F
- [ ] T-159 · dashboard: eval panel (harness results) · ui · branch: recall-eval-harness + studio-recall-debug · F
- [ ] T-160 · dashboard: lifecycle control tower (trust/decay/tombstone/restore) · ui · new · F
- [ ] T-161 · dashboard: config-honesty panel · ui · dep: T-129 · new · F
- [ ] T-162 · dashboard: team mesh view · ui · dep: T-153 · new · F
- [ ] T-163 · dashboard read-only invariant (UI never writes state.db) · ui · new · F
- [ ] T-164 · event-triggered consolidation on compaction/step-count · cognition · new · F
- [ ] T-165 · dual-trigger maintenance cadence (N turns AND wall-clock) · optimize · new · F
- [ ] T-166 · cron ownership-token reconciliation with embedded effective config · optimize · new · F
- [ ] T-167 · wake-gate + breaker wiring into server mode · optimize, store · dep: T-048,T-055 · new · F
- [ ] T-168 · Hermes `MemoryProvider` interface · new module · new · F
- [ ] T-169 · Muse-MCP-backed provider adapter · new module · new · F
- [ ] T-170 · catalog submission (hermesagents plugin registry) · packaging · new · N
- [ ] T-171 · qdrant remote-vector adapter (opt-in, behind Store interface) · store adapters · branch: qdrant-hermes · F
- [ ] T-172 · federation fail-closed probes outside write locks · sync · dep: T-088 · new · F
- [ ] T-173 · observer/observed directional query (concept reimplement — AGPL) · retrieval · new · U
- [ ] T-174 · peer/namespace scoping · store · dep: T-153 · new · U
- [ ] T-175 · reserved slots per peer · orchestrator · new · U
- [ ] T-176 · memory forking/branching · store · branch: feat (R31) · F
- [ ] T-177 · safety snapshots before governance passes · store · new · F
- [ ] T-178 · graph retrieval A/B gate behind eval harness · retrieval · branch: recall-eval-harness · U
- [ ] T-179 · HRR/wikilink expansion — implement only if T-178 shows net gain · retrieval · dep: T-178 · new · U
- [ ] T-180 · funded/shared memory pools spec (Walrus delegation model) · .agents/research · new · N
- [ ] T-181 · memory marketplace spec (permissioned transfer grants) · .agents/research · new · N

## Wave F — R18 DEPRECATIONS (visible externally; docs-level breakage)

- [ ] T-201 · migrator: delete 20 stale detectors BEFORE adapter fallback (stale recognition mis-imports) · migrator/detect.ts · new · F
- [ ] T-202 · platform freeze: deprecate 20 dormant entries, freeze registry · agents/registry.ts · new · F
- [ ] T-203 · `recall` deprecate to alias of unified retrieval · cli, mcp · new · F
- [ ] T-204 · YAML mirror read precedence → DB-first (6 lines; stops disk shadowing DB) · store.ts:174-202 · new · F
- [ ] T-205 · Dockerfile: remove test-on-build stage · Dockerfile:12-13 · new · N
- [ ] T-206 · README/CHANGELOG pass for all R18 deprecations · docs · new · N

---

## Totals

| Wave | Tickets | Notes |
|---|---|---|
| A security | 4 | do first, blocks nothing else |
| B drift | 6 | free, no runtime risk |
| C P0 reliability | 45 | ~700 LOC estimate |
| D P1 quality | 75 | gated on eval harness for embedding-dependent IDs |
| E P2 team/server/UI | 32 | server mode + dashboard + interop |
| F deprecations | 6 | docs-level breakage |
| **Total** | **168** | |

Dependency-critical path: T-001 → T-030 (tombstones) → T-041 (outbox) → T-104/105 (write gates) → T-114-121 (ranking) → T-140+ (eval proves the rest).
Existing branches cover ~40 tickets; remainder need new branches off `dev`.
Every F-gated ticket requires Why/What/Verification commit body and passing bun test + tsc --noEmit + bun run build before merge.

---

# v2 — GAP AUDIT ADDENDUM (2026-10-14)

Source: read-only gap audit cross-checking the 168 tickets against the four research documents AND the engine source (`mcp.ts`, `store.ts`, `retrieval*`, `orchestrator/`, `cognition/`, `learning/`, `quality/`, `sync/`, `vector.ts`). Verdict from audit: ~70% of findings uncovered; the plan is strongest where ecosystem research was strongest (ranking/lifecycle/sync) and thinnest where the ecosystem scan could not see — **read-path purity, derived-artifact invalidation, feedback attribution**. 35 tickets below; severity is the audit's severity, argued from source (B3/B8/B10 argued, not measured — flagged).

## Wave G — READ-PATH PURITY & INVALIDATION (new gap class)

- [ ] T-301 · CRITICAL (B1) · get_context read-purity: transcript crawl + `importTranscript`→`propose`→`save` + CURRENT.md rewrite are synchronous inside the read handler (mcp.ts:1611-1624, :1579). Move to background queue; add invariant test: no writes during any read tool · dep: T-041 · F
- [ ] T-302 · HIGH (B15) · `memory_capture` full passthrough: currently sets 7 of ~40 propose options (no evidence/source/verification/dedup/validFrom/expiresAt) — provenance tickets T-075/090/099/103/105 assume write-time capture that the flagship tool cannot express · mcp.ts:1692-1699 · dep: T-075 · F
- [ ] T-303 · CRITICAL (B3) · `hybridSearch` applies no lifecycle/project filter at >100 entries (vector.ts:159-181, retrieval/engine.ts:127-148) — superseded/archived/expired/cross-project memories injected at scale · dep: T-030 · F
- [ ] T-304 · HIGH (B4) · vector index invalidation: `save()` never updates `index.json` (retrieval/engine.ts:124-127, store.ts:306); MCP hardcodes `stale:false` while serving ancient snapshots (mcp.ts:1683) · dep: T-064 · F
- [ ] T-305 · HIGH (B17) · distillation body cap: `content: obs.raw` stores whole logs as memory bodies (learning/distill.ts:67,90,98); `get_context` defaults token_budget to undefined → up to 5 full logs injected · dep: T-092 · F
- [ ] T-306 · HIGH (B16) · observations.jsonl: non-atomic whole-file rewrite per observation (tmp+rename like store.save), rotation + size cap (learning/observation.ts:100-119) · F
- [ ] T-307 · HIGH (B2) · Hebbian graph is write-only O(n²) per recall (plasticity.ts:37-64, mcp.ts:1611): n(n-1) edges + full-file rewrite every get_context; loaders have zero production callers. Bound it, make it incremental, consume it (see T-316) — or delete · F

## Wave H — RANKING & FEEDBACK CORRECTNESS

- [ ] T-308 · HIGH (B5) · two divergent ranking engines: `scoreEntry` (9 factors) drives get_context; `calculateMultiFactorScore` (11 factors) drives muse_context (retrieval.ts:181-213 vs retrieval/ranking.ts:52-222) — same store, two incompatible orderings. Unify behind one scorer or document the split explicitly · F
- [ ] T-309 · HIGH (B6) · symbol match is binary and IDF-free: `` `get` `` in tags beats all lexically-relevant memories for any query containing "get" (ranking.ts:87-96). IDF-weighted term; T-070's gate covers the FTS prefilter, not this · F
- [ ] T-310 · MEDIUM (B7) · word-boundary token matching: `entryText.includes(token)` matches race⊂trace, port⊂report (ranking.ts:62-66) · U
- [ ] T-311 · HIGH (B8) · non-ASCII queries silently degenerate: `/[a-z0-9]+/g` returns [] for CJK and fragments "café" (retrieval.ts:67-70); zero-match penalty never fires → recall returns "most recently confirmed" with no signal. Unicode-aware fallback + penalty · U
- [ ] T-312 · HIGH (B9) · FTS failure indistinguishable from no-match: `catch { return [] }` (sqlite.ts:366-374) silently removes the only lexical signal. Degraded flag + loud log; T-133's notes signal doesn't cover this · U
- [ ] T-313 · HIGH (B11) · failure attribution: `isRegression = exitCode !== 0` applies to ALL recalled memories; 3 strikes auto-flip confirmed→disputed → drops from sync + confirm() (learning/feedback.ts:30-44, quality/utility.ts:72-79). Scope regression to anchor-relevant memories + decaying counter + corroboration before demotion · dep: T-030 · F
- [ ] T-314 · MEDIUM (A2) · source-tagged recall hits `_source ∈ {hot,fts,vector,tree,distilled}` feeding rank — HOT.md is built (compounding/temporal.ts:50) and never read · dep: T-028 · U
- [ ] T-315 · MEDIUM (A3) · frequency as first-class rank axis (LangMem) · dep: T-028 · U
- [ ] T-316 · MEDIUM (A4) · promote Hebbian co-activation edges into write-time `linked_memory_ids` seeding + retrieval expansion (A-MEM note-evolution; substrate already written, never read) · dep: T-095 · U
- [ ] T-317 · MEDIUM (A5) · split T-179: query-seeded PPR restart set + A/B on factual-recall-only fixture slice (HippoRAG v1 regressed factual recall) · dep: T-140, T-178 · U
- [ ] T-318 · MEDIUM (A12) · retrieval weight auto-tuner from ROI telemetry, gated behind eval harness (memoria) · dep: T-127, T-140 · U
- [ ] T-319 · MEDIUM (A1) · `is_inference` + `parent_ids` columns; inference down-weight; `memory_review_queue` ordered by support count (Supermemory) — distilled candidates currently rank identical to user-stated facts · dep: T-075 · U

## Wave I — GOVERNANCE & SCALE

- [ ] T-320 · HIGH (B10) · contradiction engine calibration: 7 regexes flip BOTH sides to `conflicted` at 0.85 on any 0.4-Jaccard pair (quality/contradiction.ts:15-23,85-114) → −0.8 rank, sync removal, −25 health each = 4 false positives = FAIL. Dry-run mode, negation-pair scoping, calibration fixtures · U
- [ ] T-321 · HIGH (B12) · per-project health gate: gate/clustering/tech-debt call `list(store)` unfiltered and label by `entries[0].project` (health/gate.ts:31,220; cognition/clustering.ts:62; tech-debt.ts:102) — one number attributed to whichever memory sorts first · dep: T-153 · U
- [ ] T-322 · MEDIUM (B13) · per-file read cache: anchor audit reads every source file 3× per health check (health/gate.ts:82,111,176 → anchors/resolver.ts:121) · U
- [ ] T-323 · MEDIUM (B14) · anchored memories force-injected to front regardless of `anchor.status` + budget ordering (orchestrator/context.ts:104-147) — anchor to a deleted file wins the slot forever · dep: T-134 · U
- [ ] T-324 · HIGH (B18) · checkpoint merge semantics: `generateSessionHandoff` overwrites CURRENT.md wholesale; omitted constraints default to 2 hardcoded strings → hand-added constraints destroyed (compaction/engine.ts:145,54). Diff-preserving update, never drop unknown constraints · F
- [ ] T-325 · MEDIUM (B19) · `rollupTemporal` never filters by its own period — every rollup contains all history (compounding/temporal.ts:120-135) · U
- [ ] T-326 · MEDIUM (B20) · tier 0/1 run the full ranking path (retrieval/tiered.ts:37) — audit D9 named this line; no ticket makes tier 0 cheap or removes it · U
- [ ] T-327 · MEDIUM (B21) · paged candidate source: `list()` = full SELECT * + JSON.parse ×44 call sites (store.ts:220-288); getSyncStatus filters whole store to count; collectNudges calls it twice uncapped · U
- [ ] T-328 · MEDIUM (B22) · real Lamport counter: sync clock is `memories.length + Date.now()` (sync/engine.ts:118-125) — equal counts collide, divergence undetectable · dep: T-044 · U

## Wave J — ECOSYSTEM GAPS NOT YET TICKETIZED

- [ ] T-329 · MEDIUM (A6) · episode table + episode-scoped search + episode stamp on hits (Zep: session_id is indexed at sqlite.ts:157 and never used as a retrieval unit) · U
- [ ] T-330 · MEDIUM (A7) · `absent` memory type ("checked, no X exists") + role scoping user/agent/external/system (Mem0 v3) · U
- [ ] T-331 · MEDIUM (A8) · read-tool purity sweep across CLI + MCP: every read command read-only (converges with T-301) · F
- [ ] T-332 · HIGH (A9) · signed SyncPacket + peer allowlist + fail-closed on unknown sender (Walrus: gossip has no identity layer; any process writing `.memory/sync/pool/` injects memories — zero auth tickets existed) · dep: T-044, T-150 · F
- [ ] T-333 · MEDIUM (A10) · confirm() extends expiry + expiry-horizon alert N days out (Walrus documented failure: expiry without renewal) · dep: T-078, T-079 · U
- [ ] T-334 · LOW (A11) · `write_origin` tier (interactive/harvest/distill/sync) → rank weight (LangMem: hot-path vs background writes as trust axis) · dep: T-089 · U
- [ ] T-335 · LOW (A13) · tombstone `visible_until` delayed-deletion semantics: hidden from all surfaces, retained in audit (ChatGPT-memory caution row) · dep: T-030, T-031 · U

## v2 adjacency notes (amendments to earlier tickets)

- T-021/022 note B5: hot-path fixes apply to `retrieval.ts`; the muse_context scorer (`ranking.ts`) has its own tokenization — T-308 owns the unification.
- T-070 note B6: the IDF abstention gate covers the FTS prefilter only; the binary symbol bonus needs T-309.
- T-024 note B3: bounding FTS terms ≠ bounding result rows; T-303 owns row-level lifecycle/project filtering.
- T-028 note B11/A3: wiring `recordRetrievals` is necessary but not sufficient — T-313 fixes what the telemetry is allowed to conclude.
- T-177 note B18: governance-pass snapshots ≠ checkpoint overwrite; T-324 owns CURRENT.md merge semantics.

## v2 totals

| Wave | Tickets | |
|---|---|---|
| G read-path purity | 7 | 2 critical (T-301, T-303) |
| H ranking/feedback | 12 | |
| I governance/scale | 9 | |
| J ecosystem gaps | 7 | |
| **Plan total** | **203** | v1 168 + v2 35 |

---

# v3 — NEXUS MULTI-MODE AUDIT + IMPLEMENTABILITY (2026-10-14)

Sources: Nexus audit mode over the skipped surfaces (`ui.ts`, `daemon.ts`, `cli/`, `mesh/`, `wiki/`, `adrs/`, `pageindex/`, `migrator/`) + intended mode (34 shipped-capability claims + README claims ↔ implementation evidence; 48 sampled tickets verified against source).

## VERDICT: implementable as written — with ordering corrections

45/48 sampled ticket references are exact; 3 shifted (T-013, T-021, T-205 — cosmetic). Two tickets need re-scoping (T-045, T-163). One structural gap: no migration mechanism is named by any column-adding ticket. All RB items below are ordering, not architecture.

## Wave 0 — FOUNDATIONAL SEAMS (must land before dependent tickets)

- [ ] T-363 · RB-1 CRITICAL · path-validation choke point: single `resolveWithin(base, ...segments)` primitive applied at every boundary (ui.ts:164,503,577; pageindex/engine.ts:111,205,250; wiki/compiler.ts:504; mesh/discovery.ts:29; sync/pool.ts:19). F-01/F-02/F-03/F-21/F-26 are four call sites of this one missing primitive — fixing per-endpoint guarantees reintroduction · blocks T-336, T-337, T-351, T-355 · F
- [ ] T-364 · RB-3 · unique-ID seam: `crypto.randomUUID` (or DB UNIQUE + collision retry) behind one id-generator; current `Date.now()` ids (adrs/engine.ts:104, pageindex/engine.ts:34) collide same-millisecond with no constraint to reject · blocks T-038, T-041, T-044, T-328 and every parallel-writer ticket · F
- [ ] T-365 · RB-2 · anchor base normalization at write time: `contracts.ts:113-118` resolves against `topology.rootPath` while `drift.ts:93` resolves the same anchor against `workspaceRoot` — two bases, no normalization; anchor records its own base · blocks drift/mesh/code-impact tickets · F
- [ ] T-366 · RB-6 · migrator quarantine: schema-validated intake + quarantine status + strip self-certified `independently-verified` (agentmemory.ts:59-62) + generic adapter never writes `confirmed` · blocks T-338, T-339, T-340 · F
- [ ] T-367 · RB-5 DECISION · zero-daemon charter vs reality: `daemon.ts` + `ui.ts` are two blocking HTTP servers (cli/ecosystem.ts:507, decisions.md:7 ADR-001 binding) — principal decision: amend charter, or daemon becomes opt-in-removable; until decided, every watch/HTTP/background ticket stacks onto a violated foundation · N (decision record)
- [ ] T-368 · CRITICAL · migration mechanism: `memories` table is 14 columns + `data` JSON (sqlite.ts:137-155); ~20 D/C-wave tickets need real columns (idempotency_key, content_hash, decay_score, fact_provenance, linked_memory_ids, is_inference, parent_ids). One migration framework + one migration PR pattern (additive ALTER + backfill + test) · blocks the whole D-wave · F

## Findings from Nexus audit mode (new tickets T-336..T-362)

**Reject:**
- [ ] T-336 · F-01/F-02 · pageindex path traversal: unsanitized `project`/`indexId` → `rmSync(recursive)` arbitrary delete via `memory_disconnect_pageindex` (pageindex/engine.ts:250,252,256 + mcp.ts:2032) · dep: T-363 · F
- [ ] T-337 · F-03 · wiki path traversal: raw `slug` → arbitrary `.md` read (wiki/compiler.ts:504,513; mcp.ts:1955; ui.ts:166) · dep: T-363 · F
- [ ] T-338 · F-04 · migrator self-certification: imported data stamped `verification.level:"independently-verified"` with zero verification (migrator/adapters/agentmemory.ts:59-62) · dep: T-366 · F
- [ ] T-339 · F-05 · Letta injection: human/persona core memory marked `isConstraint:true` → verbatim into CURRENT.md (letta.ts:26,38; engine.ts:113-115) — cross-agent instruction injection · dep: T-366 · F
- [ ] T-340 · F-06/F-07 · generic adapter imports junk as confirmed: any JSON object value becomes a memory (generic.ts:21; engine.ts:130); whole .md/.txt/.jsonl files imported wholesale (generic.ts:77-86) · dep: T-366 · F
- [ ] T-341 · F-08 · `memory upgrade --dry-run` still rewires agents: step 3 unguarded `repairInstallation` hardcodes `dryRun:false` (cli/upgrade.ts:524,359) · F
- [ ] T-342 · F-09 · studio export XSS: `JSON.stringify(memories)` unescaped `</script>` + `$&`-pattern corruption (ui.ts:2473-2474) · F

**Request Changes:**
- [ ] T-343 · F-10 · malformed Host header crashes dashboard: `new URL(req.url, "http://"+req.headers.host)` outside try → unhandled rejection → exit(1) (ui.ts:42; bin/memory.ts:4) · F
- [ ] T-344 · F-11 · `origin === "null"` classified local, echoed into CORS (ui.ts:56,59) — sandboxed iframe gets full read+write · F
- [ ] T-345 · F-12/F-13 · daemon hardening: no `server.on("error")` (EADDRINUSE crashes), `/publish` no origin check, client sockets leaked (daemon.ts:36-78,87), shared debounce collapses watcher events, watchers never re-armed · F
- [ ] T-346 · F-14 · upgrade CLI exit codes: zero non-zero exits in 558 LOC; CI cannot distinguish success from failure (cli/upgrade.ts:498) · F
- [ ] T-347 · F-15 · port-handling contract broken: auto-increment path dead (ecosystem.ts:443 always passes port); `--port abc` → NaN → random port (ui.ts:613) · F
- [ ] T-348 · F-16 · migrator false positives: detection = "directory exists"; unexpanded `~` fallback makes `skipped` branch unreachable (detect.ts:22-276; engine.ts:56,70) · F
- [ ] T-349 · F-17 · migrator dedup silent: no counter; dry-run doesn't dedupe within batch (dry-run ≠ actual) (engine.ts:105-107,145) · F
- [ ] T-350 · F-18/F-19/F-20 · drift endpoint: unguarded statSync 500s on dangling symlink; O(exports × memories) substring scan; a READ appends audit events (drift.ts:27,139-144,178-191) · F
- [ ] T-351 · F-21 · mesh anchor path traversal: memory-supplied `file_path` → unbounded readFileSync; only gate is `includes("packages/")` (contracts.ts:121; ui.ts:577; discovery.ts:28-41) · dep: T-363 · F
- [ ] T-352 · F-22/F-23 · ADR integrity: supersede-before-save leaves dangling ref on failure; rejected ADR stored as confirmed (engine.ts:148,162-165,191) · F
- [ ] T-353 · F-24 · wiki frontmatter forge: unescaped memory title/tags interpolated into YAML scalars (wiki/render.ts:6,10,13,31; read back at compiler.ts:487) · F
- [ ] T-354 · F-25 · CLI arg parsing: `--k=a=b` truncates; `--limit -1` parses as flag; no `--` terminator (cli/shared.ts:17,20) · F
- [ ] T-355 · F-26 · sync pool_dir forwarding: `/api/sync/pool` body → arbitrary mkdir/readdir (ui.ts:503 → sync/pool.ts:19,22,33) · dep: T-363 · F
- [ ] T-356 · F-27 · pageindex disclosure-depth is a no-op: `maxDepth`/`disclosureDepth` accepted, never used (engine.ts:124-125 vs 137-165) · F
- [ ] T-357 · F-28 · migrator status cast: raw provider string → `MemoryStatus` unvalidated; `isLatest !== false` defaults to confirmed (generic.ts:68; agentmemory.ts:44) · F
- [ ] T-358 · F-29 · ADR-001 violation: `handleDaemonCommand` returns never-resolving promise + second blocking server (cli/ecosystem.ts:507) · dep: T-367 · F
- [ ] T-359 · F-30 · upgrade stubs render ✅ for empty audit steps; 35 empty `catch {}` in cli/ (upgrade.ts:507-509,530-532) · F
- [ ] T-360 · F-31/F-35 · UI shutdown + numeric validation: keep-alive sockets block close (ui.ts:626); unvalidated parseInt limits (ui.ts:209,613) · F
- [ ] T-361 · F-32 · escapeHtml omits `'`; `item.priority` unescaped into class attribute (ui.ts:1588,2093) · F
- [ ] T-362 · F-33/F-34 · migrator dead config + misclassification: `global` never read; `skipped` unreachable; `s.includes("op")` matches loop/topic/propose (types.ts:71; engine.ts:70; drift.ts:12,130) · F

## New tickets from intended mode (claims ↔ evidence)

- [ ] T-369 · benchmark threshold tests: "sub-50 µs" (benchmark/suite.ts:85) and "sub-2ms" claims have NO threshold assertions — `test/benchmark.test.ts:54,58` assert `>= 0`. Either assert real gates or remove the claims (feeds T-131 honesty) · F
- [ ] T-370 · docs truth pass (replaces/extend T-015): 80+→52 platforms (×5 README places); "24+ formats"→22 detectors/3 adapters; "29 engines"→same; "61 tools/6 profiles"→107 tools/7 profiles; remove `profile_switch` (0 occurrences); daemon SSE≠WebSocket label; README body 497/84/2190→502/85/2224; current.md #32 "Linus hardening" is PARTIAL until T-001 lands (verify.ts:23 unpatched); capability #15 PARTIAL (`evaluateSessionOutcomes` 0 production callers); #21 PARTIAL (7 phantom profile names); #33 PARTIAL (`maybeAutoOptimize` 0 callers) · N

## v3 amendments to existing tickets

- T-013: real path `intelligence/adapters/lsp.ts:14` (plan said `intelligence/lsp.ts:16`)
- T-021: real hot path `retrieval.ts:199` (`verifyRuntimeFiles` inside scoreEntry)
- T-205: `Dockerfile:9-11` (lines shifted)
- T-027 CORRECTION: `dedup` IS wired in propose (`store.ts:418`); the real gap is `memory_capture` never passing it → folded into T-302
- T-302: 6 of 23 propose options passed (not "~40"); add dedup passthrough
- T-308: `scoreEntry` has 10 factors (not 9)
- T-045 RE-SCOPE: compaction is 4 pure functions with no injection surface — this ticket CREATES the seam (new interface + tests), then the hook
- T-163 RE-SCOPE: read-only UI invariant contradicts 15 live write endpoints — it is a breaking change; needs deprecation path + principal decision, not a hardening ticket
- T-136/137/138 RE-SCOPE: branch exists with ZERO implementation files — add a spike ticket (validate llama-cpp local embeddings E2E) before the three build tickets
- T-201: 19 generic-fallback detectors (not 20)

## v3 totals

| Section | Tickets |
|---|---|
| v1 | 168 |
| v2 gap audit | 35 |
| v3 Wave 0 seams | 6 |
| v3 audit findings | 27 |
| v3 claims/bench | 2 |
| **Plan total** | **238** (pending test-integrity tickets T-371+) |

---

# v4 — TEST-SUITE INTEGRITY (2026-10-14)

Source: read-only test audit (85 suites / 502 tests / 12,450 LOC). Suite hygiene is genuinely clean: **zero** skip/only/todo, zero snapshots, zero dist/ imports. The problem is assertion quality and dispatch coverage.

## New findings (lying tests + conflicts)

- [ ] T-371 · lying security tests: `security_hardening.test.ts:95-100` (1MB-DoS guard proves nothing — catch returns synthesized 500; real path `ui.ts:642 req.destroy()` never asserted), `:127-136` (SQL-injection half vanishes behind `if (store.db)`) · F
- [ ] T-372 · tautological doctor test: name says "uninitialized directory", asserts `initialized === true` — `doctor.ts:60-63` creates `.memory` before the check, assertion cannot fail (`doctor.test.ts:10-19`) · F
- [ ] T-373 · substring-grep UI tests → real assertions: ~30 `expect(html).toContain(id)` asserts on generated HTML (`ui.test.ts:48-57,114-124,132-210`) prove identifiers exist, not behavior · F
- [ ] T-374 · toBeDefined/tautology assertions → value assertions: `health.test.ts:221-228` (9× toBeDefined on muse_health MCP+CLI), `benchmark.test.ts:47-72` (9× `>= 0` — cannot fail) · F
- [ ] T-375 · Array.isArray-only list tests → content assertions: `optimize.test.ts`, `mesh.test.ts:271`, `ui.test.ts:32,63,81,146,209`, `connect.test.ts:34`, `mcp.test.ts:70-129` (12 dynamic-import re-imports inflate apparent coverage) · F
- [ ] T-376 · reconcile authoritative-test conflicts: `graph.test.ts` ⊂ `graph_ast.test.ts`; `retrieval_engine.test.ts` asserts 3 headings where `retrieval.test.ts:44-77` asserts content; `panda_loader.test.ts` supersedes `upgrade.test.ts:28-34`; `agents.test.ts:56` supersedes connect duplicates; `sqlite_primary.test.ts:19-91` supersedes `store.test.ts:9-24` (never reloads store) · F
- [ ] T-377 · false-coverage test name: `sqlite_primary.test.ts:47` claims "stale" transition in a body that imports `markStale` and never calls it (`:4`) — rename or execute · F
- [ ] T-378 · dead test imports: `quality.test.ts:8` (computeJaccardSimilarity, consolidateIntoCanonical), `settings.test.ts:10,13`, `orchestrator.test.ts:13` (getActiveMcpProfile), `intelligence.test.ts:7` (LspProvider) — delete imports or restore coverage · F

## v4 amendments

- T-016 scope update: 12 circular tools now named — `memory_observe`, `memory_feedback`, `memory_negative_capture`, `memory_harvest`, `memory_harvest_turn`, `memory_distill`, `memory_distill_observations`, `memory_compaction_check`, `memory_compact_handoff`, `memory_checkpoint`, `memory_roi`, `memory_ranked_retrieval`. Real dispatch coverage is 26/107 tools; **64 tools never referenced by any test** — extend T-016 to a dispatch-coverage matrix ticket for all 64
- T-001..T-004 amendment: regression tests go RED first — `verify.test.ts` currently only exercises benign commands; zero escapeHtml/`<script>` assertions exist anywhere in the suite
- Coverage landmines found: `retrieval/engine.ts` `pageindex`/`tree`/`hybrid`/`auto` modes NEVER tested (`engine.ts:83,127` thresholds unreachable in tests — T-303's >100-entry filter gap is exactly the untested path); 6 store exports never called (`listIds`, `markSuperseded`, `getStorageLayout`, `harvestMemories`, `extractEntryText`, `nowIso`)

## v4 totals

| Section | Tickets |
|---|---|
| v1+v2+v3 | 238 |
| v4 test integrity | 8 |
| **Plan total** | **246** |
