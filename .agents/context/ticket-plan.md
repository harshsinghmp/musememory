# 🎫 Exploded Ticket Plan — R17b + R18 (generated 2026-10-14)

> Every atomic deliverable from the 50-item catalog and the retirement audit, as its own ticket.
> Source of truth: `.agents/research/ecosystem-teardown-2026-10.md` §10 + `.agents/research/retirement-audit-2026-10.md`.
> Gate legend: `U` = unit test · `F` = full gate (bun test + tsc --noEmit + bun run build) · `N` = none (docs/spec only).
> Branch column maps to existing spec branches on `docs/roadmap-memory-upgrades` and existing `feat/*` branches; `new` = not yet covered.

---

## Wave A — SECURITY (do first; outranks every feature)

- [x] T-001 · landed #58 — template-gated test_command (fixed argv templates, no shell), `verify_refused` audit · src/verify.ts · F
- [ ] T-002 · UI XSS: escape `p.title`/`p.slug` interpolation · ui.ts:1510 · new · F
- [x] MERGED→T-002 T-003 · UI XSS: escape `r.entry_id`/`r.actor` interpolation · ui.ts:1557 · new · F
- [ ] T-004 · UI optimizer gate: `POST /api/optimize` requires dry-run default + localhost/token check · ui.ts:362 · new · F

## Wave B — DRIFT (free fixes; no runtime path changes)

- [ ] T-010 · profiles.ts: remove 7 phantom tool names (record_observation, capture_negative, conflict_detect, wiki_page, tree_index, dedup, audit_query) · orchestrator/profiles.ts · new · F
- [ ] T-011 · connect.ts: retire ALL_MEMORY_TOOLS allowlist (auto-approves 3 phantom; MEASURED: 71 registered tools absent) · connect.ts:9-50 · new · F
- [ ] T-012 · delete `maybeAutoOptimize` (0 callers) · optimize.ts:362 · new · F
- [ ] T-013 · retire unreachable LSP tier; keep provider slot in chain signature · src/intelligence/adapters/lsp.ts:14 · new · F
- [ ] T-014 · delete 4 unused registry methods + `registerProvider` + 3 dead governor exports · registry.ts:68-117, governor.ts · new · F
- [x] T-015 · docs truth pass: README 80+→52 platforms, daemon SSE≠WebSocket, remove profile_switch · README, docs · new · N

## Wave C — P0 RELIABILITY (v2.4.0)

- [x] T-020 · landed #73 — query-cache self-destruction fix (writes no longer poison read cache) · store.ts:281 vs cache.ts:124/212 · F
- [ ] T-021 · memoized file verification in ranking hot path · retrieval.ts:199-204 · new · F
- [ ] T-022 · precomputed token sets per memory (drop per-query retokenization) · retrieval.ts · new · F
- [ ] T-023 · `openStore` dirty-gate: skip wiki recompile + CURRENT.md sync per MCP call · store.ts openStore · new · F
- [x] T-024 · landed #73 — bounded FTS preflight (cap term count; reject oversized queries) · store.ts · F
- [x] T-025 · landed #73 — single-transaction writes (replace 3-commit paths; ~180ms→~60ms) · store.ts · F
- [x] T-026 · landed #73 — FTS↔row parity check + repair command · store.ts · F
- [ ] T-016 · dispatch-coverage matrix: 64/107 MCP tools referenced by NO test (T-016 was referenced but never defined — plan's largest coverage hole had no ticket). Ships with Wave 5; T-371 lands first · F
- [x] RESOLVED (intended lane): `dedup` IS wired at store.ts:418 — only memory_capture omits it; scope folded into T-027 note + T-040 covers the missing normalization · mcp.ts:55, quality · new · F
- [ ] T-028 · `recordRetrievals`: wire into recall or delete · mcp.ts:1692, quality · new · F
- [ ] T-029 · `touchActivity`: wire into store or delete · optimize.ts:77 · new · F
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
- [ ] T-050 · overnight loss guard: snapshot entry-head hashes; >25% loss → alert-only · optimize · new · F
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
- [ ] T-062 · clamp model-supplied `limit` values · mcp tools · new · F
- [ ] T-063 · dry-run-by-default, point-id-only destructive ops · mcp, cli · new · F
- [ ] T-064 · read-path `stale:true` provenance tag for degraded/cache reads · retrieval · new · F

## Wave D — P1 MEMORY QUALITY (v2.5.0)

### Abstention + decay
- [x] T-070 · landed Wave 3 — IDF-weighted relevance gate before FTS5 (0.3 threshold, identifier-decisive, greeting short-circuit) · retrieval.ts, ranking.ts · branch: feat/wave-3-retrieval-ranking · U
- [ ] T-071 · dual calibrated thresholds (cosine max + BM25 min, engine-pinned constants) · retrieval · branch: local-embeddings-llama-cpp · U
- [ ] T-072 · FTS5-tokenizer-matched abstention gate · retrieval · new · U
- [ ] T-073 · `no_confident_match` result mode · retrieval, mcp · new · U
- [ ] T-074 · materialized `decay_score` column, importance-gated half-lives · schema, retrieval · new · U
- [x] T-075 · landed Wave 2 — veracity tiers & ingest trust tiers (trusted/candidate/untrusted) · schema, store, retrieval · branch: feat/wave-2-trust-gates · U
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
- [x] T-091 · landed Wave 4 — TOON-style row-wise context-pack compaction (verify 77.6% claim ourselves) · orchestrator · branch: feat/wave-4-compaction-distillation · U
- [x] T-092 · landed Wave 4 — never-drop manifest TOC + descending summary caps (entry line never omitted) · orchestrator · branch: feat/wave-4-compaction-distillation · U
- [x] T-093 · landed Wave 4 — truncation order pin > provenance > recency > salience + `[N omitted — budget M]` marker · orchestrator · branch: feat/wave-4-compaction-distillation · U
- [x] T-094 · landed Wave 4 — reserved slots for global/USER.md-class entries · orchestrator · branch: feat/wave-4-compaction-distillation · U
- [ ] T-095 · `linked_memory_ids` write-time edges seeded during capture · schema, store · new · U
- [ ] T-096 · supersede-not-delete + hidden-count-aware over-fetch · store, retrieval · branch: memory-tombstones · U
- [ ] T-097 · `prefer_observations` recall-time dedup, top-2×budget scope · retrieval · new · U
- [ ] T-098 · progressive wikilink expansion after fusion · retrieval · new · U
- [ ] T-099 · `fact_provenance` append-only table, triple-unique index · schema, store · new · U
- [ ] T-100 · `supersedes_id`/`conflicts_with_id` lineage FKs · schema · new · U
- [ ] T-101 · lineage BFS walker · store · new · U
- [ ] T-102 · hash-chained audit (per-day salt) + session Merkle checkpoints · audit · new · U
- [x] T-103 · landed Wave 2 — index-time credential redaction keeping text searchable · sqlite, store · branch: feat/wave-2-trust-gates · U

### Gates + hygiene
- [x] T-104 · landed Wave 2 — `scoreRetain` 0.3 write gate (refuse junk writes) · quality/retention, store · branch: feat/wave-2-trust-gates · U
- [x] T-105 · landed Wave 2 — corroboration-gated promotion (≥2 independent days; machine sources excluded) · promotion · branch: feat/wave-2-trust-gates · U
- [ ] T-106 · curator concept: agent appends evidence, deterministic promotion decides · promotion · new · U
- [ ] T-107 · two-tier promotion (pending tier → session-end flush) · promotion · new · U
- [ ] T-108 · re-injection suppression per session (6-turn LRU) · retrieval · new · U
- [ ] T-109 · self-echo suppression via capture-side provenance (age-bounded) · retrieval · new · U
- [ ] T-110 · `<memory-context>`/injected-block strip before capture · harvester, store · branch: poisoning-trust-tiers · U
- [ ] T-111 · seen-chunk TTL · retrieval · new · U
- [ ] T-112 · topic-overlap >0.6 prefetch skip · retrieval · new · U
- [ ] T-113 · trivial-prompt gate (skip recall for greetings) · orchestrator · new · U
- [x] T-114 · landed Wave 3 — soft-OR evidence fusion `P=1-(1-pv)(1-pl)` · ranking.ts, vector.ts · branch: feat/wave-3-retrieval-ranking · U
- [x] T-115 · landed Wave 3 — `low_discrimination()` conditional rerank (tier/verification/recency tie-breaker) · retrieval.ts, ranking.ts · branch: feat/wave-3-retrieval-ranking · U
- [x] MERGED→T-071 T-116 · semantic threshold gate BEFORE BM25/entity fusion · retrieval · branch: local-embeddings-llama-cpp · U
- [x] T-117 · landed Wave 3 — watermark staleness from `last_memory_seen_at` (max store timestamp) · retrieval.ts · branch: feat/wave-3-retrieval-ranking · U
- [ ] T-118 · query-intent bias multipliers · retrieval · new · U
- [ ] T-119 · `effective_score = base × reinforcement × decay` · retrieval · new · U
- [ ] T-120 · RRF weight tuning + A/B · retrieval · branch: recall-eval-harness · U
- [ ] T-121 · typed drop/keep reasons per candidate · retrieval · new · U
- [ ] T-122 · L0/L1 abstract sidecars (reimplement; source is AGPL) · store · new · U
- [ ] T-123 · ratio-batched sidecar refresh · store · new · U
- [ ] T-124 · resident INDEX route-map · orchestrator · branch: io-budget-telemetry · U
- [ ] T-125 · tier budgets as named constants with provenance · retrieval, orchestrator · branch: io-budget-telemetry · U
- [x] T-126 · landed Wave 3 — `why_retrieved` deterministic reason tokens · retrieval.ts, ranking.ts · branch: feat/wave-3-retrieval-ranking · U
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
- [ ] T-177 · safety snapshots before governance passes · store · new · F
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
- [ ] T-302 · HIGH (B15) · `memory_capture` full passthrough: currently sets 7 of ~40 propose options (no evidence/source/verification/dedup/validFrom/expiresAt) — provenance tickets T-075/090/099/103/105 assume write-time capture that the flagship tool cannot express · mcp.ts:1692-1699 · dep: T-075 · F
- [x] T-303 · landed #70 — CRITICAL (B3) · `hybridSearch` applies no lifecycle/project filter at >100 entries (vector.ts:159-181, retrieval/engine.ts:127-148) — superseded/archived/expired/cross-project memories filtered at row level · F
- [ ] T-304 · HIGH (B4) · vector index invalidation: `save()` never updates `index.json` (retrieval/engine.ts:124-127, store.ts:306); MCP hardcodes `stale:false` while serving ancient snapshots (mcp.ts:1683) · dep: T-064 · F
- [x] T-305 · landed Wave 4 — HIGH (B17) · distillation body cap: `content: obs.raw` stores whole logs as memory bodies (learning/distill.ts:67,:91,:98); `get_context` defaults token_budget to undefined → up to 5 full logs injected · dep: T-092 · branch: feat/wave-4-compaction-distillation · F
- [x] T-306 · landed Wave 4 — HIGH (B16) · observations.jsonl: non-atomic whole-file rewrite per observation (tmp+rename like store.save), rotation + size cap (learning/observation.ts:100-119) · branch: feat/wave-4-compaction-distillation · F
- [ ] T-307 · HIGH (B2) · Hebbian graph is write-only O(n²) per recall (plasticity.ts:37-64, mcp.ts:1611): n(n-1) edges + full-file rewrite every get_context; loaders have zero production callers. Bound it, make it incremental, consume it (see T-316) — or delete · F

## Wave H — RANKING & FEEDBACK CORRECTNESS

- [x] T-308 · landed #74 — HIGH (B5) · unified ranking scorers: `scoreEntry` and `calculateMultiFactorScore` unified behind single authoritative multi-factor scoring model · F
- [ ] T-309 · HIGH (B6) · symbol match is binary and IDF-free: `` `get` `` in tags beats all lexically-relevant memories for any query containing "get" (ranking.ts:87-96). IDF-weighted term; T-070's gate covers the FTS prefilter, not this · F
- [ ] T-310 · MEDIUM (B7) · word-boundary token matching: `entryText.includes(token)` matches race⊂trace, port⊂report (ranking.ts:62-66) · U
- [x] T-311 · landed #74 — HIGH (B8) · unicode-aware tokenization: non-ASCII queries tokenize across scripts and return signal; non-lexical queries penalized · U
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
- [ ] T-364 · RB-3 · unique-ID seam: `crypto.randomUUID` (or DB UNIQUE + collision retry) behind one id-generator; current `Date.now()` ids (adrs/engine.ts:104, pageindex/engine.ts:34) collide same-millisecond with no constraint to reject · blocks T-038, T-041, T-044, T-328 and every parallel-writer ticket · F
- [ ] T-365 · RB-2 · anchor base normalization at write time: `contracts.ts:113-118` resolves against `topology.rootPath` while `drift.ts:93` resolves the same anchor against `workspaceRoot` — two bases, no normalization; anchor records its own base · blocks drift/mesh/code-impact tickets · F
- [ ] T-366 · RB-6 · migrator quarantine: schema-validated intake + quarantine status + strip self-certified `independently-verified` (agentmemory.ts:59-62) + generic adapter never writes `confirmed` · blocks T-338, T-339, T-340 · F
- [x] T-367 · **RESOLVED 2026-10-14 — principal decision: zero REQUIRED daemons, opt-in local services allowed.** Charter amends to: no feature may require a running service; `daemon.ts` + studio remain opt-in extras; team-server mode (T-150+) is opt-in per tenant. Residual: add T-379 — amend AGENTS.md + ADR-001 wording from "never depend on background servers" to the amended rule (docs-only) · N
- [x] T-368 · landed #71 — additive migration stamp + backfill (PRAGMA user_version stamp, MIGRATIONS array, backfill from data JSON) · src/migrate.ts · F

## Findings from Nexus audit mode (new tickets T-336..T-362)

**Reject:**
- [x] T-336 · landed #64 — pageindex path traversal: strict containment tests + listPageIndexes guard · src/pageindex/ · F
- [x] T-337 · landed #65 — wiki path traversal: strict containment on slug paths · src/wiki/ · F
- [ ] T-338 · F-04 · migrator self-certification: imported data stamped `verification.level:"independently-verified"` with zero verification (migrator/adapters/agentmemory.ts:59-62) · dep: T-366 · F
- [ ] T-339 · F-05 · Letta injection: human/persona core memory marked `isConstraint:true` → verbatim into CURRENT.md (letta.ts:26,38; engine.ts:113-115) — cross-agent instruction injection · dep: T-366 · F
- [ ] T-340 · F-06/F-07 · generic adapter imports junk as confirmed: any JSON object value becomes a memory (generic.ts:21; engine.ts:130); whole .md/.txt/.jsonl files imported wholesale (generic.ts:77-86) · dep: T-366 · F
- [ ] T-341 · F-08 · `memory upgrade --dry-run` still rewires agents: step 3 unguarded `repairInstallation` hardcodes `dryRun:false` (cli/upgrade.ts:524,359) · F
- [x] T-342 · landed #68 — studio export XSS: escape studio export payload in UI · src/ui.ts · F

**Request Changes:**
- [ ] T-343 · F-10 · malformed Host header crashes dashboard: `new URL(req.url, "http://"+req.headers.host)` outside try → unhandled rejection → exit(1) (ui.ts:42; bin/memory.ts:4) · F
- [ ] T-344 · F-11 · `origin === "null"` classified local, echoed into CORS (ui.ts:56,59) — sandboxed iframe gets full read+write · F
- [ ] T-345 · F-12/F-13 · daemon hardening: no `server.on("error")` (EADDRINUSE crashes), `/publish` no origin check, client sockets leaked (daemon.ts:36-78,87), shared debounce collapses watcher events, watchers never re-armed · F
- [ ] T-346 · F-14 · upgrade CLI exit codes: zero non-zero exits in 558 LOC; CI cannot distinguish success from failure (cli/upgrade.ts:498) · F
- [ ] T-347 · F-15 · port-handling contract broken: auto-increment path dead (ecosystem.ts:443 always passes port); `--port abc` → NaN → random port (ui.ts:613) · F
- [ ] T-348 · F-16 · migrator false positives: detection = "directory exists"; unexpanded `~` fallback makes `skipped` branch unreachable (detect.ts:22-276; engine.ts:56,70) · F
- [ ] T-349 · F-17 · migrator dedup silent: no counter; dry-run doesn't dedupe within batch (dry-run ≠ actual) (engine.ts:105-107,145) · F
- [ ] T-350 · F-18/F-19/F-20 · drift endpoint: unguarded statSync 500s on dangling symlink; O(exports × memories) substring scan; a READ appends audit events (drift.ts:27,139-144,178-191) · F
- [x] T-351 · landed #66 — mesh anchor path traversal: harden anchor file reads in mesh · src/mesh/ · F
- [ ] T-352 · F-22/F-23 · ADR integrity: supersede-before-save leaves dangling ref on failure; rejected ADR stored as confirmed (engine.ts:148,162-165,191) · F
- [ ] T-353 · F-24 · wiki frontmatter forge: unescaped memory title/tags interpolated into YAML scalars (wiki/render.ts:6,10,13,31; read back at compiler.ts:487) · F
- [ ] T-354 · F-25 · CLI arg parsing: `--k=a=b` truncates; `--limit -1` parses as flag; no `--` terminator (cli/shared.ts:17,20) · F
- [x] T-355 · landed #67 — sync pool_dir forwarding: harden pool_dir handling · src/sync/ · F
- [ ] T-356 · F-27 · pageindex disclosure-depth is a no-op: `maxDepth`/`disclosureDepth` accepted, never used (engine.ts:124-125 vs 137-165) · F
- [ ] T-357 · F-28 · migrator status cast: raw provider string → `MemoryStatus` unvalidated; `isLatest !== false` defaults to confirmed (generic.ts:68; agentmemory.ts:44) · F
- [ ] T-358 · F-29 · ADR-001 violation: `handleDaemonCommand` returns never-resolving promise + second blocking server (cli/ecosystem.ts:507) · dep: T-367 · F
- [ ] T-359 · F-30 · upgrade stubs render ✅ for empty audit steps; 35 empty `catch {}` in cli/ (upgrade.ts:507-509,530-532) · F
- [ ] T-360 · F-31/F-35 · UI shutdown + numeric validation: keep-alive sockets block close (ui.ts:626); unvalidated parseInt limits (ui.ts:209,613) · F
- [ ] T-361 · F-32 · escapeHtml omits `'`; `item.priority` unescaped into class attribute (ui.ts:1588 (omits ') + :2092/:2094) · F
- [ ] T-362 · F-33/F-34 · migrator dead config + misclassification: `global` never read; `skipped` unreachable; `s.includes("op")` matches loop/topic/propose (types.ts:71; engine.ts:70; drift.ts:12,130) · F

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
- [ ] T-380 · UI security tests WITHOUT a DOM dep: unit-test the pure `escapeHtml` (`ui.ts:1588`) with `<script>`/quote payloads — zero `escapeHtml` occurrences exist in test/, no DOM dependency exists; render-level tests deferred pending D3 · U
- [ ] T-381 · embeddings spike: validate llama-cpp local embeddings E2E on the spec branch before ANY of T-071/136/137/138/139 ships · F
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

- [ ] T-150 · `memory serve`: MCP **Streamable HTTP transport** — one server process owns the store, stdio stays the solo default. **Remote-ready by design** (principal: reach undecided): no localhost hardcoding, TLS-frontable, bind host/port configurable · mcp.ts · F
- [ ] T-151 · transport security headers: Origin validation + session id + protocol version (2025-06-18 spec) — scoped to the team server · F
- [ ] T-386 · NEW · bearer-token auth + per-peer allowlist on the team server (required for BOTH LAN and remote per principal decision): sync gossip already has **no identity layer** (T-332) and CURRENT.md is a team-wide instruction surface — on a shared network, the Letta CURRENT.md injection defect (F-05) and any pool-write become 5-person poisoning. Not deferrable · F
- [ ] T-153 · re-scoped: **team DB file + per-member local DBs**; the server process is the single writer to the team DB (WAL contention is in-process only; no network FS, no multi-writer cluster needed yet) · store, root · F
- [ ] T-204 · promoted into the slice: DB-first read precedence now matters (server-side YAML mirror sync across members is the corruption path) · F
- [ ] T-368 · promoted into the slice: schema stamp + backfill must land before multiple stores exist · F
- [ ] T-387 · NEW · member wiring: docs + client-config recipe (MCP endpoint + token), and the **shared+personal scoping policy** (principal decision 2026-10-15): shared team store holds team facts; per-member local stores hold personal context; promotion to team scope is an explicit member action via the existing local→project→global ladder; CURRENT.md stays shared constraints — every member constraint write is a team-wide rule · N

**Explicitly NOT in the slice** (stays deferred): dashboard rehaul, per-tenant RLS, marketplace/forking, 28 remaining Wave-3 tickets, multi-writer merge cluster (T-038..T-043, T-328) — un-defer only when two *writers to the same store* are observed through the server.

## Ordering

T-204 + T-368 (one day) → T-150 + T-151 + T-386 (the transport, one branch pair) → T-153 (topology) → T-387 (docs). T-001/T-363 land first regardless — a 5-person attack surface makes the RCE and path-primitive tickets pre-reqs for the slice, not optional.

**Team decisions locked (2026-10-15)**: hybrid reach (LAN + remote-ready transport, auth from day one); scoping = shared team store + personal stores, promotion is explicit. Server topology: single owner process, no shared network mounts.

---

# v8 — RESIDUAL-SURFACE AUDIT (2026-10-15)

Source: focused residual hunt over surfaces never covered by R17/R17b/R18/v2/v3/v4 (routines, hooks, claims/provenance, settings, upgrade remainder, ui read routes, harvest schema). Two premises checked and rejected (ui.ts:517 is `/api/sync/broadcast`, not pageindex — zero pageindex calls in ui.ts; no `/api/graph` route exists — canvas feeds from `/api/memories`).

Numbering note: explorer proposed T-386/T-387 — both taken by the v7 team slice (bearer auth / member wiring). Remapped to T-399/T-400. T-388..T-398 were free.

## New tickets

- [ ] T-399 · (was proposed T-386) HIGH · `memory routine` step allowlist + re-entrancy guard: `loadRoutines` rejects steps outside `{brief, nudge, recall, compact, distill, verify}`, rejects `-`-prefixed tokens, `runRoutine` throws on depth > 5 · src/routines.ts, src/cli/lifecycle.ts:454 · F (cron fires unattended; planted routines.yaml = host mutation via upgrade/connect/hooks steps; self-`routine run` = unbounded recursion)
- [ ] T-400 · (was proposed T-387) MEDIUM · ui read routes return unprojected data: `/api/memories` (ui.ts:1436) ships full `MemoryEntry[]`, `/api/snapshot` ships `exportSnapshot` — add explicit field allowlist matching canvas needs · src/ui.ts · F
- [ ] T-388 · HIGH · hook SessionStart `<muse-memory>` block must escape/strip delimiter + instruction markup from memory content before stdout (poisoned constraint breaks block, re-primes next session; T-058/T-339 don't cover this sink) · src/hooks/pack.ts:198-210, src/secrets.ts · F
- [ ] T-389 · MEDIUM · `recordObservation` must scan `metadata` (JSON-stringified), not just summary+raw; fix false "Vibeguard-scanned" docstring at pack.ts:216 (tool_name/session_id from unvalidated stdin JSON) · src/learning/observation.ts:30, src/hooks/pack.ts · F
- [x] T-390 · DECISION (N) · `installHookPack` default target `~/.claude/settings.json` vs constitution R1 (never create `~/.claude/`) — needs principal ruling (decided 2026-10-15: global-standard-first, harness opt-in; implementation landed #61) · src/hooks/pack.ts:65, src/connect.ts, AGENTS.md
- [x] T-391 · landed Wave 2 — `recordClaim`/`propose` validate `source_ids` against live registry at write time, derive `verified` · claims, store · branch: feat/wave-2-trust-gates · F
- [ ] T-392 · HIGH · URL validator for `retrieval.embedderUrl` in `validateSettings` (https-only + private/loopback/link-local block; SSRF via memory_settings_set → 169.254.169.254 today). Caveat: `cli/embed.ts:19` documents `http://127.0.0.1:8081/v1` as the intended local endpoint — needs explicit local opt-in flag, NOT a blanket reject (validateSafePath is the wrong tool) · src/settings/schema.ts:20-36, src/embedders.ts:55,137-143 · F
- [ ] T-393 · MEDIUM · claims/provenance secret-scan gaps: concatenate array fields into scanSecrets template (3rd instance of the class: observation metadata, verify.ts, now claims.ts:45 + provenance.ts:46) · F
- [ ] T-394 · LOW · decorative settings: `mcp.enabledTools` (types.ts:69) + `imports.secretScanEnabled` (types.ts:85) declared, defaulted, never read — enforce or delete (kill-switch that provably does nothing) · src/settings/, src/mcp.ts dispatch · F
- [ ] T-395 · HIGH · upgrade failure signal: `playPandaLoader` swallows step throws (:276-284) yet prints LEVEL-UP COMPLETE + exit 0 — track failure, non-zero exit, no success banner (sequence after T-346 exit-code plumbing) · src/cli/upgrade.ts · F
- [ ] T-396 · MEDIUM · `healBunGlobalConfig` rewrites host-global bun package.json with no .bak, errors swallowed (:419), fires implicitly — backup + surface errors + opt-in gate · src/cli/upgrade.ts:402-429 · F
- [ ] T-397 · LOW · `getLatestNpmVersion` shell template `execSync(\`npm show ${packageName} version\`)` — unreachable today (only no-arg caller) but exported trap; one-line execFileSync · src/cli/upgrade.ts:150,166 · F
- [ ] T-398 · MEDIUM · `memory_harvest` schema/handler mismatch: `all`/`auto` undeclared in inputSchema (:258-266) yet `!a.text` triggers full transcript sweep (:1722) — missing text must be validation error · src/mcp.ts · F

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
- [x] T-105b · landed Wave 2 — Syntax-only promotion rule: enforce AST/schema verification before candidate confirmation · promotion · branch: feat/wave-2-trust-gates · F

## Realigned In-Line Execution Sequence
1. **Wave 0: Pre-Flight Integrity & Baseline Fixes** (`T-402`, `T-403`, `T-404`, `T-401`, `T-370`)
2. **Wave 1: Storage Engine, Outbox & Concurrency** (`T-041`, `T-042`, `T-044`, `T-038`, `T-040`, `T-056`, `T-055`)
3. **Wave 2: Write Admission, Trust & Anti-Poisoning** (`T-104`, `T-105`, `T-105b`, `T-075`, `T-058`, `T-103`, `T-391`)
4. **Wave 3: Retrieval Quality, Ranking & Token Economics** (`T-035`, `T-036`, `T-037`, `T-060`, `T-061`, `T-070`, `T-114`, `T-115`, `T-117`, `T-126`)
5. **Wave 4: Compaction, Ephemeral Observations & Distillation** (`T-045`, `T-046`, `T-047`, `T-053`, `T-054`, `T-091`, `T-092`, `T-093`, `T-094`, `T-305`, `T-306`)
6. **Wave 5: Security Hardening & UI Protection** (`T-002`, `T-004`, `T-388`, `T-389`, `T-399`, `T-400`, `T-380`)
7. **Wave 6: Semantic Embeddings & Eval Harness** (`T-381`, `T-071`, `T-136`–`T-139`, `T-140`–`T-143`)
8. **Wave 7: Team Slice (On-Demand / Opt-In)** (`T-150`, `T-151`, `T-386`, `T-153`, `T-387`)

## v9 Totals
| Section | Tickets |
|---|---|
| Total Tracked Tickets | 290 |
| Landed on dev | 88 |
| Active Remaining | 202 |

