# 🗺️ Muse Memory Roadmap & Backlog

---

## ✅ Completed Milestones
- **R14: Cross-Agent Knowledge Sync & P2P Gossip Protocol**: Sealed SyncPackets, vector clock causal tracking, filesystem shared pool drop-directory synchronization, contradiction tagging.
- **R15: Full Web Observability Studio**: Embedded visual web dashboard (`memory studio`) featuring 5-pillar health scorecards, ADR drift inspection, autonomous "Why" reasoner, and live mesh visualization.
- **R16: Multi-Repo & Monorepo Cross-Project Mesh**: Monorepo auto-discovery (pnpm, npm, bun, lerna), cross-project memory resolution with origin provenance, cross-package contract integrity auditing.
- **R17: Deep Research & Architectural Audit (2026-10-14)**: Walrus Memory competitive teardown, SOTA memory-systems scan (Mem0 v3, Zep/Graphiti, Letta MemFS, Supermemory, Cognee, LangMem, A-MEM, HippoRAG, vendor-native), and a read-only source audit of the engine (30.8k LOC / 113 files) that surfaced 10 ranked defects, 4 advertised-but-dead features, 1 security path, 1 data-loss path. Deliverable: `.agents/research/research-brief-walrus-memory-architecture.md`.

---

## 🚀 Active Roadmap & Future Horizons

> Priorities: **P0** = correctness/performance defects found in the R17 audit (land next). **P1** = capability upgrades with proven field leverage. **P2** = horizon. Every P0/P1 item has file-level evidence in the R17 brief.

### P0 — v2.4.0 "Correctness & Performance Hardening" (~200 LOC total)
_The audit's P0 defects. Smallest complete changes; each has blast-radius notes in the brief._

1. **Query-cache self-destruction fix**: `list()` populates the query cache then immediately clears it via the `setEntry` loop (`store.ts:281-283` ↔ `cache.ts:124,212`) — 0% hit rate on every listing. Move `setQuery` after the loop. (~3 LOC)
2. **Ranking-loop hot-path elimination**: uncached per-entry `stat` storm in `scoreEntry` (`retrieval.ts:199-204`) + per-query full-text re-tokenization (`retrieval.ts:113-122`, `ranking.ts:59,80`). Memoize file verification behind a TTL'd map; precompute token sets once at `save()`. This is the 10k-memory scaling fix.
3. **Dirty-check gate on `openStore`**: wiki recompile (O(C²) cross-link) + CURRENT.md rewrite currently run per MCP tool call passing `dir` (`store.ts:99-104`, `mcp.ts:140,1566`). Gate behind a persisted count/maxUpdatedAt stamp; fix mesh multiplication (`mesh/resolver.ts:97,165`).
4. **Bounded FTS preflight**: `searchMemoriesFts` is called unbounded then sliced to 15 (`ranking.ts:249`). Add `{ limit: 50 }`. (~1 LOC)
5. **Single-transaction writes**: wrap row + FTS delete + FTS insert in one transaction (`sqlite.ts:233-273`) — 3 WAL commits → 1 per write; compounds across `supersede`/`link`/`flagConflict`.
6. **Shell-injection hardening in `memory verify`**: `verify.ts:25-27` re-invokes `/bin/sh -c` with `test_command` from memory content — the v2.2.1 exec hardening does not cover this path. Parse argv only; no shell round-trip.
7. **FTS↔row parity repair + detection**: broadened backfill guard (`sqlite.ts:179`, currently fires only when FTS fully empty) + counts comparison in `verifyStrictIntegrity`/`doctor`. Silent desync is permanent today.
8. **Wire the four dead features**: `dedup` default-on in `memory_capture` (`mcp.ts:1692`, `cli/lifecycle.ts:39`; `checkConflict` stays opt-in until contradiction scoring tightens); call `recordRetrievals` on retrieval hits (`mcp.ts:55` — ROI totalRetrievals is structurally 0 today); wire or delete `maybeAutoOptimize`/`touchActivity` (`optimize.ts:362,77`).
9. **Memory restore / soft-delete**: the optimizer regex-deletes non-confirmed entries with no tombstone (`optimize.ts:264-281`, `store.ts:713-717`) — a legit `fix` memory matching `/expect\([^)]+\)\.toBe/` dies silently. Snapshot to audit + `memory_restore`, or `deleted_at` soft-delete.
10. **hybridSearch scale crash**: `Math.max(...arr)` spread throws `RangeError` at ~100k entries and is swallowed into silent fallback (`vector.ts:169`, `engine.ts:145`); plus per-query corpus-wide IDF recompute (`vector.ts:114-127,154`). Reduce-loop fix + cached IDF.
11. **Tier honesty**: tier-0 retrieval does a full store scan today (`retrieval/tiered.ts:37`) — make it bounded or label it accurately.
12. **Cache hygiene**: query cache returns live object refs; a failed rehydrate poisons cached status (`cache.ts:153`, `retrieval.ts:308-309`).
13. **Cache blast-radius/provider lookups**: uncached `Bun.spawn codegraph` per `muse_context` with an active file, plus a file path passed to a `callers` subcommand (`ranking.ts:258-266`).
14. **Audit log rotation**: unbounded append + full-file reverse read (`audit.ts:38,55`); rotate at ~50 MB, tail-read in `getAuditTrail`.
15. **Benchmark honesty**: labels + measured (not hardcoded) duplicate rate (`benchmark/suite.ts:145,100-110`) — these become the before/after evidence for items 1–5.

### P1 — v2.5.0 "Semantic Retrieval, Verifiability & Evals"
16. **Real semantic retrieval**: replace the char-trigram hashed bag (`vector.ts:33-56`) with local in-process embeddings fused with existing FTS5/BM25; wire an automatic background index build into the capture path (kills the manual `index.json` step). Must keep a pure-FTS5 fallback and lazy model loading to preserve zero-daemon portability.
17. **Memory eval harness** (`memory eval`): retrieval-set grading in the PrecisionMemBench/LongMemEval style — assert exact must-return / must-not-return memory IDs per fixture, noise as hard failure, **abstention** as a first-class metric. This is the harness that would have caught audit defects D1/D8 (unit tests never integrate the store).
18. **Hash-chained audit + session checkpoints**: `prev_hash` chain in `audit.jsonl` + periodic Merkle root in `.memory/checkpoints.jsonl` + `memory verify-chain`. Local analogue of Walrus's availability proof: tamper-evident, third-party-verifiable, zero dependencies. Makes SyncPackets verifiable.
19. **Memory lineage walker**: BFS over `supersedes ∪ superseded_by ∪ related_memory_ids ∪ evidence[].source` (depth-capped) with `memory lineage <id>` CLI + MCP tool. One-hop-only today (`trace.ts:49`); migrated memories have none.
20. **Scoped invalidation discipline**: supersede/conflict only when (entity, relation, target) fully align, with a permanent resolution trail — the Graphiti #1728 failure mode (41% of a production graph silently invalidated) is the documented industry cost of getting this wrong.
21. **Inference down-weighting + review queue** (Supermemory model): distilled/derived candidates flagged `isInference`, down-ranked until confirmed, review queue ordered by support count. The existing candidate→confirm gate becomes visible and ordered.
22. **Event-triggered consolidation** (Letta model): fire the distillation engine on compaction events and after N agent steps, not only on cadence; add an optional "review before applying" second pass for agent-authored candidates.
23. **Access-frequency strength** in the 11-dimension ranking (LangMem formula: similarity × importance × recency/frequency strength) — honest once P0 items 1/12 land.
24. **Versioned/CAS writes**: `update_if_version` on memory ids so concurrent agents surface conflicts instead of silent last-writer-wins (`sqlite.ts:235`); the primitive for the P2 merge UX.
25. **Source-tagged recalls** (Cognee model): tag each recall hit with `_source` (HOT.md / FTS5 / vector / distilled / archived) — feeds ranking transparency and the eval harness.
26. **Docs truth pass**: audit every "shipped" claim in `current.md` against call sites; fix the four dead-feature claims.

### P2 — Horizon (evidence-backed)
27. **Distributed Agentic Swarm Telemetry**: Aggregate multi-agent task traces and memory application telemetry across distributed agency clusters. *(Now with P0 cache honesty as prerequisite — telemetry must measure what it claims.)*
28. **Tenant namespace isolation**: RLS-style store scoping + per-client memory boundaries — the security prerequisite for the multi-client agency framing and for safely ingesting untrusted external content.
29. **CRDT convergence for the P2P mesh**: replace last-writer-wins gossip merge (`sync/engine.ts:117-125`) with per-field merge + explicit conflict surface.
30. **Memory forking/branching**: snapshot-isolate-merge for parallel agent workstreams (the git-worktree analogue), reconciled via ADR-style merge.
31. **HippoRAG-style PPR retrieval — gated**: single-step graph traversal is 10–30× cheaper than iterative retrieval, but v1 regressed pure factual recall vs plain RAG. Ship only behind the P1 eval harness with a graph-on/graph-off A/B.
32. **Optional durable-sync sinks** (Walrus / S3 / IPFS): encrypted, hash-chained cross-machine backup adapters behind the sync engine — optional, never a dependency; local-first remains default. Walrus specifics: epoch renewal discipline is mandatory (data expires at `end_epoch`), quilted/batched writes required for cost (64 MB per-blob charge).
33. **Funded/shared memory pools**: sponsored-storage + revocable delegation model (Walrus blueprint) for agency-network shared memory.
34. **Autonomous Semantic Refactoring Engine**: Proactive codebase refactoring recommendations driven by historical bug friction clusters and ADR drift patterns. *(Feed it lineage walker P1-19 + honest telemetry first.)*
35. **Enterprise Role-Based Access & Secret Boundary Enclaves**: Cryptographic memory encryption and tenant-isolated compartmentalization for multi-client agency delivery. *(Now includes the R17 audit's tenant-isolation gap as a P0-adjacent requirement.)*
36. **Zettelkasten retro-link evolution** (A-MEM model): memories that rewrite their own links/metadata — highest LLM cost, defer until local inference path exists.

---

## 🔒 Guardrails Adopted From R17 (binding for all above)
- **No silent invalidation**: every supersession/conflict resolution leaves a retrievable trail (audit + lineage).
- **Forgetting is a security control**: documented hard-deletion that actually removes derived rows (the #1 vendor complaint category).
- **No dead features**: a capability ships only if reachable from a shipped entry point; `current.md` claims must match call sites.
- **No silent cost**: any per-query I/O (spawn, stat, full scan) is cached or gated; benchmark labels must name what they measure.
- **Zero-daemon is non-negotiable**: every P1 semantic-retrieval design keeps an FTS5-only degraded path.

---

## 🧬 R17b: Ecosystem Teardown Upgrades (2026-10-14)

69-URL principal-supplied competitor scan (Hermes plugin ecosystem + major OSS memory systems) + Hermes platform teardown + DB/transport research. Full evidence: `.agents/research/ecosystem-teardown-2026-10.md` (competition list + 50-item consolidated implementation catalog + explicit rejections). Decided waves:

- **P0 additions (v2.4.0, 22 items)**: idempotency keys + content-hash dedup; write outbox with stale-lock recovery; `on_pre_compress` fact extraction; wake gate (`wakeAgent:false`) for background passes; overnight loss guard; memory-pressure alerts; honest dual-measure token accounting; refuse-incomplete digest contract; circuit breaker around store calls; `atexit` bounded joins; read-path re-validation; safe FTS query construction; limit clamping; stale-read tags.
- **P1 additions (v2.5.0, 18 items)**: consolidated abstention gates; decay/forgetting engine (decay_score + veracity tiers + trust-tier half-life + stamped expiry + pin policy); bitemporal `valid_to_exact`/`as_of` discipline; conflicts-table-never-delete + federation handshake; veracity trust table + evidence-age stamping; TOON/manifest context packing + omission markers + reserved slots; linked_memory_ids + supersede-not-delete + prefer_observations dedup; provenance tables + hash-chained audit + index-time redaction; write gates (scoreRetain + corroboration-gated promotion + two-tier flush); recall hygiene (re-injection + echo suppression + seen-chunk TTL); ranking upgrades (soft-OR fusion + discrimination rerank + watermark staleness + intent bias); L0/L1 abstracts + resident INDEX; why_retrieved + usage telemetry + config-honesty audit; constitution contract; failure-visibility signals; embeddings (R21) + eval harness (R27); fix-pair mining.
- **P2 additions**: server mode (Streamable HTTP + per-tenant DB files + SyncPool-over-HTOP + git YAML distribution + Litestream backups); dashboard rehaul (recall-debug, lineage graph, eval panel, control tower, mesh view); always-on memory cadence; Hermes MemoryProvider adapter (qdrant branch becomes opt-in vector adapter); federation handshake; observer/observed team semantics; memory forking; gated graph retrieval; funded pools; marketplace.
- **Hard rejects**: daemon-backed stores, SaaS memory backends, AGPL/BSL/PolyForm code copies, multilingual stemming, auto-delete, full-file injection.

Engine verdict: Muse Memory's zero-daemon SQLite+FTS5+YAML+MCP architecture is the majority position of the field and ahead of the Hermes plugin long tail; the gap is shipping the convergent mechanisms (above), not architecture change.

### R17b Full Item List (source of truth: `.agents/research/ecosystem-teardown-2026-10.md` §10)

**P0 — reliability (v2.4.0)**
1. Query-cache self-destruction fix (`store.ts:281`)
2. Memoized file verification + precomputed token sets in ranking hot path
3. `openStore` dirty-gate for wiki recompile
4. Bounded FTS preflight; single-transaction writes; FTS↔row parity repair
5. `/bin/sh -c` removal in `memory verify`
6. Wire or delete 4 dead features (`dedup`, `recordRetrievals`, `maybeAutoOptimize`, `touchActivity`)
7. Tombstones + `memory_restore` + audit-replay restore
8. `Math.max` spread crash + IDF caching + redundant list() fixes
9. Idempotency keys + content-hash dedup on capture
10. Write outbox with stale-lock recovery
11. `on_pre_compress` fact extraction
12. Wake gate (`wakeAgent:false`) for background passes
13. Overnight loss guard
14. Memory-pressure alerts
15. Honest dual-measure token accounting
16. Refuse-incomplete digest contract
17. Circuit breaker around store calls
18. `atexit` bounded joins + generation-counter prefetch invalidation
19. Read-path re-validation for injection markup/credentials
20. Safe FTS query construction + compound-token expansion
21. Clamp model-supplied limits; dry-run-by-default destructive ops
22. Stale-read provenance tags

**P1 — memory quality (v2.5.0)**
23. Consolidated abstention gates (IDF relevance, dual thresholds, no_confident_match)
24. Decay/forgetting engine (decay_score, veracity tiers, trust-tier half-life, stamped expiry)
25. Bitemporal `valid_to_exact`/`as_of` discipline
26. Conflicts-table-never-delete + federation handshake
27. Veracity trust table + evidence-age stamping
28. TOON/manifest context packing + omission markers + reserved slots
29. linked_memory_ids + supersede-not-delete + prefer_observations dedup
30. Provenance tables + hash-chained audit + index-time redaction
31. Write gates (scoreRetain, corroboration-gated promotion, two-tier flush)
32. Recall hygiene (re-injection, echo suppression, seen-chunk TTL)
33. Ranking upgrades (soft-OR fusion, discrimination rerun, watermark staleness, intent bias)
34. L0/L1 abstracts + resident INDEX route-map
35. why_retrieved + usage telemetry + config-honesty audit
36. Constitution contract
37. Failure-visibility signals (degraded notes, ground-moved, loosening ladder)
38. Embeddings per R21 spec branch (SQLite BLOB brute-force, FTS5 floor)
39. Eval harness per R27 spec branch (recall-gate grading)
40. Fix-pair mining from transcripts

**P2 — team, server, UI**
41. Server mode (Streamable HTTP, per-tenant DB files, SyncPool-over-HTTP, git YAML distribution, Litestream backups)
42. Dashboard rehaul (recall-debug, lineage graph, eval panel, control tower, mesh view)
43. Always-on memory cadence (event-triggered consolidation, dual-trigger maintenance, wake gates)
44. Hermes MemoryProvider adapter (qdrant branch → opt-in vector adapter)
45. Federation handshake for mesh mode
46. Observer/observed team semantics
47. Memory forking/branching
48. Gated graph retrieval (behind the P1 eval harness)
49. Funded/shared memory pools (spec only)
50. Memory marketplace (spec only)

**Hard rejects:** daemon-backed stores, SaaS memory backends, AGPL/BSL/PolyForm code copies, multilingual stemming, auto-delete, full-file injection.

---

## 🧹 R18: Retirement & Hygiene Audit (2026-10-14)

Full evidence: `.agents/research/retirement-audit-2026-10.md` (two-lane audit, reconciled). Verdict summary — almost nothing is dead; the work is drift plus two security defects.

**Do first (security, outranks all features):**
1. Fix `verify.ts:23` `/bin/sh -c` on memory-supplied `test_command` — RCE-class, reachable via `memory_verify`/`memory_verify_strict`.
2. Fix studio UI XSS (`ui.ts:1510`, `ui.ts:1557` unescaped interpolation) + gate `/api/optimize`.

**Free drift fixes (no runtime risk):**
3. Remove 7 phantom names from `orchestrator/profiles.ts`.
4. Retire `connect.ts:9-50` allowlist (auto-approves 3 phantom tools, omits 61 real).
5. RETIRE: `maybeAutoOptimize` (0 callers), unreachable LSP tier (`lsp.ts:16`), 4 unused registry methods, 3 dead governor exports.

**Deprecations (visible externally, docs-level breakage only):**
6. Deprecate 20 of 24 migrator providers (only 4 adapters exist; delete detectors before adapters).
7. Freeze 20 dormant agent platforms; fix README "80+" → 52 claim; fix `daemon.ts` README (SSE, not WebSocket).
8. Flip YAML mirror read precedence to DB-first (`store.ts:174-202`, ~6 lines); keep the mirror.

**Hygiene:**
9. Real dispatch tests (or documented-untested status) for 12 circular + 20 full-profile-only tools.
10. Deprecate `recall` as a third retrieval path (alias only).

**Decisions deferred:** MCP profile default change to `core` (~5k tokens/session saved, but visible behavior change — belongs with the R17b P2 tool-packaging work); YAML full-delete (rejected, largest blast radius).
