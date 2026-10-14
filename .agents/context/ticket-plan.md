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
