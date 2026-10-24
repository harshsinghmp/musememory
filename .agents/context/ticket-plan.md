# 🎫 Exploded Ticket Plan — R17b + R18 (generated 2026-10-14)

> Every atomic deliverable from the 50-item catalog and the retirement audit, as its own ticket.
> Source of truth: `.agents/research/ecosystem-teardown-2026-10.md` §10 + `.agents/research/retirement-audit-2026-10.md`.
> Gate legend: `U` = unit test · `F` = full gate (bun test + tsc --noEmit + bun run build) · `N` = none (docs/spec only).
> Branch column maps to existing spec branches on `docs/roadmap-memory-upgrades` and existing `feat/*` branches; `new` = not yet covered.

---

## Wave A — SECURITY (do first; outranks every feature)

- [x] T-001 · landed #58 — template-gated test_command (fixed argv templates, no shell), `verify_refused` audit · src/verify.ts · F
- [x] T-002 · landed Wave 5 — UI XSS: escape `p.title`/`p.slug` interpolation · ui.ts:1510 · branch: feat/wave-5-security-ui-protection · F
- [x] MERGED→T-002 T-003 · UI XSS: escape `r.entry_id`/`r.actor` interpolation · ui.ts:1557 · new · F
- [x] T-004 · landed Wave 5 — UI optimizer gate: `POST /api/optimize` requires dry-run default + localhost/token check · ui.ts:362 · branch: feat/wave-5-security-ui-protection · F

## Wave B — DRIFT (free fixes; no runtime path changes)

- [x] T-010 · landed #112 — profiles.ts: align profile tool definitions with live registered MCP tools (replace 7 phantom tool names) · orchestrator/profiles.ts · new · F
- [x] T-011 · landed #114 — connect.ts: align ALL_MEMORY_TOOLS with live registered MCP tools (108 tools, eliminates 3 phantoms and auto-approves all 71 missing tools) · connect.ts:9-50 · new · F
- [x] T-012 · landed #116 — delete dead zero-caller `maybeAutoOptimize` · optimize.ts:362 · new · F
- [x] T-013 · landed #128 · retire unreachable LSP tier; keep provider slot in chain signature · src/intelligence/adapters/lsp.ts:14 · F
- [x] T-014 · landed #130 · delete 4 unused registry methods + `registerProvider` + 3 dead governor exports · registry.ts:68-117, governor.ts · F
- [x] T-015 · docs truth pass: README 80+→52 platforms, daemon SSE≠WebSocket, remove profile_switch · README, docs · new · N

## Wave C — P0 RELIABILITY (v2.4.0)

- [x] T-020 · landed #73 — query-cache self-destruction fix (writes no longer poison read cache) · store.ts:281 vs cache.ts:124/212 · F
- [x] T-021 · landed Wave 13 (#172) — memoized file verification in ranking hot path · retrieval.ts:199-204 · new · F
- [x] T-022 · landed Wave 13 (#174) — precomputed token sets per memory (drop per-query retokenization) · retrieval.ts · new · F
- [x] T-023 · landed Wave 13 (#176) — `openStore` dirty-gate: skip wiki recompile + CURRENT.md sync per MCP call · store.ts openStore · new · F
- [x] T-024 · landed #73 — bounded FTS preflight (cap term count; reject oversized queries) · store.ts · F
- [x] T-025 · landed #73 — single-transaction writes (replace 3-commit paths; ~180ms→~60ms) · store.ts · F
- [x] T-026 · landed #73 — FTS↔row parity check + repair command · store.ts · F
- [ ] T-016 · dispatch-coverage matrix: 64/107 MCP tools referenced by NO test (T-016 was referenced but never defined — plan's largest coverage hole had no ticket). Ships with Wave 5; T-371 lands first · F
- [x] RESOLVED (intended lane): `dedup` IS wired at store.ts:418 — only memory_capture omits it; scope folded into T-027 note + T-040 covers the missing normalization · mcp.ts:55, quality · new · F
- [x] T-028 · landed Wave 13 (#178) — `recordRetrievals`: wire into recall or delete · mcp.ts:1692, quality · new · F
- [x] T-029 · landed Wave 13 (#180) — `touchActivity`: wire into store or delete · optimize.ts:77 · new · F
- [x] T-030 · landed #75 — tombstone schema + ops (soft-delete, never hard-delete) · schema, store · branch: memory-tombstones · F
- [x] T-031 · landed #75 — `memory_restore` CLI+MCP command · cli, mcp · branch: memory-tombstones · F
- [x] T-032 · landed #75 — audit-replay restore (rebuild from audit.jsonl) · store · branch: memory-tombstones · F
- [ ] T-033 · optimizer: replace regex deletion with tombstone+restore · optimize.ts · branch: memory-tombstones · F
- [ ] T-034 · `secure_delete` = tombstone + VACUUM + audit seal · optimize.ts · branch: memory-tombstones · F
- [x] T-035 · landed Wave 3 — `Math.max(...arr)` spread crash at scale → iterative safeMax/safeMin · retrieval.ts, vector.ts, ui.ts · branch: feat/wave-3-retrieval-ranking · F
- [x] T-036 · landed Wave 3 — in-memory IDF caching via WeakMap across queries · vector.ts · branch: feat/wave-3-retrieval-ranking · F
- [x] T-037 · landed Wave 3 — drop redundant full-list scan via countMemories · store.ts, cache.ts, engine.ts · branch: feat/wave-3-retrieval-ranking · F
- [x] T-038 · landed Wave 1 — `idempotency_key` column + UNIQUE index on capture · schema, store · F
- [x] T-039 · landed Wave 1 — divergent-retry → named conflict naming existing id · store.ts · F
- [x] T-040 · landed Wave 1 — `content_hash` normalize (whitespace/case) + dedup on propose · store.ts, quality · F
- [x] T-041 · landed Wave 1 — write outbox states pending→processing→sent/held/failed · schema, store, outbox.ts · F
- [x] T-042 · landed Wave 1 — `recover_stale_locks` sweep (300s) on open · store.ts, outbox.ts · F
- [x] T-043 · landed Wave 1 — non-idempotent ops default `auto_replay=0` (held, manual replay) · store.ts, outbox.ts · F
- [x] T-044 · landed Wave 1 — append-only fsync JSONL event log + single-writer flock (fails loud) · store, lock.ts · F
- [x] T-045 · landed Wave 4 — `on_pre_compress` hook in compaction engine (extract before compact) · compaction · branch: feat/wave-4-compaction-distillation · F
- [x] T-046 · landed Wave 4 — persisted digest-dedup set for extracted facts · compaction · branch: feat/wave-4-compaction-distillation · F
- [x] T-047 · landed Wave 4 — never-empty checkpoint contract (raise instead of emit partial) · compaction, orchestrator · branch: feat/wave-4-compaction-distillation · F
- [ ] T-048 · wake gate: background passes exit unless actionable-keys allowlist matches · optimize, cognition · new · F
- [x] MERGED→T-048 T-049 · gate exit-0 contract (never blocks a turn) · optimize · new · F
- [x] T-050 · landed Wave 21 — overnight / in-lock mutation safety guards (verifyMutationSafety, ESUSPECT_SHRINK, ESUSPECT_EROSION, allowDrastic) · quality, store · test/mutation_guards.test.ts · F
- [ ] T-051 · memory_pressure as first-class event (store near ceiling) · store.ts · new · F
- [x] MERGED→T-051 T-052 · pressure alert in CLI (non-silent refusal) · cli · new · F
- [x] T-053 · landed Wave 4 — honest dual-measure token accounting (harness + pessimistic model) · compaction · branch: feat/wave-4-compaction-distillation · F
- [x] T-054 · landed Wave 4 — refuse-incomplete digest contract in get_context · orchestrator · branch: feat/wave-4-compaction-distillation · F
- [x] T-055 · landed Wave 1 — circuit breaker around every store path (5 fail → 120s cooldown → degraded mode) · store.ts, circuit.ts · F
- [x] T-056 · landed Wave 1 — `atexit` bounded join for async write workers · store, async_workers.ts · F
- [x] T-058 · landed Wave 2 — read-path re-validation: injection markup/credentials/invisible chars excluded from recall, logged once · retrieval · branch: feat/wave-2-trust-gates · F
- [x] MERGED→T-058 T-059 · log-once dedup for revalidation skips · retrieval · branch: poisoning-trust-tiers · F
- [x] T-060 · landed Wave 3 — safe FTS5 query construction (quote every token, prefix wildcards, T-312 error log) · sqlite.ts · branch: feat/wave-3-retrieval-ranking · F
- [x] T-061 · landed Wave 3 — compound-token expansion (camelCase/PascalCase/snake_case split) · retrieval.ts · branch: feat/wave-3-retrieval-ranking · F
- [x] T-062 · landed Wave 13 (#182) — clamp model-supplied `limit` values · mcp tools · new · F
- [x] T-063 · landed Wave 13 (#184) — dry-run-by-default, point-id-only destructive ops · mcp, cli · new · F
- [x] T-064 · landed Wave 13 (#186) — read-path `stale:true` provenance tag for degraded/cache reads · retrieval · new · F

## Wave D — P1 MEMORY QUALITY (v2.5.0)

### Abstention + decay
- [x] T-070 · landed Wave 3 — IDF-weighted relevance gate before FTS5 (0.3 threshold, identifier-decisive, greeting short-circuit) · retrieval.ts, ranking.ts · branch: feat/wave-3-retrieval-ranking · U
- [x] T-071 · landed Wave 6 — dual calibrated thresholds (cosine max + BM25 min, engine-pinned constants) · retrieval · branch: feat/wave-6-embeddings-eval-harness · U
- [x] T-072 · landed Wave 15 — FTS5-tokenizer-matched abstention gate · retrieval · PR #200 (Issue #199) · U
- [x] T-073 · landed Wave 15 — `no_confident_match` result mode · retrieval, mcp · PR #202 (Issue #201) · U
- [x] T-074 · landed Wave 15 — materialized `decay_score` column, importance-gated half-lives · schema, retrieval · PR #204 (Issue #203) · U
- [x] T-075 · landed Wave 2 — veracity tiers & ingest trust tiers (trusted/candidate/untrusted) · schema, store, retrieval · branch: feat/wave-2-trust-gates · U
- [x] T-076 · landed Wave 15 — Bayesian confidence `1-0.7^n` per corroboration · quality · PR #206 (Issue #205) · U
- [x] T-077 · landed Wave 15 — trust-tier-keyed half-life (T1 365d → T4 30d) · quality · PR #208 (Issue #207) · U
- [x] T-078 · landed Wave 15 — per-type `expires_at` (fix 90d/operation 180d/architecture 365d/discovery 30d) · types, store · PR #210 (Issue #209) · U
- [x] T-079 · landed Wave 15 — stamped expiry status/expired_at/expired_by rule name · store · PR #212 (Issue #211) · U
- [x] T-080 · landed Wave 15 — pin-capable first-match-wins expiry policy YAML · store · PR #214 (Issue #213) · U
- [x] T-081 · landed Wave 15 — optional Weibull per-type decay curves (re-derived, not ported) · quality · PR #216 (Issue #215) · U

### Temporal + contradiction + trust
- [x] T-082 · landed Wave 16 — `valid_to_exact` flag on transitions · schema, store · PR #219 (Issue #218) · U
- [x] T-083 · landed Wave 16 — `as_of` queries returning `{results, undetermined}` (invent no dates) · retrieval · PR #221 (Issue #220) · U
- [x] T-084 · landed Wave 16 — five-verb lifecycle: change/end/correct/revert/forget · store · PR #223 (Issue #222) · U
- [x] T-085 · landed Wave 16 — `searchTemporal(atTime)` default-excluding superseded · retrieval · PR #225 (Issue #224) · U
- [x] T-086 · landed Wave 16 — keep-both conflicts table (never delete) · quality · PR #227 (Issue #226) · U
- [x] T-087 · landed Wave 16 — scoped invalidation requiring (entity, relation, target) alignment · quality · PR #229 (Issue #228) · U
- [x] T-088 · landed Wave 16 — federation handshake for mesh-mode conflict dedup · sync · PR #231 (Issue #230) · U
- [x] T-089 · landed Wave 16 — veracity rank weights user 1.0/agent 0.7/external 0.5/system 0.3 · retrieval · PR #233 (Issue #232) · U
- [x] T-090 · landed Wave 16 — `src_ts` evidence-age stamping (memory only as fresh as evidence) · schema, store · PR #235 (Issue #234) · U

### Packing + graph + provenance
- [x] T-091 · landed Wave 4 — TOON-style row-wise context-pack compaction (verify 77.6% claim ourselves) · orchestrator · branch: feat/wave-4-compaction-distillation · U
- [x] T-092 · landed Wave 4 — never-drop manifest TOC + descending summary caps (entry line never omitted) · orchestrator · branch: feat/wave-4-compaction-distillation · U
- [x] T-093 · landed Wave 4 — truncation order pin > provenance > recency > salience + `[N omitted — budget M]` marker · orchestrator · branch: feat/wave-4-compaction-distillation · U
- [x] T-094 · landed Wave 4 — reserved slots for global/USER.md-class entries · orchestrator · branch: feat/wave-4-compaction-distillation · U
- [x] T-095 · landed Wave 17 — `linked_memory_ids` write-time edges seeded during capture · schema, store · PR #239 (Closes #238) · U
- [x] T-096 · landed Wave 17 — supersede-not-delete + hidden-count-aware over-fetch · store, retrieval · PR #241 (Closes #240) · U
- [x] T-097 · landed Wave 17 — `prefer_observations` recall-time dedup, top-2×budget scope · retrieval · PR #243 (Closes #242) · U
- [x] T-098 · landed Wave 17 — progressive wikilink expansion after fusion · retrieval · PR #245 (Closes #244) · U
- [x] T-099 · landed Wave 17 — `fact_provenance` append-only table, triple-unique index · schema, store · PR #247 (Closes #246) · U
- [x] T-100 · landed Wave 17 — `supersedes_id`/`conflicts_with_id` lineage FKs · schema · PR #249 (Closes #248) · U
- [x] T-101 · landed Wave 17 — lineage BFS walker · store · PR #251 (Closes #250) · U
- [x] T-102 · landed Wave 17 — hash-chained audit (per-day salt) + session Merkle checkpoints · audit · PR #253 (Closes #252) · U
- [x] T-103 · landed Wave 2 — index-time credential redaction keeping text searchable · sqlite, store · branch: feat/wave-2-trust-gates · U

### Gates + hygiene
- [x] T-104 · landed Wave 2 — `scoreRetain` 0.3 write gate (refuse junk writes) · quality/retention, store · branch: feat/wave-2-trust-gates · U
- [x] T-105 · landed Wave 2 — corroboration-gated promotion (≥2 independent days; machine sources excluded) · promotion · branch: feat/wave-2-trust-gates · U
- [x] T-106 · landed Wave 18 — curator concept: agent appends evidence, deterministic promotion decides · promotion · PR #256 · U
- [x] T-107 · landed Wave 18 — two-tier promotion (pending tier → session-end flush) · promotion · PR #258 · U
- [x] T-108 · landed Wave 18 — re-injection suppression per session (6-turn LRU) · retrieval · PR #260 · U
- [x] T-109 · landed Wave 18 — self-echo suppression via capture-side provenance (age-bounded) · retrieval · PR #262 · U
- [x] T-110 · landed Wave 18 — `<memory-context>`/injected-block strip before capture · harvester, store · PR #264 · U
- [x] T-111 · landed Wave 18 — seen-chunk TTL · retrieval · PR #266 · U
- [x] T-112 · landed Wave 18 — topic-overlap >0.6 prefetch skip · retrieval · PR #268 · U
- [x] T-113 · landed Wave 18 — trivial-prompt gate (skip recall for greetings) · orchestrator · PR #270 · U
- [x] T-114 · landed Wave 3 — soft-OR evidence fusion `P=1-(1-pv)(1-pl)` · ranking.ts, vector.ts · branch: feat/wave-3-retrieval-ranking · U
- [x] T-115 · landed Wave 3 — `low_discrimination()` conditional rerank (tier/verification/recency tie-breaker) · retrieval.ts, ranking.ts · branch: feat/wave-3-retrieval-ranking · U
- [x] MERGED→T-071 T-116 · semantic threshold gate BEFORE BM25/entity fusion · retrieval · branch: local-embeddings-llama-cpp · U
- [x] T-117 · landed Wave 3 — watermark staleness from `last_memory_seen_at` (max store timestamp) · retrieval.ts · branch: feat/wave-3-retrieval-ranking · U
- [x] T-118 · landed Wave 19 — query-intent bias multipliers · retrieval · PR #274 · U
- [x] T-119 · landed Wave 19 — `effective_score = base × reinforcement × decay` · retrieval · PR #276 · U
- [x] T-120 · landed Wave 19 — RRF weight tuning + A/B · retrieval · PR #278 · U
- [x] T-121 · landed Wave 19 — typed drop/keep reasons per candidate · retrieval · PR #280 · U
- [x] T-122 · landed Wave 19 — L0/L1 abstract sidecars (clean-room MIT implementation) · store · PR #282 · U
- [x] T-123 · landed Wave 19 — ratio-batched sidecar refresh · store · PR #284 · U
- [x] T-124 · landed Wave 19 — resident INDEX route-map · orchestrator · PR #286 · U
- [x] T-125 · landed Wave 19 — tier budgets as named constants with provenance · retrieval, orchestrator · PR #288 · U
- [x] T-126 · landed Wave 3 — `why_retrieved` deterministic reason tokens · retrieval.ts, ranking.ts · branch: feat/wave-3-retrieval-ranking · U
- [x] T-127 · landed Wave 20 — recall→usage telemetry join (`usage_rate` feeds ROI) · quality · PR #291 · U
- [x] T-128 · landed Wave 20 — `[DRAFT]` marking with separate confident-answer key · store · PR #293 · U
- [x] T-129 · landed Wave 20 — config-honesty AST audit (WIRED/DORMANT/UNREAD, build-failing) · new module · PR #295 · U
- [x] T-130 · landed Wave 20 — storage-version compat tests in CI matrix · test · PR #297 · U
- [x] T-131 · landed Wave 20 — honest benchmark labels (measured-vs-claimed) on all published numbers · docs, benchmark · PR #299 · U
- [x] T-132 · landed Wave 20 — constitution contract: rules injected first, trim-exempt, no write tool · orchestrator · PR #301 · U
- [x] T-133 · landed Wave 20 — `degraded − notes` fault signal · retrieval · PR #303 · U
- [x] T-134 · landed Wave 20 — ground-moved reporting for anchors (silent when undeterminable) · anchors · PR #305 · U
- [x] T-135 · landed Wave 20 — tiered retrieval ladder labeling loosened matches · retrieval · PR #307 · U
- [x] T-136 · landed Wave 6 — embeddings engine fingerprint pinning · intelligence/embed · branch: feat/wave-6-embeddings-eval-harness · U
- [x] T-137 · landed Wave 6 — FTS5-floor/vector-upgrade degradation path · retrieval · branch: feat/wave-6-embeddings-eval-harness · U
- [x] T-138 · landed Wave 6 — brute-force cosine in SQLite BLOB (no ANN daemon, ever) · retrieval · branch: feat/wave-6-embeddings-eval-harness · U
- [x] T-139 · landed Wave 6 — `stale_embedder` stamp on reindex-miss entries · store · branch: feat/wave-6-embeddings-eval-harness · U
- [x] T-140 · landed Wave 6 — recall-set grading: must/must-not return, abstention, noise-as-failure · test · branch: feat/wave-6-embeddings-eval-harness · U
- [x] T-141 · landed Wave 6 — frozen benchmark corpus + drift discipline · test · branch: feat/wave-6-embeddings-eval-harness · U
- [x] T-142 · landed Wave 6 — p50 latency reported beside recall scores · benchmark · branch: feat/wave-6-embeddings-eval-harness · U
- [x] T-143 · landed Wave 6 — fixture promotion requires usage telemetry · quality · branch: feat/wave-6-embeddings-eval-harness · U
- [x] T-144 · landed Wave 22 — fix-pair mining (error→command→no-recurrence) → negative-memory candidates · harvester, learning · branch: feat/wave-22-failure-attribution-negative-mining · U

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
- [x] MERGED→T-150 T-167 · wake-gate + breaker wiring into server mode · optimize, store · dep: T-048,T-055 · new · F
- [ ] T-168 · Hermes `MemoryProvider` interface · new module · new · F
- [ ] T-169 · Muse-MCP-backed provider adapter · new module · new · F
- [ ] T-170 · catalog submission (hermesagents plugin registry) · packaging · new · N
- [ ] T-171 · qdrant remote-vector adapter (opt-in, behind Store interface) · store adapters · branch: qdrant-hermes · F
- [ ] T-172 · federation fail-closed probes outside write locks · sync · dep: T-088 · new · F
- [ ] T-173 · observer/observed directional query (concept reimplement — AGPL) · retrieval · new · U
- [ ] T-174 · peer/namespace scoping · store · dep: T-153 · new · U
- [ ] T-175 · reserved slots per peer · orchestrator · new · U
- [ ] T-176 · memory forking/branching · store · branch: feat (R31) · F
- [x] T-177 · landed Wave 21 — pre-mutation 30-snapshot rolling ring buffer before governance/compaction passes · store, snapshot · test/snapshot_ring.test.ts · F
- [ ] T-178 · graph retrieval A/B gate behind eval harness · retrieval · branch: recall-eval-harness · U
- [ ] T-179 · HRR/wikilink expansion — implement only if T-178 shows net gain · retrieval · dep: T-178 · new · U
- [ ] T-180 · funded/shared memory pools spec (Walrus delegation model) · .agents/research · new · N
- [ ] T-181 · memory marketplace spec (permissioned transfer grants) · .agents/research · new · N

## Wave F — R18 DEPRECATIONS (visible externally; docs-level breakage)

- [ ] T-201 · migrator: delete 20 stale detectors BEFORE adapter fallback (stale recognition mis-imports) · migrator/detect.ts · new · F
- [ ] T-202 · platform freeze: deprecate 20 dormant entries, freeze registry · agents/registry.ts · new · F
- [ ] T-203 · `recall` deprecate to alias of unified retrieval · cli, mcp · new · F
- [x] T-204 · **RESOLVED DECISION D1**: safe fix, NOT breaking — principal confirmed nothing outside the repo hand-edits the YAML mirror (CLI/MCP only), so no deprecation window needed · store.ts:174-202 · new · F
- [ ] T-205 · Dockerfile: remove test-on-build stage · Dockerfile:9-11 · new · N
- [x] MERGED→T-015 T-206 · README/CHANGELOG pass for all R18 deprecations · docs · new · N

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

- [x] T-301 · landed #69 — CRITICAL (B1) · get_context read-purity: transcript crawl + `importTranscript`→`propose`→`save` + CURRENT.md rewrite are synchronous inside the read handler (mcp.ts:1611-1624, :1579). Moved to in-process async queue + flush-on-exit · F
- [x] T-302 · landed Wave 14 — HIGH (B15) · `memory_capture` full passthrough: passes evidence, source, verification, dedup, valid_from/to, due_at, expires_at, salience, trust, mem_path, idempotency_key, source_ids · mcp.ts · PR #188 · F
- [x] T-303 · landed #70 — CRITICAL (B3) · `hybridSearch` applies no lifecycle/project filter at >100 entries (vector.ts:159-181, retrieval/engine.ts:127-148) — superseded/archived/expired/cross-project memories filtered at row level · F
- [x] T-304 · landed Wave 14 — HIGH (B4) · vector index invalidation: `save()` incrementally syncs `index.json` via `upsertIndexEntry` and `deleteEntry()` via `removeIndexEntry` · vector.ts, store.ts · PR #190 · F
- [x] T-305 · landed Wave 4 — HIGH (B17) · distillation body cap: `content: obs.raw` stores whole logs as memory bodies (learning/distill.ts:67,:91,:98); `get_context` defaults token_budget to undefined → up to 5 full logs injected · dep: T-092 · branch: feat/wave-4-compaction-distillation · F
- [x] T-306 · landed Wave 4 — HIGH (B16) · observations.jsonl: non-atomic whole-file rewrite per observation (tmp+rename like store.save), rotation + size cap (learning/observation.ts:100-119) · branch: feat/wave-4-compaction-distillation · F
- [x] T-307 · landed Wave 14 — HIGH (B2) · Hebbian graph bounded co-activation (8 seeds, 30 edges/node, 500 nodes max), atomic .tmp rename, candidate expansion in retrieval · plasticity.ts, retrieval/ranking.ts · PR #192 · F

## Wave H — RANKING & FEEDBACK CORRECTNESS

- [x] T-308 · landed #74 — HIGH (B5) · unified ranking scorers: `scoreEntry` and `calculateMultiFactorScore` unified behind single authoritative multi-factor scoring model · F
- [x] T-309 · landed Wave 14 — HIGH (B6) · symbol match is IDF-weighted: downweights generic verbs (get, set) to 0.05, rewards distinctive compound identifiers (SessionManager, auth_token) with 1.0 · retrieval.ts · PR #194 · F
- [x] T-310 · landed Wave 14 — MEDIUM (B7) · word-boundary token matching: matchesWordBoundary prevents substring false matches (race⊂trace, port⊂report, lock⊂deadlock) · retrieval.ts, mesh/resolver.ts, quality/retention.ts · PR #196 · U
- [x] T-311 · landed #74 — HIGH (B8) · unicode-aware tokenization: non-ASCII queries tokenize across scripts and return signal; non-lexical queries penalized · U
- [x] T-312 · landed Wave 14 — HIGH (B9) · FTS failure distinguished from zero-match: returns degraded: true with loud [FTS5_DEGRADED] logging on failure vs degraded: false on 0-hit · sqlite.ts, store.ts, ranking.ts · PR #198 · U
- [x] T-313 · landed Wave 22 — HIGH (B11) · failure attribution: `isRegression = exitCode !== 0` applies to ALL recalled memories; 3 strikes auto-flip confirmed→disputed → drops from sync + confirm() (learning/feedback.ts:30-44, quality/utility.ts:72-79). Scope regression to anchor-relevant memories + decaying counter + corroboration before demotion · dep: T-030 · branch: feat/wave-22-failure-attribution-negative-mining · F
- [x] T-314 · landed Wave 22 — MEDIUM (A2) · source-tagged recall hits `_source ∈ {hot,fts,vector,tree,distilled}` feeding rank — HOT.md is built (compounding/temporal.ts:50) and memoized read with mtime invalidation + relevance bonus · dep: T-028 · branch: feat/wave-22-failure-attribution-negative-mining · U
- [x] T-315 · landed Wave 22 — MEDIUM (A3) · frequency as first-class rank axis (LangMem): logarithmic curve with 2x application weighting and 7-day recency bonus · dep: T-028 · branch: feat/wave-22-failure-attribution-negative-mining · U
- [ ] T-316 · MEDIUM (A4) · promote Hebbian co-activation edges into write-time `linked_memory_ids` seeding + retrieval expansion (A-MEM note-evolution; substrate already written, never read) · dep: T-095 · U
- [ ] T-317 · MEDIUM (A5) · split T-179: query-seeded PPR restart set + A/B on factual-recall-only fixture slice (HippoRAG v1 regressed factual recall) · dep: T-140, T-178 · U
- [ ] T-318 · MEDIUM (A12) · retrieval weight auto-tuner from ROI telemetry, gated behind eval harness (memoria) · dep: T-127, T-140 · U
- [ ] T-319 · MEDIUM (A1) · `is_inference` + `parent_ids` columns; inference down-weight; `memory_review_queue` ordered by support count (Supermemory) — distilled candidates currently rank identical to user-stated facts · dep: T-075 · U

## Wave I — GOVERNANCE & SCALE

- [x] T-320 · landed Wave 23 — HIGH (B10) · contradiction engine calibration: 7 regexes flip BOTH sides to `conflicted` at 0.85 on any 0.4-Jaccard pair (quality/contradiction.ts:15-23,85-114) → −0.8 rank, sync removal, −25 health each = 4 false positives = FAIL. Dry-run mode, negation-pair scoping, calibration fixtures · U
  - Landed: claim-based detection (`src/quality/polarity.ts`, `src/quality/scope.ts`); subject + scope must agree before two claims oppose. Measured 8/10 non-contradictory pairs flagged before, 0/10 after. Dry-run surfaces: `memory conflicts [--dry-run]`, `propose({conflictDryRun})`, `detectConflict(…, {dryRun})`. Calibration fixture `test/calibration/contradiction_calibration.json` gated at precision/recall ≥ 0.9. Commits `18bf4f9`, `dc90539`.
  - Correction to the original ticket text (**superseded 2026-10-22 — the earlier version of this note was wrong**): an earlier revision of this note claimed the "−0.8 rank" penalty does not exist in the ranking engine. **It does exist.** `STATUS_PENALTY` maps `conflicted: -0.8` (`src/types.ts:342`), `src/retrieval.ts:956` reads it into `statusPenalty` and `:1072` adds it to `totalScore`, and `src/retrieval/ranking.ts:6` imports `computeFactors` from `../retrieval.ts` and uses it at `:140` — so **both** retrieval paths penalise conflicted entries by −0.8. What is true is that the penalty is a *soft* rank discount, not a filter: `conflicted` entries are excluded from the status filters in `src/retrieval.ts:1686-1701`, `src/retrieval/ranking.ts:272-273` and `src/orchestrator/context.ts:144-147`, so a genuinely contradicted memory is still injected into agent prompts with no badge. That gap is tracked as **T-405**.
- [x] T-321 · landed Wave 24 — HIGH (B12) · per-project health gate: gate/clustering/tech-debt call `list(store)` unfiltered and label by `entries[0].project` (health/gate.ts:31,220; cognition/clustering.ts:62; tech-debt.ts:102) — one number attributed to whichever memory sorts first · dep: T-153 · U
  - Landed: `listForProject()` in `src/store.ts` is the single owner of the filter decision; the gate, the anchor audit, the drift audit, bug clustering and technical debt all take the same `project` option. The report now carries `scope` (`filter`, `projects`, `entry_count`, `code_scope`) and its `project` label is the requested filter, the sole project present, or `all` — never a guess. Surfaces: `memory health --project P`, `project` on `muse_health`/`muse_tech_debt`/`muse_bug_clusters`, `?project=` on `/api/health`. Commit `60b1aa2`, docs `27bdc81`.
  - **Wave 25 completion (T-321 follow-up)**: a verification audit found the *functions* took `options.project` but five *surfaces* never plumbed it — `memory_anchor_audit` and `memory_drift_audit` (MCP), and `/api/drift`, `/api/cognition/clusters`, `/api/cognition/debt` (studio). A user could scope the health gate but not an anchor or drift audit. All five now take the filter, and the studio gained a labelled **Project Scope** control in the header that drives `/api/health`, `/api/drift`, `/api/cognition/clusters` and `/api/cognition/debt`, seeds from the URL query string (so a scoped link is shareable and reloadable), and renders the report's `scope` back to the user in the CLI's own wording. Cover: `test/health_project_scope_surfaces.test.ts` (7 cases) plus the original `test/health_project_scope.test.ts` (9 cases).
  - Design note: code-side metrics (the technical-debt scan, the doc/code drift audit) stay **workspace-wide** by design — source code is shared between projects and cannot be attributed to one. `scope.code_scope` records this so the number is never misread.
  - Note: the scope field is named `entry_count`, not `memory_count` — the published-claim gate treats any backticked `memory_*` identifier in an agent-facing document as an MCP tool name.
- [ ] T-322 · MEDIUM (B13) · per-file read cache: anchor audit reads every source file 3× per health check (health/gate.ts:82,111,176 → anchors/resolver.ts:121) · U
- [ ] T-323 · MEDIUM (B14) · anchored memories force-injected to front regardless of `anchor.status` + budget ordering (orchestrator/context.ts:104-147) — anchor to a deleted file wins the slot forever · dep: T-134 · U
- [x] T-324 · landed Wave 21 · HIGH (B18) · checkpoint merge semantics: parseCurrentConstraints & mergeCurrentConstraints in compaction handoff; diff-preserving update preserves hand-added constraints · compaction · test/current_compaction_guard.test.ts · F
- [ ] T-325 · MEDIUM (B19) · `rollupTemporal` never filters by its own period — every rollup contains all history (compounding/temporal.ts:120-135) · U
- [ ] T-326 · MEDIUM (B20) · tier 0/1 run the full ranking path (retrieval/tiered.ts:37) — audit D9 named this line; no ticket makes tier 0 cheap or removes it · U
- [ ] T-327 · MEDIUM (B21) · paged candidate source: `list()` = full SELECT * + JSON.parse ×44 call sites (store.ts:220-288); getSyncStatus filters whole store to count; collectNudges calls it twice uncapped · U
- [ ] T-328 · MEDIUM (B22) · real Lamport counter: sync clock is `memories.length + Date.now()` (sync/engine.ts:118-125) — equal counts collide, divergence undetectable · dep: T-044 · U

## Wave J — ECOSYSTEM GAPS NOT YET TICKETIZED

- [ ] T-329 · MEDIUM (A6) · episode table + episode-scoped search + episode stamp on hits (Zep: session_id is indexed at sqlite.ts:157 and never used as a retrieval unit) · U
- [ ] T-330 · MEDIUM (A7) · `absent` memory type ("checked, no X exists") + role scoping user/agent/external/system (Mem0 v3) · U
- [x] MERGED→T-301 T-331 · MEDIUM (A8) · read-tool purity sweep across CLI + MCP: every read command read-only (converges with T-301) · F
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

- [x] T-363 · landed #59 — `src/paths.ts` (`resolveWithin` strict + `resolveExternal` opt-out) applied at wiki/pageindex/pool/mesh boundaries · F
- [x] T-364 · landed #118 — RB-3 · unique-ID seam: `crypto.randomUUID` slice combined with Date.now() prevents same-ms ID collisions in ADRs and PageIndex · adrs/engine.ts, pageindex/engine.ts · F
- [x] T-365 · landed #170 · RB-2 · anchor base normalization at write time: `contracts.ts:113-118` resolves against `topology.rootPath` while `drift.ts:93` resolves the same anchor against `workspaceRoot` — two bases, no normalization; anchor records its own base · blocks drift/mesh/code-impact tickets · F
- [x] T-366 · landed #140 · RB-6 · migrator quarantine: schema-validated intake + quarantine status + strip self-certified `independently-verified` (agentmemory.ts:59-62) + generic adapter never writes `confirmed` · F
- [x] T-367 · **RESOLVED 2026-10-14 — principal decision: zero REQUIRED daemons, opt-in local services allowed.** Charter amends to: no feature may require a running service; `daemon.ts` + studio remain opt-in extras; team-server mode (T-150+) is opt-in per tenant. Residual: add T-379 — amend AGENTS.md + ADR-001 wording from "never depend on background servers" to the amended rule (docs-only) · N
- [x] T-368 · landed #71 — additive migration stamp + backfill (PRAGMA user_version stamp, MIGRATIONS array, backfill from data JSON) · src/migrate.ts · F

## Findings from Nexus audit mode (new tickets T-336..T-362)

**Reject:**
- [x] T-336 · landed #64 — pageindex path traversal: strict containment tests + listPageIndexes guard · src/pageindex/ · F
- [x] T-337 · landed #65 — wiki path traversal: strict containment on slug paths · src/wiki/ · F
- [x] T-338 · landed #142 · F-04 · migrator self-certification: imported data stamped `verification.level:"independently-verified"` with zero verification (migrator/adapters/agentmemory.ts:59-62) · F
- [x] T-339 · landed #144 · F-05 · Letta injection: human/persona core memory marked `isConstraint:true` → verbatim into CURRENT.md (letta.ts:26,38; engine.ts:113-115) — cross-agent instruction injection · F
- [x] T-340 · landed #146 · F-06/F-07 · generic adapter imports junk as confirmed: any JSON object value becomes a memory (generic.ts:21; engine.ts:130); whole .md/.txt/.jsonl files imported wholesale (generic.ts:77-86) · F
- [x] T-341 · landed #120 — F-08 · `memory upgrade --dry-run` respects dryRun: repairInstallation forwards dryRun flag and guards disk mutations · cli/upgrade.ts · F
- [x] T-342 · landed #68 — studio export XSS: escape studio export payload in UI · src/ui.ts · F

**Request Changes:**
- [x] T-343 · landed #122 — F-10 · malformed Host header handled safely with HTTP 400 in Web Studio instead of crashing process · ui.ts · F
- [x] T-344 · landed #124 — F-11 · reject Origin: null in CORS and CSRF checks to prevent sandboxed iframe bypass · ui.ts · F
- [x] T-345 · landed #156 · F-12/F-13 · daemon hardening: server.on("error") rejects without crash, /publish origin validation, active client socket destruction on close, Map-keyed debounce, atomic rename watcher re-arming · daemon.ts · F
- [x] T-346 · landed #158 · F-14 · upgrade CLI exit codes: truthful non-zero exits on check failure, --fail-on-update and --strict support, top-level try/catch wrapper · cli/upgrade.ts · F
- [x] T-347 · landed #132 · F-15 · port-handling contract: integer range validation (1-65535), port 0 ephemeral, auto-increment on collision when port omitted · ui.ts, ecosystem.ts · F
- [x] T-348 · landed #148 · F-16 · migrator false positives: detection = "directory exists"; unexpanded `~` fallback makes `skipped` branch unreachable (detect.ts:22-276; engine.ts:56,70) · F
- [x] T-349 · landed #150 · F-17 · migrator dedup silent: no counter; dry-run doesn't dedupe within batch (dry-run ≠ actual) (engine.ts:105-107,145) · F
- [x] T-350 · landed #160 · F-18/F-19/F-20 · drift endpoint: throwIfNoEntry guards dangling symlinks; precomputed lowercase corpus eliminates scan bottleneck; pure read-path with zero audit mutations · drift.ts · F
- [x] T-351 · landed #66 — mesh anchor path traversal: harden anchor file reads in mesh · src/mesh/ · F
- [x] T-352 · landed #162 · F-22/F-23 · ADR integrity: atomic save-before-supersede eliminates dangling refs; rejected ADR mapped to stale and proposed to candidate · engine.ts · F
- [x] T-353 · landed #134 · F-24 · wiki frontmatter forge: YAML scalar escaping with JSON.stringify for title, tags, and relations · wiki/render.ts · F
- [x] T-354 · landed #136 · F-25 · CLI arg parsing: POSIX `--` terminator, split on first `=` only, negative numbers parsed as values · cli/shared.ts · F
- [x] T-355 · landed #67 — sync pool_dir forwarding: harden pool_dir handling · src/sync/ · F
- [x] T-356 · landed #164 · F-27 · pageindex disclosure-depth: maxDepth pruned node traversal and 3 disclosure tiers (L1, L2, L3) · engine.ts · F
- [x] T-357 · landed #152 · F-28 · migrator status cast: raw provider string → `MemoryStatus` unvalidated; `isLatest !== false` defaults to confirmed (generic.ts:68; agentmemory.ts:44) · F
- [x] T-358 · landed #166 · F-29 · persistent server lifecycle: daemon port integer validation (0-65535) and SIGINT/SIGTERM graceful socket shutdown handlers · cli/ecosystem.ts · F
- [x] T-359 · landed #168 · F-30 · upgrade audit honesty: scanSecrets wired in Vibeguard audit step, storage repair and agent wiring separated, RepairResult.errors populated · cli/upgrade.ts · F
- [x] T-360 · landed #138 · F-31/F-35 · UI shutdown + numeric validation: destroy active sockets on close, bound /api/audit limit & /api/search tokenBudget · ui.ts · F
- [x] T-361 · landed #126 — F-32 · sanitize priority badge class with alphanumeric filter and HTML-escape item.priority in remediation table · ui.ts:2184-2186 · F
- [x] T-362 · landed #154 · F-33/F-34 · migrator dead config + misclassification: `global` never read; `skipped` unreachable; `s.includes("op")` matches loop/topic/propose (types.ts:71; engine.ts:70; drift.ts:12,130) · F

## New tickets from intended mode (claims ↔ evidence)

- [ ] T-369 · benchmark threshold tests: "sub-50 µs" (benchmark/suite.ts:85) and "sub-2ms" claims have NO threshold assertions — `test/benchmark.test.ts:54,58` assert `>= 0`. Either assert real gates or remove the claims (feeds T-131 honesty) · F
- [x] T-370 · docs truth pass (replaces/extend T-015): 80+→52 platforms (×5 README places); "24+ formats"→22 detectors/3 adapters; "29 engines"→same; "61 tools/6 profiles"→107 tools/7 profiles; remove `profile_switch` (0 occurrences); daemon SSE≠WebSocket label; README body 497/84/2190→502/85/2224; current.md #32 "Linus hardening" now complete (T-001 landed #58); capability #15 PARTIAL (`evaluateSessionOutcomes` 0 production callers); #21 PARTIAL (7 phantom profile names); #33 PARTIAL (`maybeAutoOptimize` 0 callers) · N

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
- [ ] T-374 · toBeDefined/tautology assertions → value assertions: `health.test.ts:221-228` (9× toBeDefined on muse_health MCP+CLI), `benchmark.test.ts:47-72` (6× `>= 0` at :50,54,58,66,70,71 — cannot fail) · F
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
- [x] MERGED→T-015 T-379 · amend AGENTS.md invariant "Zero External Daemons: Never depend on background servers" + decisions.md ADR-001 to: "no feature may REQUIRE a background service; local/team services are opt-in" (records the T-367 principal decision) · N

---

# v6 — SENIOR REVIEW RECONCILIATION (2026-10-14)

Two independent senior reviews of the plan (strategic + implementation-executability). Reconciled below; ticket-level corrections applied inline above.

- [x] **V1 RELEASE STRATEGY (was absent)**: `v2.3.1 "trust"` = 12 tickets: **T-001, T-363, T-336, T-337, T-351, T-355, T-342, T-020, T-303, T-368, T-301, T-024** (+ T-015 docs truth). Six weeks, one changelog, one demonstrable number (cache hit rate 0%→>0%; wrong-recall-at-scale fixed). v2.4.0 = remaining Wave 1 + Wave 2 items PROVEN by the R2/R3 baselines. v3.0 = Wave 3, only if a deferred-trigger fires.
- [x] **T-368 RE-SCOPED** (both audits): 20-line stamp, NOT a framework — `PRAGMA user_version` + ordered `{version, up(db)}` array + backfill from the existing `data` JSON blob in the same PR + `doctor` parity check + `tar .memory` snapshot. The YAML mirror (`store.ts:174-202` rehydrates SQLite) IS the rollback. R1 red test (T-383) is its acceptance criterion.
- [x] **T-364 RE-SCOPED**: only `src/adrs/engine.ts:104` + `src/pageindex/engine.ts:34` need same-ms ID guards; `store.ts:347-358` already has one.
- [x] **Wave 3 DEFERRED (30 tickets: T-150-156, T-157-162, T-164-166, T-168-177, T-180, T-181)**: no team customers, no external HTTP consumer; T-332 (sync auth) was dep-on T-150 — auth for a server with no clients. Un-defer trigger: a second concurrent writer observed OR a paying team user. Kept: T-201..T-205 (cheap deprecations).
- [x] **T-163 → RESOLVED DECISION D3**: dashboard KEEPS writes; read-only invariant dropped. When Wave 3 un-defers: guarded writes + T-004 endpoint hardening, not an inspector-only UI.
- [x] **Multi-writer cluster DEFERRED**: T-038, T-039, T-040, T-041, T-042, T-043, T-328 (one principal, one local store). Kept: T-044 flock (~20 lines, protects the real daemon+CLI+MCP multi-process case).
- [x] **Embedding cluster GATED**: T-071, T-136, T-137, T-138, T-139 blocked on T-381 (spike) — the branch has zero implementation files.
- [x] **YAGNI redirects**: T-129 (AST config-honesty) → CI grep for unreferenced exports; T-080/081/088/099/102/122/123/124/125/132/176/180/181 flagged speculative, re-propose only after the v2.4.0 baseline proves need; T-105/106/107 → cut to T-104 + T-105 only.
- [x] **Corrected critical path**: T-001 → T-363 → T-336/337/351/355/342 → T-020 → T-303 → T-368 → T-301/024/025/026/308/311 → **v2.3.1**. T-368 is ON the path (was omitted).
- [x] **Gate claim corrected**: `bunx tsc --noEmit` exits 0, `bun run build` = 374 modules/18ms, `bun test` 502/0/2224/3.29s — full gate runnable today, ~5s/ticket, ~20min total. NOT a blocker (earlier claim wrong).
- [x] **Branch-model reality**: repo default branch is `main`, NOT `master` — `git-workflow.md` lifecycle text does not match; agents must guard `main`/`dev` → decision D2.
- [x] **T-371 lands BEFORE any Wave-0 security red test**: `security_hardening.test.ts:95` synthesized-500 + `:127` `if (store.db)` mean earlier red tests pass trivially.
- [x] T-380 · landed Wave 5 — UI security tests WITHOUT a DOM dep: unit-test the pure `escapeHtml` (`ui.ts:1588`) with `<script>`/quote payloads · branch: feat/wave-5-security-ui-protection · U
- [x] T-381 · landed Wave 6 — embeddings spike: validate llama-cpp local embeddings E2E on the spec branch before ANY of T-071/136/137/138/139 ships · branch: feat/wave-6-embeddings-eval-harness · F
- [ ] T-382 · deprecation policy: `deprecated: true` metadata + alias retention + "removed in vX"; prerequisite for T-201/T-202/T-203 · N
- [x] T-383 · landed #71 — R1 red test: legacy store + added column throws before YAML write, passes after runMigrations · test/migrate.test.ts · F
- [ ] T-384 · R2 fixture: 120 memories / 3 projects / 30 superseded / 30 expired → assert `hybridSearch` returns only matching-project non-superseded rows. Baselines T-303 + T-308 + T-140 at once · F
- [ ] T-385 · R3 baseline: 40 must-return queries from the principal's own `.memory/` + recall-set grading — gate Wave 2 on the number before T-070 ships · F

**Principal decisions — all resolved 2026-10-14:**
- **D2** ✅ RESOLVED: one branch per ticket (`fix/T-xxx`); every commit passes the full gate (bunx tsc --noEmit + bun test + bun run build); merge order follows the corrected critical path; per-file collision serialization at merge (sqlite.ts → store.ts → mcp.ts → retrieval → ui.ts).

- **D1** ✅ RESOLVED: no external YAML editing (CLI/MCP only) → T-204 is a safe fix.
- **D2** ✅ RESOLVED: one branch per ticket; full gate per commit; collisions serialized by file map.
- **D3** ✅ RESOLVED: dashboard keeps writes; read-only invariant dropped; T-004/T-163 scope adjusted.

---

# v7 — TEAM SLICE (trigger fired 2026-10-15)

**Trigger**: principal reports 5 team members on the same network. Wave-3 un-defer condition met ("second concurrent writer observed"). Strategic review's "no team customers" premise is now false — but the need is a *slice*, not the 30-ticket wave.

## The trap to avoid first

**Do NOT put `.memory/` (SQLite) on a shared network mount** (NFS/SMB/network drive) and run five local Muse processes against it. SQLite's WAL lock + shared-memory sidecar files (`-wal`, `-shm`) do not behave on network filesystems: writers see stale shared-memory state and corrupt the index. The DB research lane rejected every distributed-SQLite option for this reason. **Correct topology: exactly one Muse process owns the store** (the host), all five members' agents talk to it as clients.

## Un-deferred slice (7 tickets)

- [x] T-150 · `memory serve`: MCP **Streamable HTTP transport** — one server process owns the store, stdio stays the solo default. **Remote-ready by design** (principal: reach undecided): no localhost hardcoding, TLS-frontable, bind host/port configurable · mcp.ts · F
- [x] T-151 · transport security headers: Origin validation + session id + protocol version (2025-06-18 spec) — scoped to the team server · F
- [x] T-386 · NEW · bearer-token auth + per-peer allowlist on the team server (required for BOTH LAN and remote per principal decision): sync gossip already has **no identity layer** (T-332) and CURRENT.md is a team-wide instruction surface — on a shared network, the Letta CURRENT.md injection defect (F-05) and any pool-write become 5-person poisoning. Not deferrable · F
- [x] T-153 · re-scoped: **team DB file + per-member local DBs**; the server process is the single writer to the team DB (WAL contention is in-process only; no network FS, no multi-writer cluster needed yet) · store, root · F
- [x] T-204 · promoted into the slice: DB-first read precedence now matters (server-side YAML mirror sync across members is the corruption path) · F
- [x] T-368 · promoted into the slice: schema stamp + backfill must land before multiple stores exist · F
- [x] T-387 · NEW · member wiring: docs + client-config recipe (MCP endpoint + token), and the **shared+personal scoping policy** (principal decision 2026-10-15): shared team store holds team facts; per-member local stores hold personal context; promotion to team scope is an explicit member action via the existing local→project→global ladder; CURRENT.md stays shared constraints — every member constraint write is a team-wide rule · N

**Explicitly NOT in the slice** (stays deferred): dashboard rehaul, per-tenant RLS, marketplace/forking, 28 remaining Wave-3 tickets, multi-writer merge cluster (T-038..T-043, T-328) — un-defer only when two *writers to the same store* are observed through the server.

## Ordering

T-204 + T-368 (one day) → T-150 + T-151 + T-386 (the transport, one branch pair) → T-153 (topology) → T-387 (docs). T-001/T-363 land first regardless — a 5-person attack surface makes the RCE and path-primitive tickets pre-reqs for the slice, not optional.

**Team decisions locked (2026-10-15)**: hybrid reach (LAN + remote-ready transport, auth from day one); scoping = shared team store + personal stores, promotion is explicit. Server topology: single owner process, no shared network mounts.

---

# v8 — RESIDUAL-SURFACE AUDIT (2026-10-15)

Source: focused residual hunt over surfaces never covered by R17/R17b/R18/v2/v3/v4 (routines, hooks, claims/provenance, settings, upgrade remainder, ui read routes, harvest schema). Two premises checked and rejected (ui.ts:517 is `/api/sync/broadcast`, not pageindex — zero pageindex calls in ui.ts; no `/api/graph` route exists — canvas feeds from `/api/memories`).

Numbering note: explorer proposed T-386/T-387 — both taken by the v7 team slice (bearer auth / member wiring). Remapped to T-399/T-400. T-388..T-398 were free.

## New tickets

- [x] T-399 · landed Wave 5 — HIGH · `memory routine` step allowlist + re-entrancy guard: `loadRoutines` rejects steps outside `{brief, nudge, recall, compact, distill, verify}`, rejects `-`-prefixed tokens, `runRoutine` throws on depth > 5 · src/routines.ts, src/cli/lifecycle.ts:454 · branch: feat/wave-5-security-ui-protection · F
- [x] T-400 · landed Wave 5 — MEDIUM · ui read routes return projected data: `/api/memories` and `/api/snapshot` use explicit field allowlist matching canvas needs · src/ui.ts · branch: feat/wave-5-security-ui-protection · F
- [x] T-388 · landed Wave 5 — HIGH · hook SessionStart `<muse-memory>` block escapes/strips delimiter + instruction markup from memory content before stdout · src/hooks/pack.ts · branch: feat/wave-5-security-ui-protection · F
- [x] T-389 · landed Wave 5 — MEDIUM · `recordObservation` scans `metadata` (JSON-stringified) with scanSecrets; updated pack.ts docstrings · src/learning/observation.ts, src/hooks/pack.ts · branch: feat/wave-5-security-ui-protection · F
- [x] T-390 · DECISION (N) · `installHookPack` default target `~/.claude/settings.json` vs constitution R1 (never create `~/.claude/`) — needs principal ruling (decided 2026-10-15: global-standard-first, harness opt-in; implementation landed #61) · src/hooks/pack.ts:65, src/connect.ts, AGENTS.md
- [x] T-391 · landed Wave 2 — `recordClaim`/`propose` validate `source_ids` against live registry at write time, derive `verified` · claims, store · branch: feat/wave-2-trust-gates · F
- [x] T-392 · landed Wave 8 (#94) — HIGH · URL validator for `retrieval.embedderUrl` in `validateSettings` (https-only + loopback allowlist; blocks 169.254.169.254 metadata SSRF) · src/settings/schema.ts, src/retrieval/embedders.ts · branch: feat/T-392-embedder-ssrf-validator · F
- [x] T-393 · landed Wave 8 (#96) — MEDIUM · claims/provenance secret-scan gaps: concatenate array fields and metadata objects into scanSecrets template · src/claims.ts, src/provenance.ts · branch: feat/T-393-claims-provenance-secrets · F
- [x] T-394 · landed Wave 8 (#98) — LOW · decorative settings: enforce `mcp.enabledTools` allowlist in ListToolsRequest & CallToolRequest + enforce `imports.secretScanEnabled` in snapshot import · src/settings/, src/mcp.ts, src/snapshot.ts · branch: feat/T-394-enforce-decorative-settings · F
- [x] T-395 · landed Wave 8 (#100) — HIGH · upgrade failure signal: `playPandaLoader` tracks step errors, returns PandaLoaderResult, renders [FAILED], handleUpgradeCommand exits 1 on failure · src/cli/upgrade.ts · branch: fix/T-395-upgrade-failure-signal · F
- [x] T-396 · landed Wave 8 (#102) — MEDIUM · `healBunGlobalConfig` safety: create .bak backup before writing, surface errors via HealBunResult, gate behind explicit opt-in · src/cli/upgrade.ts · branch: fix/T-396-heal-bun-config · F
- [x] T-397 · landed Wave 8 (#104) — LOW · `getLatestNpmVersion` shell injection defense: package name regex validation + one-line execFileSync without shell interpolation · src/cli/upgrade.ts · branch: fix/T-397-npm-version-exec · F
- [x] T-398 · landed Wave 8 (#106) — MEDIUM · `memory_harvest` schema/handler alignment: declare all/auto boolean properties in inputSchema, reject missing text as validation error unless all/auto flag is set · src/mcp.ts · branch: fix/T-398-harvest-schema · F

## Non-findings (checked, rejected)

- ui.ts:517 `body.project` → `broadcastKnowledge` (sync engine), not pageindex; post-T-363 resolveWithin throws ARE caught by mcp.ts:2591 outer catch → toolError. Only residue: :2592 returns err.message raw (absolute-path leak) — folded into T-363 acceptance, no separate ticket.
- No `/api/graph` route among 34 ui.ts routes; R25 projection gap restated as T-400 against the real endpoints.

## Lane ownership (disjoint)

A routines (routines.ts/lifecycle/routines.test) · B hooks (hooks/pack.ts/observation/hooks.test) · C claims (claims/provenance/provenance_claims.test + mcp.ts:2092) · D settings (settings/schema+types/settings.test) · E upgrade (cli/upgrade.test) · F ui projection (ui/ui.test, after T-363 lane releases ui.ts). C↔T-398 both touch mcp.ts → sequence. B↔C share scan-template class → one pass or sequential.

## v8 totals

| Section | Tickets |
|---|---|
| v1+v2+v3+v4+v6+v7 | 251 (246 + T-380-385 + T-386/387 slice) |
| v8 residual | 13 (T-388..T-400, T-390 decision-only) |
| **Plan total** | **264** |

---

# v9 — AUDIT RECONCILIATION & REALIGNED FEATURE WAVES (2026-10-15)

Source: Senior developer & security audit (Nexus quality gate & Muse orchestrator).
Canonical detailed artifact: `.agents/artifacts/audit-and-realigned-roadmap-20261015.md`.

## Landed Reconciliation
21 tickets verified landed on `dev` (#57–#75): `T-001`, `T-020`, `T-024`, `T-025`, `T-026`, `T-030`, `T-031`, `T-032`, `T-301`, `T-303`, `T-308`, `T-311`, `T-336`, `T-337`, `T-342`, `T-351`, `T-355`, `T-363`, `T-368`, `T-383`, `T-390`.

## Newly Discovered Gap Tickets
- [x] T-402 · CRITICAL · `initSchema` column-order fix: guard index creation on `mem_path`, `last_accessed_at`, `access_count` against missing columns so pre-v1 databases migrate smoothly without falling back to flat-file mode · src/sqlite.ts · F
- [x] T-403 · HIGH · Stored-command doctor sweep: sanitize/migrate legacy non-template `test_command`s across `.memory/memories/*.yaml` to restore 100% clean validation · src/doctor.ts, .memory/ · F
- [x] T-404 · HIGH · Stdin TTY decoupling: add `process.stdin.isTTY` check in `src/hooks/pack.ts:readStdinJson()` to prevent test runner hanging in interactive terminals · src/hooks/pack.ts · F
- [x] T-401 · MEDIUM · Bunfig surface hardening: configure explicit test runner timeout and isolation defaults · bunfig.toml · N
- [x] T-405 · HIGH · [#313](https://github.com/harshsinghmp/musememory/issues/313) · Conflicted memories are still injected into agent prompts with no badge: the status filters in `src/retrieval.ts:1686-1701`, `src/retrieval/ranking.ts:272-273` and `src/orchestrator/context.ts:144-147` exclude `superseded`/`rejected`/`archived`/`expired` but not `conflicted`. A contradicted memory is −0.8 rank-penalised (`STATUS_PENALTY`, `src/types.ts:342`) and removed from sync broadcasts, yet it is still served. Note: the gap is **wider** than the original note — three retrieval paths are affected, not one. Needs its own ticket and test pass because it changes retrieval output and therefore the golden recall fixtures · retrieval, orchestrator · U — **LANDED 2026-10-24**: PR #321 (`fix/T-405-conflicted-injection`) merged into `dev` at `e30a1b7`; a single shared `includeConflicted` opt-in now gates every prompt-serving read path (shown wider still by the build-out: tiered context, FTS/gate, vector, engine passthrough, muse pool/lenses all inherit or take the flag); the golden recall fixture was deliberately untouched — the frozen corpus carries zero conflicted entries, verified, so no regen was required; cryptic-suite delta +7 tests (1408/0); Fresh Critic 9.5/10 with a mutation-verified overfetch test.
- [x] T-406 · LOW · [#314](https://github.com/harshsinghmp/musememory/issues/314) · `memory health --project P` matches the project name case-sensitively, so `--project ALPHA` against a store holding `alpha` returns an empty report whose label still reads `ALPHA`. Exact-match is honest but silent. Needs either a case-insensitive match or an explicit "no memories for project X" line · cli/health · U — **LANDED 2026-10-24**: PR #322 (`fix/T-406-case-sensitive-project`) merged into `dev` at `d3a8f6b`; new `src/health/resolve.ts` owns the resolution (`resolveProjectName`: exact wins → unique case-insensitive → loud unresolved), wired on CLI (exit 1 + available list, `--json` stdout kept pure), MCP `muse_health` (isError) and Studio `/api/health` (404 + JSON); the gate stays a pure exact-canonical reporter (scope-case tests untouched); +8 tests (1408/0); Fresh Critic 9/10.
- [x] T-105b · landed Wave 2 — Syntax-only promotion rule: enforce AST/schema verification before candidate confirmation · promotion · branch: feat/wave-2-trust-gates · F

## Realigned In-Line Execution Sequence
1. **Wave 0: Pre-Flight Integrity & Baseline Fixes** (`T-402`, `T-403`, `T-404`, `T-401`, `T-370`)
2. **Wave 1: Storage Engine, Outbox & Concurrency** (`T-041`, `T-042`, `T-044`, `T-038`, `T-040`, `T-056`, `T-055`)
3. **Wave 2: Write Admission, Trust & Anti-Poisoning** (`T-104`, `T-105`, `T-105b`, `T-075`, `T-058`, `T-103`, `T-391`)
4. **Wave 3: Retrieval Quality, Ranking & Token Economics** (`T-035`, `T-036`, `T-037`, `T-060`, `T-061`, `T-070`, `T-114`, `T-115`, `T-117`, `T-126`)
5. **Wave 4: Compaction, Ephemeral Observations & Distillation** (`T-045`, `T-046`, `T-047`, `T-053`, `T-054`, `T-091`, `T-092`, `T-093`, `T-094`, `T-305`, `T-306`)
6. **Wave 5: Security Hardening & UI Protection** (`T-002`, `T-004`, `T-388`, `T-389`, `T-399`, `T-400`, `T-380`)
7. **Wave 6: Semantic Embeddings & Eval Harness** (`T-381`, `T-071`, `T-136`–`T-139`, `T-140`–`T-143`) — [x] Landed on dev
8. **Wave 7: Team Slice (On-Demand / Opt-In)** (`T-150`, `T-151`, `T-386`, `T-153`, `T-387`) — [x] Landed on dev
9. **Wave 8: Residual Surfaces Audit** (`T-392`, `T-393`, `T-394`, `T-395`, `T-396`, `T-397`, `T-398`) — [x] Landed on dev
10. **Wave 9: Runtime Integrity, Seams & Drift Elimination** (`T-010`, `T-011`, `T-012`, `T-364`, `T-341`, `T-343`, `T-344`, `T-361`) — [x] Landed on dev
11. **Wave 10: CLI Rigor, Governance & Hardened Parsers** (`T-013`, `T-014`, `T-347`, `T-353`, `T-354`, `T-360`) — [x] Landed on dev
12. **Wave 11: Migrator Quarantine, Anti-Poisoning & Validation Hardening** (`T-366`, `T-338`, `T-339`, `T-340`, `T-348`, `T-349`, `T-357`, `T-362`) — [x] Landed on dev
13. **Wave 12: Daemon Reliability, Upgrade Signals & Living Decisions** (`T-345`, `T-346`, `T-350`, `T-352`, `T-356`, `T-358`, `T-359`, `T-365`) — [x] Landed on dev
14. **Wave 13: Retrieval Performance & Store Hot-Paths** (`T-021`, `T-022`, `T-023`, `T-028`, `T-029`, `T-062`, `T-063`, `T-064`) — [x] Landed on dev
15. **Wave 14: Invalidation, Attribution & Ranking Rigor** (`T-302`, `T-304`, `T-307`, `T-309`, `T-310`, `T-312`) — [x] Landed on dev
16. **Wave 15: Expiry, Decay & Confidence Hardening** (`T-072`, `T-073`, `T-074`, `T-076`–`T-081`) — [x] Landed on dev
17. **Wave 16: Temporal Transitions, Contradiction Engine & Verbs** (`T-082`–`T-090`) — [x] Landed on dev
18. **Wave 17: Packing, Graph, Lineage & Provenance** (`T-095`–`T-102`) — [x] Landed on dev
19. **Wave 18: Ingestion, Suppression & Curation Gates** (`T-106`–`T-113`) — [x] Landed on dev
20. **Wave 19: Scoring Refinements & Abstract Sidecars** (`T-118`–`T-125`) — [x] Landed on dev
21. **Wave 20: Quality Telemetry, Honesty Gates & Retrieval Fault Signals** (`T-127`–`T-135`) — [x] Landed on dev

## v12 Totals
| Section | Tickets |
|---|---|
| Total Tracked Tickets | 290 |
| Landed on dev | 212 |
| Active Remaining | 78 |


