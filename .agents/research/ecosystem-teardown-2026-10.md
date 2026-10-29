# Competitive Ecosystem Teardown & Improvement Catalog — 2026-10-14

**Milestone R17 (extended).** Inputs: principal's 69-URL list (Hermes plugin ecosystem + major OSS memory systems), Hermes platform docs, DB/transport research for server mode, plus the prior Walrus/SOTA brief.
**Branches**: `feat/docs-memory-arch-roadmap-walrus` · Baseline `bun test`: 502 pass / 0 fail / 85 suites.
**Method**: REA-derived methodology (question checklist, evidence → inference → unknown tiers, bounded negative search). All web lanes ran in dedicated subagents; this parent session stayed write-clean. Verdicts are mechanism-level; licenses honored per-repo (AGPL/BSL/PolyForm/proprietary = idea-only, reimplement).

---

## 1. Headline Conclusions

1. **The Hermes plugin ecosystem is a vendor land grab, not a competitor set**: ~48 plugins surveyed, nearly all 0–16 stars, all created Jun–Oct 2026, 12+ of them are thin HTTP shims for hosted SaaS (penny, dexio, hicortex, cortexlayer, metronix, hydradb, pastdotdev, brethof) with zero storage/retrieval of their own. **None is a validated competitor.** The genuinely mature ones: `indigokarasu/chronicle` (event-sourced, production-grade, updated daily), `ashmoonori-afk/birkin` (benchmark-disciplined), `cnkang/hermes-plugin-qdrant-memory` (only one in the official catalog, 5★), `RohiRIK/OpenLtm` (27★, Hermes-catalog-pinned at 2.16.2), `xraysight/hermes-memory-ui` (73★, read-only inspector).
2. **Muse Memory is architecturally ahead of nearly all of it**: local-first SQLite+FTS5+YAML mirror + MCP + code anchors + contradiction engine + ROI tracking vs. plugins that are Qdrant-daemon adapters or SaaS shims. The risk is not a competitor stealing the architecture — it is **us not shipping the mechanisms the whole field already agrees on**.
3. **The field's convergence (see R17 brief) is confirmed by this teardown**: ADD-only append, hybrid fusion, event-triggered consolidation — plus three new cross-cutting agreements: (a) **abstention as a first-class outcome** (Compartment, limbic, lancedb-suite, EntropicMem all independently converged), (b) **loss must be visible** (tombstones, omission markers, degraded-signals), (c) **forgetting is a policy, executable and auditable** (memanto stamped expiry, memoria trust-tier half-lives, memex8 Weibull, OpenLtm decay_score).
4. **The best single mechanisms for Muse Memory** (ROI-ranked): materialized `decay_score` column (OpenLtm), trust-tier-keyed half-life decay (memoria), `linked_memory_ids` write-time edges (mem0), dual-threshold abstention gate (lancedb-suite), soft-OR evidence fusion (Compartment), echo suppression (mnemostack), FTS5-tokenizer-matched abstention gate + never-drop manifest TOC, provenance/lineage tables (intelligent-memory), admission ledger (qdrant-memory).

---

## 2. Competition List (canonical, all surveyed — source of truth; NOT in `src/`)

> Rule: this list exists in `.agents/research/` and the public `musememory-comparison.html` only. No competitor identity in `src/`. Licensed-restricted repos are marked ⟦idea-only⟧.

### 2.1 Major memory systems (from R17 + this pass)
| System | One-liner | Verdict | Steal |
|---|---|---|---|
| mem0ai/mem0 (67k★) | De-facto memory layer; ADD-only v3; OSS = 3-signal fusion | ADAPT | `linked_memory_ids` write-time edges (graph for free); semantic threshold gate **before** BM25/entity fusion; query-length-adaptive BM25 sigmoid; `explain=True` score details |
| volcengine/OpenViking (40k★, AGPL ⟦idea-only⟧) | VFS context DB with L0/L1 abstract sidecars | ADAPT | Generated `.abstract/.overview` sidecars + ratio-batched parent-summary refresh (~40 LOC, daemon-free) |
| moorcheh-ai/memanto (2.3k★, MIT) | Memory-agent curator, per-agent namespaces | ADAPT | Stamped expiry `status/expired_at/expired_by(rule name)` + pin-capable first-match-wins YAML policy; reversible, self-explaining forgetting |
| matrixorigin/memoria (612★, Apache-2.0) | "Git for agent memory", governance tasks | ADAPT | **TrustTier-keyed half-life (365/180/60/30d)**; safety snapshot before governance passes; feedback→weight auto-tuner |
| BetterDB-inc/monitor packages (1.3k★) | Valkey monorepo hiding agent-memory lib | ADAPT | Two-mode `consolidate()` (lossy summary vs subject-reconciled facts + tombstones, additive); single shared recall/eviction weight function; datedness-from-field edge cases |
| Walrus Memory / MemWal (R17) | Decentralized Sui+Walrus memory | IDEAS ONLY | Content-addressed ids, hash-chain audit, extend-before-expiry discipline |
| vectorize-io/hindsight (49.6k★, MIT) | Postgres bank-based biomimetic memory service | MIT | `prefer_observations` recall-time supersession dedup (scoped to top-2×budget so a far observation can't suppress a top fact); watermark staleness (staleness measured from `last_memory_seen_at`, not clocks); insertion-time invalidation cascades; `RecallArms` engine-resolves-before-store contract |
| plastic-labs/honcho (7.6k★, **AGPL**) | Peer-centric memory infrastructure + Dialectic agent | AGPL ⟦idea-only⟧ | Concepts only: observer/observed directional queries ("{observer}'s understanding of {observed}") — cleanest multi-agent mental-model primitive; surprisal-gated consolidation via random-projection tree path log-prob (reimplement from concept, never copy code) |
| mnemosyne-oss/mnemosyne (3.4k★, MIT) | SQLite-only BEAM 3-tier memory — closest sibling | MIT | Veracity tiers (stated 1.0/inferred 0.7/unknown 0.8/imported 0.6/tool 0.5) + Bayesian `1-0.7^n` confidence + conflicts-table-never-delete + same-(subject,predicate) auto-supersede chains; collision-safe length-prefixed fact IDs; additive consolidation (`consolidated_at`, never delete); zero-LLM 13-type ingest classification; federation handshake (cross-bank conflict dedup, fail-closed probes outside the write lock). ⚠️ README withdraws its own headline benchmark; config layer has 50/106 keys silently ignored — port mechanisms only |
| agentscope-ai/ReMe (3.6k★, Apache-2.0) | "Memory as File" Markdown + wikilinks, rebuildable index | Apache-2.0 | Files-as-truth with rebuildable `metadata/`; progressive wikilink expansion after RRF; seen-chunk TTL (`skipped_seen`); path-level locks; mutation rollback via mtime/size snapshot diff; shared-directory multi-agent with zero coordination |
| vshulcz/deja-vu (1.2k★, MIT) | Transcript indexer, 42 harnesses, no model | MIT | `SrcTS` evidence-age stamping (a memory is only as fresh as its evidence); index-time credential redaction keeping surrounding text searchable; tiered retrieval ladder with visible loosening; ground-moved reporting (silent when it can't tell); fix-pair mining (error→command→no-recurrence, 81% measured); read-only agent clients + single writer |
| Zep/Graphiti, Letta, Supermemory, Cognee, LangMem, A-MEM, HippoRAG (R17) | see prior brief | ADAPT | see prior brief |

### 2.2 Hermes plugin ecosystem — the long tail (verdicts from 6 teardown lanes)
| Repo | What it is | License | Verdict | Steal (mechanism) |
|---|---|---|---|---|
| 3L0935/hermes-lancedb-memory-suite | LanceDB provider + visualizer, calibration discipline | MIT | **ADOPT** | Dual-threshold abstain gate + named calibrated-engine constant (`SEARCH_MAX_COSINE_DISTANCE`/`SEARCH_MIN_BM25_SCORE`) |
| fred0m/hermes-memobase-provider | Memobase backend, in-plugin 3-leg retriever | MIT | **ADOPT** | `low_discrimination()` conditional rerank (top1/top2 ratio <1.01, overlap <0.3 → rerank); idf boost for rare tokens |
| Pinutss/jev-memory-selector | Post-retrieval budget filter | MIT | **ADAPT** | Typed drop-reason/keep-reason audit trail; deterministic tie-break |
| kuehnberger/hermes-qdrant-memory | Qdrant + SQLite FTS5 md index | MIT | **ADAPT** | `_clamp_limit` (tool arg ≠ human budget); dry-run point-ID-only delete; url-without-userinfo |
| indigokarasu/chronicle-agent-context-and-memory | Event-sourced local-first engine (100k LOC-scale) | MIT | **ADAPT** | Config-honesty AST audit (WIRED/DORMANT/UNREAD + build-failing test); `[DRAFT]` marking + separate confident-answer key; raise-on-removed-security-key; bounded hook-driven maintenance (5ms budget, at most one job) |
| ashmoonori-afk/birkin-mnemosyne | Pure-stdlib Markdown vault + BM25 | MIT | **ADOPT** | Resident INDEX route-map (~800 tok for 240 docs); search-time query expansion (synonyms/keywords/related fields); curation executor with **no delete verb** + archive caps; frozen-benchmark discipline |
| labyrinth-analytics/loreconvo | Cross-surface SQLite FTS5 memory | BSL 1.1 ⟦idea-only⟧ | **ADAPT** | Compound-token FTS5 expansion (camelCase/snake_case split; claimed +36pp Recall@5); split search/autoload half-lives (90d/30d) |
| magnus919/hermes-cashew | sqlite-vec thought graph + cron sleep | Apache-2.0 | **ADAPT** | Ownership-token cron reconciliation; cron job carries full validated effective config |
| Ex8-ca/memex8 | Rust + Qdrant + Weibull decay | MIT | **ADAPT** | Per-type Weibull decay table (21 curves); regex query-intent bias table (no LLM); spreading activation on recall |
| hoysama/hermes-intelligent-memory | SQLite FTS5 Arab/multilingual provider | MIT | **ADOPT** | `fact_provenance` append-only + triple-unique index; `supersedes_id`/`conflicts_with_id` lineage FKs; `UNIQUE(profile, content_hash)` idempotency; epoch compression; self-healing doctor |
| ottosulin/hwiki | Markdown wiki → FTS5 | MIT | **ADAPT** | Untrusted-zone quarantine re-verified per hit; context-conditional read-only (write tool withheld from schema for cron/subagent); write-time labelled-secret guard; safe FTS token quoting; FTS5 capability probe |
| MCarlomagno/hermes-pubky | Agent portability to Pubky | MIT | **ADAPT** | Head-moves-last immutable checkpoint ordering (`seal→verify→publish→move head`); base/head two-pointer restore model; exit-code contract |
| Cortex-Layer/cortexlayer-hermes-plugin | CortexLayer shim | Apache-2.0 | **ADAPT** | Digest-deduped `on_pre_compress` capture + persisted digest set; never return empty checkpoint |
| Neboy72/nexus-memory | Qdrant shared brain + daemon | MIT | **ADAPT** | `effective_score = base × reinforcement × decay`; fail-closed access level (missing ⇒ private; refuse widening) |
| gamaze-labs/hicortex-hermes-plugin | Pushed recall-index shim | (unset) | **ADAPT** | Pushed recall index + lazy hydrate = the fetch is the reinforcement signal; hard per-recall timeout |
| aean0x/hermes-gbrain-retrieval-reflex | Ambient pointer injection | MIT | **ADAPT** | Self-injection strip; trivial-turn gate (<4 chars); hard byte-cap; fail-soft invariant |
| Ufonik88/EntropicMem | Standalone knowledge engine | MIT | **ADOPT** | FTS5-tokenizer-matched abstention gate (transient in-memory FTS w/ identical tokenizer config); deterministic `why_retrieved` reason tokens; decay-with-floor |
| Nacho-Labs-LLC/hermes-plugin-nachos | Three-tier budgeted assembly | MIT | **ADOPT** | Never-drop manifest TOC (descending summary cap, entry line never omitted); rank title+summary not body |
| udjin-labs/hermes-mnemostack | TAM/Qdrant transport | MIT | **ADOPT** | Capture-side provenance echo suppression (age-bounded, not fence-parsing); deterministic `(source,offset,text)` ids; event-time-at-capture; `degraded − notes` fault signal |
| vbcherepanov/hermes-tam-memory | TAM MCP front | MIT | **ADOPT** | `<memory-context>` + base64 strip before re-capture; bounded drop-oldest write queue + deadline flush |
| vimona3ds/hermes-snapcompact | Bitmap-PNG context compaction | MIT | **ADAPT (1 fn)** | Dual-measure honest-vs-host token accounting fail-safe before committing any compaction |
| kerrz2020/hermes-gbrain | Postgres+pgvector installer | MIT | SKIP | Testing discipline only: `verify-install-fresh.sh` isolated-`$HOME` drill with pinned expected values |
| itpartypattaya/hermes-dreaming | Nightly deterministic consolidation skill | MIT | **ADOPT (top value)** | `{"wakeAgent":false}` gate + actionable-keys allowlist; `memory_pressure` ceiling as actionable event; overnight loss guard (25% entry/char drop, alert-only, head-hash); corroboration-gated promotion (≥2 days, machine sources excluded); conflict≠duplicate; atomic multi-op writes |
| itpartypattaya/hermes-plugin-holographic | Ex-Hermes-core default SQLite FTS5 fact store (6.8k LOC, 35 test files) | MIT | **ADOPT (top value)** | IDF-weighted relevance gate before FTS5 (0.3, identifier-decisive, greeting short-circuit); `_not_recent()` re-injection suppression (6 turns); read-path re-validation (injection/credential/markup); five-verb bitemporal lifecycle with `valid_to_exact` + `as_of → {results, undetermined}`; forget tombstone + `secure_delete` VACUUM; `retrieval_count`/`helpful_count` feedback columns; scope-derived DB filenames |
| esaradev/icarus-plugin | Markdown fabric + fine-tune pipeline (154★) | MIT | **ADAPT** | recall→usage telemetry join (`usage_rate = used∩recalled/recalled`) — closes Muse's missing usage-feedback loop; >0.6 topic-overlap prefetch skip |
| patrykkopycinski/hermes-plugin-agent-memory-es | Elasticsearch SaaS shim | no license | **ADAPT (principle)** | user-words→episodic vs agent-prose→semantic tier split as provenance; `is_trivial_prompt()` prefetch gate |
| aska-digital/optchat-memory | Append-only JSONL + binary summary tree | MIT | **ADOPT** | fsync-per-line JSONL + single-writer flock that fails loud; `id+n` positional zoom addressing; age-graded view tiling; free-node rule (no summarize when payload fits) |
| supermemoryai/hermes-supermemory | Supermemory SaaS client | MIT | **ADAPT** | 4-hour bucketed `customId` (`<session>_<date>_b0..5`) collapsing turns ≤6 docs/day; bounded oldest-first retry buffer with bytes cap |
| yonro/hermes-xmemo-plugin | xmemo SaaS + SQLite reliability layer | MIT | **ADOPT** | write outbox state machine (`pending→processing→sent/held/failed`), `idempotency_key` UNIQUE, `recover_stale_locks(300s)`, `auto_replay=0→held` for non-idempotent ops, `stale:true` degraded-read tag |
| Markgatcha/memos (MemOS) | Local-first SQLite+FTS5 graph memory | MIT | **ADAPT** | TOON token-compact context pack (claimed 77.6% vs JSON); bitemporal `searchTemporal(atTime)` default-excluding superseded; `scoreRetain` 0.3 write gate (refuse junk writes); trust-from-provenance table (user 1.0/agent 0.7/external 0.5/system 0.3); local rule-based extraction |
| matebenyovszky/agentplaybooks | SaaS playbooks + Hermes shim | MIT | **ADAPT (1 pattern)** | `NoRedirects` + strict `validate_url` (HTTPS only, no userinfo, loopback HTTP opt-in) for any remote surface; strict tool-arg surface; `identity_signature()` cross-profile cache guard |
| lancedb/hermes-agent-memory | LanceDB hybrid provider | Apache-2.0 | **ADOPT (hook) / SKIP (store)** | **`on_pre_compress` extraction as a write trigger** (facts survive compaction — the highest-leverage hook in the ecosystem); fact-first + turns-as-provenance; whitespace/case-normalized `content_hash` dedup; `stable_turn_id` from content not index; fail-loud on schema/dim mismatch |
| rarf/optmem-hermes-plugin | Append-only fixed-width log + decay tree (17★) | MIT | **ADAPT** | power-of-two-aligned blocks as idempotent resumable compaction units; `WakeNeedsCompression` refusal (never emit an incomplete digest) |
| tuancookiez-hub/HyAtlas-Memory | Go server + 8-layer memory | Apache-2.0 | **ADAPT** | supersede-not-delete + per-layer `hidden` counter for over-fetch (`WHERE superseded_at IS NULL`); RRF with floor applied to vector hits only; corroboration-gated schema induction (≥2 turns) |
| electricsheephq/lcm-x | SQLite DAG lossless context engine (93★) | MIT | **ADAPT** | summary DAG with source-lineage edges (every summary drillable to raw); directness scoring (tool-output JSON −4.0); age-decay blended into rank; bounded externalization refs |
| yantrikos/yantrikdb-hermes-plugin | Temporal context graph, embedded (96★) | MIT | **ADOPT** | `idempotency_key` on capture (retry→0 writes, divergent retry→named conflict); constitution-file pattern (CURRENT.md-style rules injected first, never trimmed, no write tool); dual-trigger maintenance cadence (N turns AND wall-clock); `why_retrieved` on every hit |
| roboticforce/sugar | SQLite memory + MCP (98★, AGPL ⟦idea-only⟧) | AGPL-3.0 | **ADAPT (idea only)** | reserved guideline slots (global/USER.md-class entries always surface); per-type `expires_at`; vec→FTS5→LIKE 3-tier cascade; importance+access_count orthogonal axes |
| topoteretes/cognee-integrations | Cognee Hermes adapter (100★) | Apache-2.0 | **ADAPT** | two-tier promotion (cheap `pending` tier → explicit session-end flush to durable tier — never per-write LLM); circuit breaker (5 fails→120s cooldown); pre-compaction memory anchor; creds redacted before store |
| praggybuilds/hermes-gbrain-pointer | Read-only pointer injector | MIT | **ADOPT** | Generation-counter invalidation of in-flight queue_prefetch (no stale pointers after rewind); pop-once cache; bounded body reads; secret-fingerprint comparison |
| kalice-vi/hermes-excel-line | xlsx workbook memory | MIT | SKIP | Strictly worse than SQLite+FTS5 |
| dexio-wiki/hermes-plugin | Dexio SaaS shim | MIT | SKIP | Remote, no ranking |
| BrethofAI/brethof-brain-client | 20-harness hosted client | proprietary ⟦idea-only⟧ | SKIP | Concept only: curator gate (agent appends evidence; deterministic promotion decides records) |
| aska-digital/cognition-memory | Session-end regex facts | Apache-2.0 | **ADOPT** | Truncation order `pin > provenance > recency > salience` + mandatory `[N omitted — budget M]` marker; fetch-first merge keep-both; tombstones on eviction ("loss is always visible"); mandatory provenance gate (empty string = missing); lock ladder |
| mtrnix/hermes-memory-metronix | Metronix REST proxy | Apache-2.0 | SKIP | prefetch=cache / queue_prefetch=background pattern (trivial port) |
| hydra-db/hydradb-hermes-plugin | 60-line adapter | Apache-2.0 | SKIP | None |
| HelperLabs/penny-hermes | Hosted MCP client | MIT | SKIP | Transport hardening only (NoRedirect, bounded response, content-free errors) |
| Karb-Interactive/hermes-plugin-stack-memory | Git-wiki + LLM retriever | **no license** | SKIP code | Design only: thread-scoped `store_jail` (fail-open documented boundary); `verified|drifted|unknown` anchor triage |
| pastdotdev/hermes-plugin | past.dev SaaS + session buffer | MIT | **ADAPT** | Silence-gap episodic cuts (`sittings()`); named budget constants with provenance; never-raise contract |
| PIR8-Software/hermes-brain-graph | Markdown → graph UI | MIT | **ADAPT** | Rename-as-planned-transaction with snapshot rollback; `resolved|ambiguous|unresolved` link triage |
| MaxFreedomPollard/Compartment | Encrypted offline MCP memory | Apache-2.0 | **ADOPT** | Soft-OR evidence fusion `P=1-(1-pv)(1-pl)`; fixed-bound cosine→prob (0.25–0.85, ceiling 0.88 forced by weights); multiplicative priors; age-in-memories; windowed embedding for long texts; one ranking module imported by all surfaces |
| dyiapanis/limbic | Qdrant self-tuning memory | PolyForm NC ⟦idea-only⟧ | **ADAPT** | `no_confident_match` abstention; `matured_at`/`atrophy_marked_at` mark-and-sweep; reconsolidation-without-mutation; writer-lock postmortem |
| RohiRIK/OpenLtm | SQLite+FTS5 local-first (27★, catalog-pinned) | MIT | **ADOPT** | **Materialized `decay_score` column + importance-gated half-lives (14/30/90/180d) + `<0.25→deprecated`, 2 SQL statements** — highest ROI in survey; FTS5-as-floor/vectors-as-upgrade; dedup queues suggestions never auto-merges |
| cnkang/hermes-plugin-qdrant-memory | Official-catalog Qdrant provider (5★) | MIT | **ADAPT** | Synchronous SQLite admission ledger before async extraction; capability-honesty README discipline |
| kuntao2011/kkk-hermes-memory-zvec | Zvec lock governance | MIT | **ADAPT** | `atexit` bounded join before daemon-thread teardown (fixes zero-row loss); amortized index maintenance |
| lumberroom/lumberroom-hermes | Cloud/self-hosted provider | Apache-2.0 | **ADAPT** | Fail-closed two-level ownership gate (`session_allowed`+`turn_allowed`); provider never implicitly writes |
| kyssta-exe/hermes-obsidian-memory | Vault browser | no LICENSE file | SKIP | Read-only inspector pattern only |
| xraysight/hermes-memory-ui | Cross-provider read-only UI (73★) | MIT | SKIP | UI reference for studio read-only inspector design |
| m0re repos pending lanes | see pending list above | | | |
| vectorize-io/hindsight, plastic-labs/honcho, mnemosyne-oss/mnemosyne, agentscope-ai/ReMe, vshulcz/deja-vu | (pending lane) | | | |

---

## 3. Steal List — merged, ranked by (impact × maturity) ÷ effort

### Tier A — implement first (cheap, closes audited gaps)
| # | Mechanism | Source | Effort |
|---|---|---|---|
| A1 | `decay_score` materialized column + importance-gated half-lives + deprecate pass | OpenLtm | ~40 LOC SQL |
| A2 | Trust-tier-keyed half-life (provenance → decay rate) | memoria | ~20 LOC |
| A3 | Dual-threshold abstraction gate + calibrated-constant discipline | lancedb-suite | ~60 LOC |
| A4 | Soft-OR fusion + fixed-bound cosine→prob + multiplicative priors | Compartment | ~80 LOC |
| A5 | `<memory-context>`/injected-block strip before capture (self-echo suppression) | TAM + mnemostack | ~40 LOC |
| A6 | FTS5-tokenizer-matched abstention gate | EntropicMem | ~150 LOC |
| A7 | Never-drop manifest TOC + truncation `pin>provenance>recency>salience` + `[N omitted]` marker | nachos + cognition-memory | ~120 LOC |
| A8 | `linked_memory_ids` write-time linking (dedup against recent window) | mem0 | ~40 LOC |
| A9 | Safe FTS5 query construction (quote every token) + compound-token expansion | hwiki + loreconvo | ~15 LOC |
| A10 | Admission ledger (SQLite write-ahead of async extraction) | qdrant-memory | ~60 LOC |
| A11 | Event-time-at-capture stamping + deterministic `(source,offset,text)` ids | mnemostack | ~20 LOC |
| A12 | Typed drop/keep reasons on retrieval ranking | jev | ~40 LOC |
| A13 | Tombstones-on-eviction + omission-visible loss + `memory_restore` | cognition-memory + R30 | ~60 LOC |

### Tier B — capability upgrades (v2.5.0)
| # | Mechanism | Source |
|---|---|---|
| B1 | `fact_provenance` append-only + lineage FKs + UNIQUE content_hash | intelligent-memory |
| B2 | Lineage BFS walker (`supersedes∪related∪evidence`) | R17 P1 + above |
| B3 | Hash-chained audit + session Merkle checkpoints | R17 (Walrus idea) |
| B4 | Compaction-triggered consolidation (Letta pattern) | R17 |
| B5 | `[DRAFT]` marking + separable confident-answer key | chronicle |
| B6 | Config-honesty AST audit (WIRED/DORMANT/UNREAD + build-failing test) | chronicle |
| B7 | Stamped expiry + pin-capable policy YAML | memanto |
| B8 | Two-mode consolidate (summary vs reconcile+tombstones) + shared recall/eviction weights | BetterDB |
| B9 | L0/L1 generated abstracts + ratio-batched refresh | OpenViking (reimplement) |
| B10 | `why_retrieved` reason tokens; `low_discrimination()` rerank gate | EntropicMem + memobase |
| B11 | `atexit` bounded join; generation-counter prefetch invalidation | zvec + gbrain-pointer |
| B12 | Untrusted-zone quarantine + context-conditional read-only + write-time secret guard | hwiki |
| B13 | Real embeddings + RRF hybrid (R21 spec branch) + semantic threshold gate pre-fusion | R21 + mem0 |
| B14 | Intent-bias query multipliers (regex, no LLM) + per-type Weibull/decay curves | memex8 |
| B15 | Recall-set eval harness (R27 branch) + frozen benchmark discipline | birkin + R27 |

### Tier C — server-mode & UI (see §5/§6)
Streamable HTTP transport, per-tenant DB files, Litestream, admission ledger, fail-closed gates; studio recall-debug rehaul.

---

## 4. Decisions: HAVE / IMPLEMENT / DEPRECATE

**Already have or spec'd (do not rebuild):**
- R21 llama.cpp embeddings (spec'd on `feat/local-embeddings-llama-cpp`) → covers B13.
- R27 recall eval harness (spec'd `feat/recall-eval-harness`) → covers B15.
- R28 trust tiers (spec'd) + GAP-3 freshness gate → foundation for A2/B12.
- R29 I/O budget telemetry (spec'd) + R30 tombstones (spec'd) → covers A13.
- R31 multi-writer merge (spec'd) → foundation for B1/B8.
- R32 studio recall-debug (spec'd) → §6.
- GAP-1 write-time citation verification, GAP-2 lifecycle hooks, GAP-3 freshness gate: shipped.
- R17 P0 defects (cache self-destruction, stat storm, `/bin/sh -c`, dead features): fixes not yet landed.
- SyncPackets + gossip pool: already the right team-sync primitive (§5).

**Implement (net-new, not covered by existing branches):** A1–A13, B1–B12, B14 — full mechanism catalog above; each lands as its own commit against the P0/P1 lanes in `.agents/context/roadmap.md`.

**Deprecate / remove (now demonstrably dead weight):**
1. `benchmark/suite.ts` mislabels (D13) — replace with honest harness feeding R27.
2. Four dead-code paths (B9: `dedup`/`checkConflict` never passed, `recordRetrievals` uncalled, `maybeAutoOptimize`/`touchActivity` uncalled) — wire or delete; docs must not claim shipped.
3. `vector.ts` char-trigram hybrid search — superseded by R21 real embeddings; keep only as the zero-dependency fallback until embeddings ship.
4. Full-file injection path in `get_context` — replace with never-drop manifest TOC (A7).
5. Optimizer regex deletion (B5) — replaced by A13 tombstones + B7 stamped expiry; delete verb disappears entirely (birkin discipline: no delete verb in any curation surface).
6. `autoCompileWiki` + `syncConstraints` on every `openStore` — dirty-gated (R17 P0 #3).

---

## 5. Server Mode — "team memories on one self-hosted instance"

**Constraint verdict from research**: keep SQLite (ADR-001); add a **transport**, not a database. Recommended stack:
1. **Remote access = MCP Streamable HTTP** (spec 2025-06-18; the HTTP+SSE transport is deprecated). Same Bun binary, second listener; MUST validate Origin, bind 127.0.0.1 when local, `Mcp-Session-Id` + `MCP-Protocol-Version` headers, SSE `Last-Event-ID` resumability so a dropped stream cannot silently lose a `memory_capture`.
2. **Multi-tenant = per-tenant DB file** (tenant resolved from auth token). Strongest isolation with least code; a cross-tenant bug is a wrong path, not a leaked row. (Postgres RLS is the alternative only if we ever leave SQLite.)
3. **Sync = extend `src/sync/pool.ts`** from filesystem drop-dir to HTTP POST against the team endpoint; the **YAML mirror + git remote** is the human-reviewable distribution path (ADR-002 already makes memory diffable).
4. **Backups/DR = Litestream** (single sidecar, S3-compatible target, any host: MinIO/Backblaze/bare metal). Nothing else adds a process.
5. **Individual users**: unchanged — local/global `.memory/`, stdio MCP, zero network dependency.

**Rejected**: LiteFS (FUSE+Consul, beta), Corrosion (mesh daemons), rqlite/dqlite (HTTP data-layer rewrite), cr-sqlite (wrong abstraction level), PGlite (single-connection dead end), Electric+Postgres (correct only if we outgrow this; read-path only + proxy requirement), Syncthing for the live `.db` (unsafe; fine for the YAML mirror), Redis/Valkey (daemon, no gain). **Safest multi-writer** if the team later demands it: one-region Postgres + RLS (force RLS, non-owner role; beware owner/superuser/TRUNCATE bypasses) with SQLite clients as read cache — never two-way SQLite↔Postgres sync.

**Known limit (must be documented, not silently shipped)**: git-mirror sync inherits git merge semantics — concurrent edits of the same YAML produce a textual conflict needing human resolution. Safer than silent LWW, not zero-touch.

---

## 6. Dashboard Rehaul (R32 + lancedb-suite + xraysight patterns)

Target surface (granular control per user request):
1. **Memory browser** with per-factor score breakdown ("why was this retrieved") — R32 + A12 typed drop reasons on both kept and rejected.
2. **Provenance & lineage view** — memory graph from `linked_memory_ids` + lineage BFS + `fact_provenance` rows; inline ADR/drift links.
3. **Eval panel** — R27 recall-set grading (must-return/must-not-return, abstention, noise) with p50 latency beside it; one-click fixture freeze (birkin discipline).
4. **Lifecycle control tower** — trust-tier/decay state, tombstones & restore, stamped-expiry policy editor (pin rules), optimizer proposals (never auto-delete).
5. **Config honesty panel** — WIRED/DORMANT/UNREAD audit output; fail-loud indicators for removed security keys.
6. **Team mesh view** (server mode) — per-tenant stores, sync pool state, admission ledger, Litestream replica health.
7. **Read-only inspector pattern** (xraysight): UI never writes directly; every mutation goes through the same validated write path (locking, mirroring, FTS maintenance).

---

## 7. "Always-On Memory" vision — auto start / auto improve / auto fetch / never forget

| Wish | Mechanism (already identified) |
|---|---|
| Auto-started | GAP-2 lifecycle hook pack (shipped) + Streamable HTTP server mode (§5) + config-carrying cron reconciliation (cashew) |
| Auto-fetched | Ambient recall with abstention gates (A3/A6), never-drop manifest (A7), echo suppression (A5), trivial-turn gate, generation-counter invalidation |
| Auto-improved | Event-triggered consolidation on compaction/step-count (B4), two-mode consolidate (B8), decay/refresh policies (A1/A2/B9), feedback auto-tuner (memoria) |
| Always remembered | ADD-only append, tombstones (A13), audit replay restore, hash-chained audit (B3), head-moves-last snapshots (pubky), **no delete verb** in any surface |

---

## 8. Identity & Code-Identity Audit (this commit)

- `package.json`: `author` set to **"Harsh Singh"** (was "Harsh"). Repo URLs keep `harshsinghmp` (allowed).
- Repo-wide grep: no personal emails/identities in code, docs, or configs. Git author placeholder is neutral.
- Competitor identity audit of `src/`: competitor names appear **only** in functional paths — `src/migrator/*` (import format detection for agentmemory/mem0/letta/everos) and `src/agents/registry.ts` (platform detection incl. letta-code binaries). No marketing/comparison identity ships in code. The competition list lives here + `musememory-comparison.html` (non-code artifacts).

---

## 9. Sources
Per-repo raw READMEs/APIs cited in each teardown lane; consolidated URL set accompanies this file in git history. Primary anchor repos: mem0ai/mem0, volcengine/OpenViking, moorcheh-ai/memanto, matrixorigin/memoria, BetterDB-inc/monitor, indigokarasu/chronicle, ashmoonori-afk/birkin-mnemosyne, RohiRIK/OpenLtm, Ufonik88/EntropicMem, MaxFreedomPollard/Compartment, Nacho-Labs-LLC/hermes-plugin-nachos, udjin-labs/hermes-mnemostack, hoysama/hermes-intelligent-memory, ottosulin/hwiki, 3L0935/hermes-lancedb-memory-suite, fred0m/hermes-memobase-provider, Pinutss/jev-memory-selector, kuehnberger/hermes-qdrant-memory, cnkang/hermes-plugin-qdrant-memory, padding lanes as noted. DB/transport: modelcontextprotocol.io spec 2025-06-18 (transports + authorization), litestream.io, litefs, libsql/sqld, rqlite, dqlite, pglite.dev, electric-sql, postgresql.org RLS docs, syncthing.net FAQ, valkey.io, lancedb docs.

---

## 10. CONSOLIDATED IMPLEMENTATION CATALOG (all 15 lanes)
Supersedes the ad-hoc tier lists in §3 for planning purposes. Every item: mechanism ← source(s). Items already spec'd on existing branches are marked (R##).

### Wave P0 — correctness & reliability (v2.4.0; ~700 LOC total; each item is a separate commit)
1. Query-cache self-destruction fix (`store.ts:281`) ← audit R17
2. Ranking hot-path: memoized file verification + precomputed token sets ← audit R17
3. `openStore` dirty-gate for wiki recompile + CURRENT.md sync ← audit R17
4. Bounded FTS preflight; single-transaction writes; FTS↔row parity + repair ← audit R17
5. `/bin/sh -c` removal in `memory verify` ← audit R17 (critical security; captured as negative memory)
6. Wire 4 dead features or delete: `dedup`, `recordRetrievals`, `maybeAutoOptimize`, `touchActivity` ← audit R17
7. Tombstones + `memory_restore` + audit-replay restore (replaces optimizer regex deletion) ← R30 + cognition-memory + holographic (forget tombstone + `secure_delete` VACUUM)
8. `Math.max` spread crash + IDF caching + redundant list() in hybridSearch ← audit R17
9. **Idempotency layer**: `idempotency_key` UNIQUE on capture (retry→0 writes; divergent retry→named conflict naming existing id) + whitespace/case-normalized `content_hash` dedup ← xmemo + yantrikdb + memos + lancedb
10. **Write outbox / admission ledger**: durable `pending→processing→sent/held/failed` states, `recover_stale_locks(300s)`, `auto_replay=0→held` for non-idempotent ops, append-only fsync JSONL event log with single-writer flock that fails loud ← xmemo + qdrant-memory + optchat
11. **`on_pre_compress` extraction**: fact/memory capture before compaction, digest-deduped with persisted digest set, never-empty checkpoint ← lancedb + holographic + cortexlayer (closes "compaction ate my memory")
12. **Wake gate**: background passes only wake the agent when an explicit actionable-keys allowlist matches; exit 0 always ← hermes-dreaming
13. **Overnight loss guard**: snapshot entry-head hashes; >25% entry/char loss → alert-only, restore nothing ← hermes-dreaming
14. **memory_pressure as first-class event**: store near char/size ceiling alerts instead of silently refusing writes ← hermes-dreaming
15. **Honest token accounting**: any auto-compaction commits only if the payload shrinks under BOTH the harness estimate and a pessimistic (image/long-text) cost model ← snapcompact
16. Refuse-incomplete contract: never emit a partial `get_context` digest; raise/retry instead ← optmem (`WakeNeedsCompression`)
17. Circuit breaker around every store path (5 failures → 120 s cooldown → degraded "no memory", never a stalled turn) ← cognee-integrations
18. `atexit` bounded join for any async write worker; generation-counter invalidation for in-flight prefetch ← zvec + gbrain-pointer
19. Read-path re-validation: entries containing injection markup/credentials/invisible chars excluded from recall, logged once, still visible in search/list ← holographic
20. Safe FTS5 query construction (quote every token — audit: possible live injection in any FTS MCP tool) + compound-token expansion (camelCase/snake_case split; +36pp Recall@5 claim) ← hwiki + loreconvo
21. Clamp model-supplied `limit` values; dry-run-by-default, point-id-only destructive ops ← kuehnberger qdrant
22. Read-path `stale:true` provenance tag for degraded/cache reads ← xmemo

### Wave P1 — memory quality engine (v2.5.0)
23. **Abstention gates** (consolidate the ecosystem's convergence): IDF-weighted relevance gate before FTS5 (holographic `relevant()` 0.3, identifier-decisive, greeting short-circuit) + dual calibrated thresholds (lancedb-suite `SEARCH_MAX_COSINE_DISTANCE`/`SEARCH_MIN_BM25_SCORE` + engine-pin constant) + FTS5-tokenizer-matched gate (EntropicMem) + `no_confident_match` (limbic)
24. **Decay & forgetting engine**: materialized `decay_score` column with importance-gated half-lives (OpenLtm) + veracity tiers with Bayesian `1-0.7^n` confidence (mnemosyne) + trust-tier-keyed half-life T1 365d/T2 180d/T3 60d/T4 30d (memoria) + per-type `expires_at` (sugar) + stamped expiry `status/expired_at/expired_by` with pin-capable first-match-wins YAML policy (memanto) + optional Weibull per-type curves (memex8 — re-derive, don't port constants)
25. **Bitemporal discipline**: `valid_to_exact` flag + `as_of` queries returning `{results, undetermined}` (store invents no dates) + five-verb lifecycle change/end/correct/revert/forget + `searchTemporal(atTime)` default-excluding superseded (holographic + memos)
26. **Contradiction**: keep-both conflicts table (never delete) + scoped invalidation requiring (entity, relation, target) alignment + federation handshake for mesh mode (mnemosyne + Graphiti #1728 lesson)
27. **Veracity/provenance trust table**: user_input 1.0 / agent_inferred 0.7 / external_data 0.5 / system 0.3 as rank boost + filter; `src_ts` evidence-age stamping (a memory is only as fresh as its evidence) ← memos + deja-vu
28. **Context packing**: TOON-style row-wise compaction of context packs (claimed 77.6% vs JSON — verify ourselves) + never-drop manifest TOC with descending summary caps (entry line never omitted) + truncation order `pin > provenance > recency > salience` with mandatory `[N omitted — budget M]` marker + reserved slots for global/USER.md-class entries ← memos + nachos + cognition-memory + sugar
29. **Memory graph**: `linked_memory_ids` write-time edges seeded during capture (mem0) + supersede-not-delete with hidden-count-aware over-fetch (HyAtlas) + `prefer_observations` recall-time dedup scoped to top-2×budget (hindsight) + progressive wikilink expansion after fusion (ReMe)
30. **Provenance & audit**: `fact_provenance` append-only table with triple-unique index + `supersedes_id`/`conflicts_with_id` lineage FKs + lineage BFS walker + hash-chained audit + session Merkle checkpoints + index-time credential redaction keeping text searchable ← intelligent-memory + R17 + deja-vu
31. **Write gates**: `scoreRetain` 0.3 (refuse junk writes) + corroboration-gated promotion (≥2 independent days, machine-generated sources hard-excluded) + curator concept (agent appends evidence; deterministic promotion decides records) + two-tier promotion (cheap pending tier → explicit session-end flush) ← memos + hermes-dreaming + brethof + cognee
32. **Recall hygiene**: re-injection suppression per session (6-turn LRU) + self-echo suppression via capture-side provenance (age-bounded) + `<memory-context>`/injected-block strip before capture + seen-chunk TTL + topic-overlap >0.6 prefetch skip + trivial-prompt gate ← holographic + mnemostack + tam + ReMe + icarus + agent-memory-es
33. **Ranking upgrades**: soft-OR evidence fusion `P=1-(1-pv)(1-pl)` with fixed-bound cosine→prob and multiplicative priors (Compartment) + `low_discrimination()` conditional rerank (memobase) + semantic threshold gate BEFORE BM25/entity fusion (mem0) + watermark staleness measured from `last_memory_seen_at` (hindsight) + query-intent bias multipliers (memex8) + `effective_score = base × reinforcement × decay` (nexus) + RRF weight tuning + typed drop/keep reasons (jev)
34. **Token-cost cuts**: L0/L1 generated abstract sidecars with ratio-batched refresh (OpenViking — reimplement, AGPL) + resident INDEX route-map (birkin) + tier budgets as named constants with provenance (EntropicMem/pastdotdev/nachos)
35. **Observability**: `why_retrieved` deterministic reason tokens + recall→usage telemetry join (`usage_rate = used∩recalled/recalled`, feeds ROI) + `[DRAFT]` marking with separate confident-answer key + config-honesty AST audit (WIRED/DORMANT/UNREAD, build-failing) + storage-version compat tests + honest benchmark labels ← EntropicMem + icarus + chronicle + lancedb + R17
36. **Constitution contract**: CURRENT.md-class rules injected first, exempt from trimming, no MCP write tool ← yantrikdb
37. **Failure visibility**: `degraded − notes` fault signal (mnemostack); ground-moved reporting for anchors, silent when undeterminable (deja-vu); tiered retrieval ladder that labels loosened matches (deja-vu)
38. **Semantic retrieval**: local embeddings (R21 spec branch) with engine fingerprint pinning, FTS5-floor/vector-upgrade degradation, brute-force cosine in SQLite BLOB — never an ANN daemon; embedder stamp `stale_embedder` flag ← R21 + OpenLtm + limbic + yantrikdb
39. **Eval harness** (R27): recall-set grading (must/must-not return, abstention, noise as hard failure) + frozen benchmark corpus discipline + p50 latency beside scores + fixture promotion requires usage telemetry ← R27 + birkin + PrecisionMemBench/LongMemEval
40. **fix-pair mining**: error→command→no-recurrence sequences from transcripts become negative-memory candidates ← deja-vu

### Wave P2 — team, server & UI
41. **Server mode**: MCP Streamable HTTP transport (Origin validation, session id, protocol version, SSE resumability) + per-tenant DB files + extend `sync/pool.ts` to HTTP + git/YAML-mirror distribution + Litestream sidecar for backups; solo users unchanged ← DB lane
42. **Dashboard rehaul**: recall-debug per-factor breakdown, provenance/lineage graph, eval panel, lifecycle control tower (trust/decay/tombstone/restore), config-honesty panel, team mesh view; read-only inspector pattern (UI never writes) ← R32 + xraysight + lancedb-suite
43. **Always-on memory implementation**: event-triggered consolidation on compaction/step-count + dual-trigger maintenance cadence (N turns AND wall-clock) + cron ownership-token reconciliation with embedded effective config + wake gates (P0-12) + circuit breakers (P0-17) ← Letta pattern + yantrikdb + cashew + dreaming + cognee
44. **Hermes interop adapter**: ship a Hermes `MemoryProvider` backed by Muse MCP (catalog submission; the qdrant feature branch becomes a remote-vector-backend adapter behind the same Store interface, opt-in only)
45. **Federation**: cross-store contradiction dedup handshake with fail-closed probes outside write locks (mnemosyne) for mesh mode
46. **Team semantics**: observer/observed directional memory queries (honcho concept, reimplement — AGPL) + peer/namespace scoping + reserved slots per peer
47. **Memory forking/branching** + git-worktree-analog overlays (R31 + memoria-style safety snapshots before governance)
48. **Graph retrieval — GATED**: HRR/PPR/wikilink expansion only behind the P1 eval harness with graph-on/graph-off A/B (HippoRAG v1 regressed factual recall; holographic HRR is the closest prior)
49. **Funded/shared memory pools** + sponsored storage model (Walrus delegation) — spec only, agency-network monetization
50. **Memory marketplace**: transfer memories with permissioned grants (Walrus docs flag as future) — spec only

### Explicitly REJECTED (with reasons — prevents re-litigating)
- Qdrant/LanceDB/Zvec/Hydra/Metronix as default stores: daemon or dependency violations (ADR-001). Vector backends only as opt-in adapters.
- Hermes §-delimited MEMORY.md format as our canonical format: our YAML mirror + SQLite is strictly better for this engine; interop via adapter only.
- Multilingual stemming (holographic's 18 languages), CJK n-grams (dreaming): defer until i18n demand exists.
- SaaS memory backends (penny, dexio, hicortex, cortexlayer, metronix, hydradb, pastdotdev, brethof, supermemory, xmemo, memanto-remote): opposite of charter; port mechanisms only.
- AGPL/BSL/PolyForm/no-license code copies (honcho, sugar, loreconvo, limbic, stack-memory, kyssta): idea-only, reimplement.
- Auto-delete anywhere: every destructive path becomes tombstone + restore (birkin: no delete verb in curation surfaces).
- Full-file context injection: replaced by manifest TOC + budgets (P1-28).
