# Research Brief: Walrus Memory & Muse Memory Architecture Upgrade

**Depth**: deep
**Date**: 2026-10-14
**Status**: COMPLETE
**Lanes**: lib-1 (Walrus Memory product/architecture) · lib-2 (SOTA AI memory systems) · ora-1 (local gap audit, 30.8k LOC / 113 files)
**Verification baseline (2026-10-14)**: `bun test` → 502 pass / 0 fail, 85 suites, 2224 expect() calls, 4.16s. Tree on `dev`, clean.

---

## Executive Summary

Walrus Memory (MemWal) is a decentralized, Sui-anchored memory service: content-addressed encrypted blobs on Walrus storage, ownership + revocable delegate keys on a Sui contract, pgvector/HNSW relayer for search. Its genuinely transferable ideas for Muse Memory are (1) content-addressed ids as free dedup + idempotent sync, (2) availability/tamper-evidence proofs via hash-chained append-only records, (3) an explicit extend-before-expiry retention discipline. Its non-transferable parts: relayer + vector-DB-first architecture (violates ADR-001), one-blob-per-memory cost model (64 MB flat per-blob charge; 10k memories ≈ $14.7/mo), and a managed relayer that sees plaintext despite marketing claims.

The SOTA scan (Mem0, Zep/Graphiti, Letta, Supermemory, Cognee, LangMem, A-MEM, HippoRAG, vendor-native) shows the field converging on three axes: **ADD-only append with temporal metadata**, **multi-signal hybrid retrieval fusion**, and **event-triggered background consolidation**. Muse Memory already has stronger lifecycle/invariant machinery than most of them (bi-temporal validity, contradiction engine, code anchors, ROI tracking) — but has two structural weaknesses: no real semantic retrieval (only lexical FTS5 + char-trigram hashed vectors), and the local audit found 10 concrete defects including a self-destructing query cache, a `Math.max` spread crash at 100k entries, an unguarded `/bin/sh -c` exec from memory content, silent FTS/row desync, and four advertised features that are dead code paths.

Verdict: the highest-leverage work is not exotic architecture — it is (a) fixing the audit's P0 defects (3–60 LOC each), (b) adding embedding-backed hybrid retrieval + a retrieval-set eval harness, (c) hash-chained audit + memory lineage for verifiability, (d) wiring the four dead features. Full plan in the roadmap section below.

---

## Walrus Memory: What It Is
Source: lib-1 lane (docs.wal.app, walrus.xyz, CCS '26 paper arXiv:2505.05370v4).

- **Walrus Memory (MemWal)** — Mysten Labs / Walrus Foundation, Apache 2.0 repo `MystenLabs/MemWal`, beta since Jun 2026 (blog 03 Jun 2026). Stack: Sui contract `memwal:account` (ownership + delegate keys) · Rust relayer (REST: embed `text-embedding-3-small` 1536d → Seal-encrypt → Walrus blob → pgvector/HNSW) · TS+Python SDKs · MCP server (8 tools).
- **Identity**: memory space = `owner address + namespace + app ID`. Access = onchain Ed25519 delegate keys, revocable; shared-access and service-delegation patterns.
- **Walrus storage**: RedStuff (Twin-Code over RaptorQ), 4.5× erasure overhead, committee N=1000 shards, tolerates 1/3 faulty, Point-of-Availability certificate from 2f+1 signatures. **Epoch-bought, NOT permanent** — mainnet epoch = 2 weeks; data dies at `end_epoch` unless renewed.
- **Costs**: $0.023/GB/mo on ENCODED size with a flat **64 MB per-blob metadata charge**. Quilts (batched small blobs) save ~400× but MemWal does not use them → 10k × 1 KB memories ≈ 640 GB billed.
- **Verifiability (their headline)**: blob ID = content hash; the Sui `Blob` object (ID/size/namespace/end_epoch/owner) is public; `recall` returns `blob_id` + `created_at` per hit → "this decision cited these exact memory revisions". Caveat: `verify()` is roadmap, not shipped.

### Ideas worth stealing for Muse Memory
1. **Content-addressed memory IDs = free dedup + idempotent sync.** SyncPacket already SHA-256 fingerprints content; formalize `id = hash(content)` addressing so duplicate suppression across agents is structural, not heuristic.
2. **Cryptographic delegation for the P2P mesh.** Our gossip sync has no identity/authorization layer — peers trust the filesystem. Walrus's delegate-key model (registered, revocable, per-scope) is the blueprint for a signed SyncPacket capability model.
3. **Availability proof → hash-chained audit.** `audit.jsonl` is append-only but mutable and unverifiable. A per-record `prev_hash` chain plus a periodic session Merkle root gives tamper-evidence and third-party verifiability — the local analogue of Walrus's PoA, at zero dependencies.
4. **Extend-before-expiry retention discipline.** Our archival lifecycle (cold→dormant→archived) needs an explicit, observable retention/renewal policy — never silent expiry (Walrus's documented failure mode; also Supermemory's forgetting taxonomy and the FSFM "forgetting as security control" paper).
5. **Sponsored/marketplace memory pools.** Walrus's "publisher transfers Blob to a payer while agent keeps lifecycle control" is the primitive for agency-scale shared memory funding. Long-horizon; keep as roadmap item, not near-term.

### Ideas NOT to copy
- Relayer + vector-DB-first architecture (violates ADR-001 zero-daemon, local-first).
- One-blob-per-memory cost model (their own biggest trap).
- Managed relayer trust (they see plaintext despite marketing claims).
- Download-then-rebuild-index restore (our YAML mirror already gives local determinism).

---

## Competitive / Ecosystem Landscape (AI Memory Systems)
Source: lib-2 lane. Tooling note: websearch was HTTP-400 in that session; sources came via Brave HTML, arXiv API, HN Algolia, GitHub API, direct doc fetches. Gemini memory section unverified (404s).

| System | Storage | Retrieval | Lifecycle | Novelty | Score for local-first portability |
|---|---|---|---|---|---|
| **Mem0 v3** | Vector + graph + SQL history | 4-signal fusion; temporal metadata at write, **no LLM call at read** | **ADD-only** (reversed v2's UPDATE/DELETE); hash dedup | `absence` as memory type; agent facts first-class | **High** |
| **Zep/Graphiti** | Bi-temporal context graph (entities/facts/episodes) | semantic + keyword + graph, RRF | `invalid_at` windows, invalidate-not-delete | Episode-as-provenance | Medium (graph cost) |
| **Letta (MemGPT)** | **Git repo of Markdown** (MemFS) | Deliberately none — file tools + progressive disclosure | "Dreaming" on compaction/step count; agent reviews before applying | Git-as-memory-substrate; sleeping on compaction | **Highest** |
| **Supermemory** | Fact-based temporal graph (vector+FTS+graph) | `memories/chunks/hybrid` | UPDATES/EXTENDS/DERIVES typed relations; `isInference` down-weight + review queue | Inference flag + human approve/decline; MemoryBench evals | High (but server binary closed) |
| **Cognee** | Relational + vector + graph | semantic/structural/hybrid | session `remember` → `improve()` feedback-weighted retrieval | Hot session / cold graph split with `_source` tags | **High** |
| **LangMem** | Collection or Profile | similarity × importance × strength | hot-path vs background write as first-class axis | importance×recency/frequency formula | **High** |
| **A-MEM** | Zettelkasten notes | LLM link discovery | **retroactive evolution** of prior notes' links/metadata | Memory edits its own history | Medium |
| **HippoRAG v1/v2** | KG + PPR | single-step PPR beats iterative 10–30× cheaper | — | Graph helps sense-making, hurt factual recall (v1→v2) | Medium |
| **ChatGPT memory** | saved list + rolling summary | — | "delete" is multi-surface and 30-day-delayed | — | Cautionary |
| **Claude memory tool** | App-owned files | JIT file read | vendor defines grammar, app executes | `/memories` prefix + path guard | **Highest** |

### Field convergence (the 3 axes)
1. **ADD-only append + temporal metadata** (Mem0 v3 explicit reversal): storage grows, retrieval disambiguates; dedup goes to exact-hash only.
2. **Multi-signal retrieval fusion** beats pure vector everywhere — and FTS5 + BM25 is free in SQLite.
3. **Event-triggered consolidation** (Letta: dreaming on compaction; Supermemory: dynamic vs instant) is where quality comes from — and where inference cost hides.

### Counter-consensus worth heeding
HN "Agents don't need memory, they need documentation" (297 pts): memory is non-deterministic and costs tokens per retrieval; git-diffable docs never hallucinate. Independent eval (arXiv:2603.04814) shows long-context GPT-5-mini **beats** fact-memory on factual recall; memory only wins on cost after ~10 turns at 100 k context. Multi-hop ceiling: every major system under 55%. Implication for us: **local-first + git-diffable YAML + human-auditable diffs is the right bet; invest in retrieval quality and eval rigor, not in replacing the whole context.**

### Top failure modes reported in the wild (directly relevant to our audit findings)
1. Silent fact destruction via over-broad invalidation (Graphiti #1728: 41% of a production graph invalidated, no signal). → our contradiction/supersede engine must keep a resolution audit trail.
2. Delete-that-doesn't-delete (ChatGPT: deletion scheduled 30 days out). → our optimizer regex deletes with no tombstone (audit bug B5).
3. Concurrency corruption — TOCTOU dedup, racy vector writes (Mem0 #6515/#6243/#4892). → our `INSERT OR REPLACE` silent lost-update (audit bug B3).
4. Corrupted writes unremovable from vector space. → argues for git/append-only substrates (we have YAML mirror — strengthen, don't weaken).
5. Prompt-injection poisoning persisting across sessions. → write-time sanitization (we have Vibeguard — extend to content policy, not just secrets).
6. Retrieval noise is invisible in LLM-judged evals. → grade the retrieval set (PrecisionMemBench style), treat noise as hard failure.

---

## Muse Memory Current Architecture Assessment
Source: ora-1 lane (read-only; verified against source unless noted).

### Strengths (verified)
- Fail-fast secret scan on **every** write path incl. peer ingestion (`store.ts:307-313,427-437`, `sync/engine.ts:173-180`).
- Path-traversal guard on ID→file mapping (`store.ts:130-138`).
- Properly tuned SQLite config: WAL + busy_timeout=5000 + mmap + foreign_keys (`sqlite.ts:46-52`), dual bun/node drivers.
- Lifecycle invariants enforced at choke point: `confirm()` allow-list (`store.ts:515`), `supersede()` guards (`store.ts:546-547`).
- Bi-temporal modeling: `valid_from/valid_to` vs `created_at/updated_at`, decay on event time (`retrieval.ts:206`).
- Atomic YAML mirror (tmp + rename) with structured degradation (`store.ts:324-332`).
- Self-skepticism: `verifyStrictIntegrity` audits secrets, broken refs, wikilinks (`verify.ts:151-260`).
- Structural code identity (line-independent fingerprints) and provider fallback chain.

### Defects found (ranked; evidence in ora-1 report, file:line cited there)
| # | Defect | Severity | Size |
|---|---|---|---|
| D1 | `list()` populates query cache then `setEntry` invalidates it → **0% cache hit rate on every listing** (`store.ts:281-283`, `cache.ts:124,212`) | Critical | 3 LOC |
| D2 | `openStore()` runs full wiki recompile (O(C²) cross-link) + CURRENT.md rewrite **per MCP tool call with `dir`** (`store.ts:99-104`, `wiki/compiler.ts:187-203`, `governor.ts:430-486`, `mcp.ts:140,1566`) | Critical | ~30 LOC |
| D3 | `scoreEntry()` does an uncached `stat` storm per anchored entry + `require()` in hot path (`retrieval.ts:199-204`) | Critical | ~15 LOC |
| D4 | `queryContext` re-tokenizes full memory text on every query; O(N×L) regex (`retrieval.ts:113-122`, `ranking.ts:59,80`) | Critical | ~10 LOC |
| D5 | FTS preflight unbounded then sliced to 15 (`ranking.ts:249`) | High | 1 LOC |
| D6 | 3 untransacted auto-commits per write (`sqlite.ts:233-273`) | High | ~10 LOC |
| D7 | Write amplification: row stores entry twice (`data` JSON + columns) (`sqlite.ts:246-263`) | High | schema migration |
| D8 | `hybridSearch` recomputes whole-corpus IDF per query; **`Math.max(...arr)` RangeError crash at ~100k, swallowed into silent fallback** (`vector.ts:114-127,154,169`, `engine.ts:145`) | High + latent crash | ~40 LOC |
| D9 | "tiered" tier 0 saves zero I/O — full store scan regardless (`retrieval/tiered.ts:37`) | Medium | ~10 LOC |
| D10 | Subprocess spawn (`Bun.spawn codegraph`) per `muse_context` with active file, uncached; passes a file path to a `callers` subcommand (`ranking.ts:258-266`) | Medium | ~10 LOC |
| D11 | Audit log unbounded; `getAuditTrail` reads entire file (`audit.ts:38,55`) | Medium | ~10 LOC |
| D12 | Cache returns live object refs; read-path status mutation can poison cache on throw (`cache.ts:153`, `retrieval.ts:308-309`) | Low-Med | ~5 LOC |
| D13 | Benchmark mislabels full-scan as "FTS5 BM25", hardcodes duplicate rate (`benchmark/suite.ts:145,100-110`) | Low | ~5 LOC |
| B4 (security) | `verify.ts:25-27` executes `/bin/sh -c <command from memory content>` — the v2.2.1 injection hardening does **not** cover this path | **Security** | ~10 LOC |
| B5 (data loss) | `optimize.ts:264-281` permanently regex-deletes non-confirmed memories (matches legit `expect(...).toBe` fix notes), no tombstone/undo (`store.ts:713-717`) | Data loss | ~40 LOC |
| B6 | FTS insert in `try/catch {}` → silent permanent desync; repair only fires when FTS fully empty (`sqlite.ts:266-272,179`) | High | ~15 LOC |
| B9 | 4 dead features presented as shipped: `dedup`/`checkConflict` never passed by any caller (`mcp.ts:1692`, `cli/lifecycle.ts:39`); `recordRetrievals` never called (`mcp.ts:55`); `maybeAutoOptimize`/`touchActivity` zero call sites (`optimize.ts:362,77`) | Product truth | ~20 LOC |
| B3 | Concurrent same-id writes = silent last-writer-wins (`sqlite.ts:235`) | High | see roadmap |
| Untested | `sqlite.ts`, `sessions.ts`, `compress.ts`, `plasticity.ts`, `claims.ts`, `snapshot.ts`, `harvester.ts`, `drift.ts`, `current.ts` have no dedicated tests; cache tested only at class level, never integrated (D1 hides there) | Quality | — |

Scaling estimate (algorithmic, not measured): at 10k memories `get_context` ≈ 200 ms–1.5 s (D3+D4 dominate); at 100k, seconds + D8 crash.

### Capability gaps (verified)
- **No semantic retrieval**: `src/vector.ts` is a hashed char-**trigram** bag (FNV-1a, 256d) fused 50/50 with BM25 — lexical, not embedding semantics; `hybridSearch` returns null unless a manually-built `index.json` exists (`vector.ts:141-182`).
- **No memory lineage walker**: `provenance.ts` is a source-URL ledger; lineage is one-hop only (`trace.ts:49`); migrated memories arrive with none.
- **No forking/branching/merge**, no CAS/version check.
- **No multi-tenant isolation** (free-text `project` label).
- **No WORM/tamper-evident audit**: `audit.jsonl` mutable, no hash chain.
- Contradiction resolution is advertised but unreachable from `memory_capture`.
- No memory eval harness (nothing grades *which* memories come back).

---

## Upgrade Candidates (merged, ranked by impact ÷ effort)

### Tier P0 — correctness first (patch v2.3.x/minor v2.4.0, ~200 LOC total, near-zero architectural risk)
1. D1 fix: move `setQuery` after the `setEntry` loop.
2. D3+D4: memoize runtime file verification (TTL'd map) + precompute token sets once at `save()`.
3. D5: `{ limit: 50 }` on FTS preflight.
4. D2: dirty-check gate `autoCompileWiki` + `syncConstraints` in `openStore` (stamp file on count/maxUpdatedAt).
5. D6: single transaction around row+FTS writes (follow `optimize.ts:286` pattern).
6. B4: remove `/bin/sh -c` — run parsed argv only, or drop auto-exec and require explicit user invocation.
7. B6: broadened FTS backfill (`< 0` not `=== 0`) + parity check in `verifyStrictIntegrity`/doctor.
8. B9 wiring: `dedup` default-on in `memory_capture` (cheap exact-fingerprint; `checkConflict` stays opt-in until contradiction scoring improves); call `recordRetrievals` on retrieval hits; wire or delete `maybeAutoOptimize`/`touchActivity`.
9. B5: snapshot deleted entries into `audit.jsonl` details + `memory_restore` replay; or soft-delete with `deleted_at`.
10. D8: `reduce` instead of spread `Math.max`; cache IDF/avgLen; drop redundant `list()` in `vector.ts:154`.
11. D9: make tier 0 actually cheap (bounded manifest scan) or document it honestly.
12. D12: return deep-enough copies from query cache or drop query cache.
13. D10: cache provider availability + blast-radius results (and fix the file-path→`callers` mistake).
14. D11: rotate audit.jsonl at ~50 MB; tail-read in `getAuditTrail`.
15. D13: honest benchmark labels + measured duplicate rate.

### Tier P1 — capability upgrades (v2.5.0)
16. **Real semantic retrieval** (lib-2 axis 2): local embeddings (e.g. `@xenova/transformers` bge-base or hash-embed quantized fallback) + hybrid fusion with existing FTS5/BM25; background index build wired into the capture path (kills the `index.json` manual step). Keep zero-daemon: embed in-process, CPU.
17. **Memory eval harness** (PrecisionMemBench + LongMemEval style, lib-2 §13.7): `memory eval` command asserting exact must-return / must-not-return memory IDs per fixture; noise as hard failure; **abstention** as a first-class metric. This is what would have caught D1 and D8 — unit tests never integrate the store.
18. **Hash-chained audit + session Merkle checkpoint** (Walrus verifiability, local): `prev_hash` chain in `audit.jsonl`, periodic root stored in `.memory/checkpoints.jsonl`, `memory verify-chain` CLI. Tamper-evident without any chain dependency; makes P2P SyncPackets verifiable.
19. **Memory lineage walker** (U9 + Mem0/Zep provenance): BFS over `supersedes ∪ superseded_by ∪ related ∪ evidence[].source`, depth-capped; `memory lineage <id>` CLI + MCP tool. "Why is this true now?" across generations.
20. **Scoped invalidation discipline** (Graphiti #1728 lesson): supersede/conflict only when (entity, relation, target) align; keep a resolution trail — never silent `invalid_at`-style loss.
21. **Inference down-weighting + review queue** (Supermemory): flag distilled/derived candidates `isInference`, down-rank until confirmed, review queue ordered by support count (`parentCount` analogue = `supporting_evidence.length`). We already have candidate→confirm gating — this makes it visible and ordered.
22. **Compaction-triggered consolidation** (Letta): fire the existing distillation engine on compaction events and after N steps, not only timer; "review before applying" second pass for agent-authored candidates.
23. **Access-frequency strength in ranking** (LangMem): add recently/frequently-accessed signal to the 11-dimension model — with D1/D12 fixed, this is honest telemetry.
24. **CAS/versioned writes** (B3 + Mem0 TOCTOU lessons): `update_if_version` on memory ids so concurrent agents surface conflicts instead of silent lost updates; feeds a future merge UX.
25. **retrieval-noise + hot/cold telemetry** (Cognee): tag each recall hit with `_source` (HOT.md / FTS / vector / distilled) — cheap, and it feeds both ranking and evals.
26. **Docs honesty pass**: current.md bullet count of "shipped" claims vs actual wiring; fix the 4 dead-feature claims, benchmark labels.

### Tier P2 — horizon (roadmap already; now evidence-backed)
27. Multi-tenant/namespace isolation (RLS-style store scoping) — required for the agency multi-client framing; also the security boundary for injected per-client memories.
28. CRDT convergence for the P2P mesh (replace last-writer-wins gossip merge; per-field merge + conflict surface).
29. Memory forking/branching for parallel agent workstreams (git-worktree-analog per agent; merge via ADR-style reconcile).
30. HippoRAG-style PPR retrieval — but **gated behind the eval harness** (v1 regressed factual recall; A/B graph-on/off before adopting).
31. A-MEM Zettelkasten retro-link evolution — LLM cost high; defer.
32. Optional durable-sync sink adapters (Walrus/S3/IPFS) for encrypted cross-machine backup — behind the hash-chain; local-first remains the default; sync-per-option, not a dependency.
33. Funded/shared memory pools + sponsored storage (Walrus delegation) — the agency-network moneteering story; spec only.
34. Autonomous memory optimizer, v2: heuristic pruning is D5-adjacent dangerous (regex deletion); replace with: candidate-scored proposals + human/agent confirm + rollback via audit replay.

---

## Proposed Roadmap Updates (applied to `.agents/context/roadmap.md`)
- New research milestone R17 recorded (this brief + audit).
- Roadmap restructured into P0 (v2.4.0 Patch: Correctness & Performance Hardening), P1 (v2.5.0: Semantic Retrieval, Verifiability & Evals), P2 (existing enterprise/mesh horizons + graph retrieval, durable sinks, funded pools).
- Original 3 future items preserved (distributed telemetry, autonomous refactoring engine, RBAC enclaves) with the new evidence cross-referenced.

## Risks and Open Questions
1. ora-1 latency figures are algorithmic estimates, **not measurements** — confirm with the (now fixed-label) benchmark after P0 lands before promising scale numbers.
2. Semantic embeddings add a runtime dependency + model weight download (~100–400 MB) — conflicts with zero-daemon portability unless lazy-loaded and optional (design carefully; P1 item 16 must keep a pure-FTS5 fallback).
3. `checkConflict=true` by default is deferred: current Jaccard+regex scoring will false-positive at scale (ora-1 verified).
4. Duplicate the D8 crash fix before any large-store migration path ships.
5. lib-2's Gemini section is unverified; websearch was unavailable in that session — minor, no Gemini-specific roadmap item depends on it.
6. lib-1 could not confirm MemWal's free-tier limits; the Walrus adapter is P2 regardless.
7. The audit read `mcp.ts` selectively (~150 of 2,608 lines) — residual risk of additional per-request work in unexamined tool bodies; P0 item 2's dirty-check plus a `memory doctor` per-call timer will surface any remainder.

## Sources
**Walrus Memory (primary)**: product page walrus.xyz/products/walrus-memory · docs.wal.app (llms-full digest) · core-components / how-storage-works / memory-space / ownership-and-access / verifiable-memory / where-to-store-agent-data / api-reference / public-relayer / versioning / permanent-registry-design · repo github.com/MystenLabs/MemWal · blog "memwal-long-term-memory-for-ai-agents" + "introducing-walrus-console" · CCS '26 paper arXiv:2505.05370v4 · RedStuff docs (docs.wal.app/docs/system-overview/red-stuff.md, red-stuff-parameters.md, storage-costs.md, quilt.md) · Third-party: blocksandfiles 31 Mar 2026, dev.to Filecoin-vs-Arweave-vs-Walrus, tatum.io/blog/walrus-memory.
**SOTA (primary/paper)**: Mem0 arXiv:2504.19413 + docs.mem0.ai migration v2→v3 + architecture.md · Zep/Graphiti arXiv:2501.13956 + repo (search_utils.py constants) + issue #1728 · Letta docs (configuration/memory, MemFS, context-constitution) + MemGPT arXiv:2310.08560 · Supermemory docs (llms.txt: searchMode, UPDATES/EXTENDS/DERIVES, isInference review queue, self-hosting, SMFS) + MemoryBench (MIT) repo · Cognee docs (architecture, data-flows) · LangMem conceptual guide + LangGraph memory docs · A-MEM arXiv:2502.12110 · HippoRAG arXiv:2405.14831 + HippoRAG 2 arXiv:2502.14802 · ChatGPT memory FAQ (help.openai.com 8590148) · Claude memory tool docs · Sleep-time compute arXiv:2504.13171 · SleepGate arXiv:2603.14517 · FSFM arXiv:2604.20300 · SSGM arXiv:2603.11768 · LoCoMo arXiv:2402.17753 · LongMemEval arXiv:2410.10813 · MemBench aclanthology 2025.findings-acl.989 · MemoryAgentBench (HUST-AI-HYZ) · independent cost eval arXiv:2603.04814 · agent-memory-bench (hamza-dev-tech).
**Community signals**: HN "Agents don't need memory, they need documentation" (297 pts/173 comments); r/LocalLLaMA Feb 2026 compaction thread; r/ChatGPT memory-loss threads; Mem0 issues #6515, #6243, #4892, #2758; Graphiti issues #868, #1116; ETH Zurich LLM-generated-context-file finding (-3% quality, +20–23% cost).
