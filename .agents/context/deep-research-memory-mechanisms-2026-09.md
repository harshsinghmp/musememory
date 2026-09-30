# 🧠 Deep Research: AI Memory System Mechanisms (Performance, Hands-Free, Graphs, Dashboards)

**Date**: 2026-09-30
**Scope**: Only mechanisms relevant to AI memory systems. Agent platforms (rakazo, OpenMausBot, OpenMuse, llm-council) noted briefly where they contribute memory-relevant ideas.
**Sources**: 86-system feature matrix (carsteneu/ai-memory-comparison), plus deep dives: deja-vu, claude-mem, vestige, Wax, engram, Kage, agentmemory, hindsight, gbrain, persistent-ai-memory, substack article.

---

## Executive Summary

The high-performing AI memory systems of 2026 converge on a shared recipe:

1. **Local inverted index + SQLite FTS5 BM25** for sub-millisecond lexical recall — no network, no LLM at query time.
2. **Hybrid fusion (BM25 + vectors + graph) via Reciprocal Rank Fusion (RRF)** for accuracy without sacrificing speed.
3. **Hands-free = hooks, not APIs**: capture at lifecycle hooks (PostToolUse, SessionEnd), recall at SessionStart — the user never invokes anything.
4. **Verification/freshness gates** (Kage) — memory checked against the code it cites; stale memory withheld, never served.
5. **Single-binary, zero-dependency distribution** (Go/Rust) is the dominant "just works" delivery mechanism.
6. **Dashboards** are local HTML/daemon pages over the same index — free observability, no server.
7. **Forgetting is a feature**: FSRS decay, consolidation, suppression — keeps retrieval fast and relevant as stores grow.

---

## 1. Sub-ms Retrieval Mechanisms

| System | Mechanism | Measured Performance |
|---|---|---|
| **deja-vu** (Go) | Local inverted index (`records.bin` + token buckets + `manifest.gob` per-file state for incremental ingest) over existing session transcripts. Redaction during index build. | **0.7–0.8 ms median in-process lookup**; ~0.2 s end-to-end incl. process start + freshness check over 2.4k sessions/1.9 GB. 17.6 s to index 19,195 sessions. Index ≈ 4–10% of corpus. Incremental: only re-reads grown files. |
| **Wax** (Swift/Metal, Apple Silicon) | One `.wax` file: SQLite FTS5 blob + Metal-accelerated HNSW (vectors ≥10k) or exact Accelerate/CPU flat index (<10k), LZ4 frames, WAL + dual A/B header pages for crash resilience. | **Hybrid recall p95 6.1 ms, p99 6.5 ms; cold open p95 9.2 ms.** |
| **agentmemory** | SQLite + pinned iii-engine; BM25 + vector (local MiniLM, optional) + structural graph, 3-way RRF. | 14 ms p50 hybrid latency; 95.2% R@5 LongMemEval-S. |
| **Vestige 4.0** (Rust) | **Radical: no embeddings, no BM25, no FTS at all.** Recall by exact handle (id / 8-char prefix / exact tag) over a hash-chained append-only signed log (Strata). Deterministic `causal_walk` over recorded edges. | Deterministic by design — no similarity miss possible; writes gated + receipted (`eff-` receipts, `receipt replay` re-derives state). |
| **Kage** | BM25 + sparse lexical scoring over OKF Markdown packets, zero dependencies in retrieval core. | 98.72% R@10, 99.79% R@20 LongMemEval-S; "18% faster than grep at equal correctness." |

**Common thread**: lexical-first, index-once-read-many, incremental ingest, all in-process. Vectors are optional accelerators, not the foundation. The fastest systems **avoid LLM calls entirely at query time**.

---

## 2. Hands-Free ("Just Works") Mechanisms

### The hook pattern (dominant)
- **claude-mem**: 5 lifecycle hooks (SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd) capture tool observations → AI-compressed "observations" → SessionStart injects relevant context. Zero manual action.
- **agentmemory**: 12 hooks (Claude Code) / 22 (OpenCode) silently capture; SessionStart loads project profile; `npx -y @agentmemory/agentmemory@latest` seeds, starts, wires agents interactively. 17 skills teach the agent *when* to reach for memory.
- **deja-vu**: `deja install --auto` wires MCP + session-start recall into every detected agent (35 supported), writes guidance into each harness's own rules file, and pre-builds the index. **Starts full** — indexes history already on disk from before installation.
- **Kage**: PreToolUse(Read) hook injects verified memory citing the file the agent just opened — *condition-based activation*, no user query needed.

### The skill/guidance-file pattern
- deja-vu leaves `~/.agents/skills/deja-search/SKILL.md`; gbrain pastes a memory protocol into CLAUDE.md/AGENTS.md; agentmemory adds skills via `npx skills add`. The rules file tells the model *when* to call memory (hosts ignore bare MCP tool descriptions).

### The "paste one block" pattern
- Nearly all systems ship an INSTALL_FOR_AGENTS.md — a single URL an agent can fetch and follow, making setup itself agent-executable.

### Provenance-retroactive capture
- **deja-vu / agentmemory import-jsonl**: index existing Claude Code/Codex/Cursor transcripts already on disk. Memory "starts full" — no capture step, retroactive value from day one. (Caveat: Claude Code deletes transcripts after 30 days by default — `cleanupPeriodDays`.)

---

## 3. Verification, Freshness & Trust Gates

- **Kage** (strongest): every memory cites code symbols; hallucinated citations rejected at **write time**; stale memory (cited file changed/deleted) **withheld at recall**; diff-time stale-catch warns before the PR (`kage pr check`). 0% stale-served measured vs 100% for capture-everything stores. Trust benchmark 100/100.
- **Vestige 4.0**: proposed → gated → admitted writes on a signed hash-chained log; every write returns a receipt; `receipt replay` re-derives state from the log to detect tampering. `suppress` (not delete) removes from all reads while keeping bytes. Purge deliberately withheld as dishonest on an append-only log.
- **deja-vu**: `deja promote <id> --state rejected` marks a reverted decision so every later hit reports "tried and dropped." "Says when the ground moved": a hit reports *"4 files this session touched have changed since"* — and stays silent when it can't tell.
- **hindsight**: Memory Defense scans every retain against 45 secret/PII patterns; redacts `[REDACTED:github_token]` or blocks before storage.
- **deja-vu secrets**: shape-based redaction during index build (AWS keys, bearer, JWTs, PEM, high-entropy) — `[redacted:<kind>]`, surrounding text stays searchable; `deja secrets --scrub` rewrites source transcripts.
- **GBrain**: explicit facts + sources, corrections and **withdrawal** as first-class operations.

---

## 4. Knowledge Lifecycle, Consolidation & Forgetting

- **FSRS-6 spaced-repetition decay** (Vestige): unused memories fade; use strengthens. `maintain dream/dream_compile` replays recorded edges and strengthens co-activated ones ("memory dreaming").
- **Observations consolidation** (hindsight): related facts → deduplicated **observations** with supporting evidence, exact quotes, and proof counts; new evidence strengthens/weakens/extends a belief rather than overwriting it. Then **mental models**: standing answers stored as pages — reading one is a DB read, *no retrieval, no LLM*. Agents boot with settled knowledge.
- **4-tier consolidation + decay + auto-forget** (agentmemory): raw → observation → lesson → session crystal.
- **8-stage consolidation pipeline** (stash): episode → fact → context with causal links + hypothesis engine.
- **Auto-merge / semantic dedup** (persistent-ai-memory): embedding-based dedup on promotion to long-term; merges related memories; background backlog processor dedups, fills metadata, re-ranks importance.
- **Ebbinghaus forgetting** (YourMemory, MemoryBear): exponential decay so noisy fragments decay into cold storage without admin.
- **Topic-key stability** (engram): evolving topics reuse a stable `topic_key` (e.g., `architecture/auth-model`) to update rather than fork competing memories.
- **Idle-scheduled heavy work**: persistent-ai-memory's Task Coordinator + heartbeat idle detection defers LLM-heavy maintenance (dedup, re-ranking, contradiction detection) until the user is idle. GBrain runs a 24/7 "dream cycle" overnight: enrich, fix citations, consolidate.

---

## 5. Graph & Indexing Systems

- **AST/code-symbol anchoring** (Kage, Fullerenes): deterministic Tree-sitter code graph anchors memories to exact symbols; blast-radius analysis; 64% token reduction (Fullerenes SWE-bench).
- **Typed knowledge graphs** (GBrain): 8 node / 7 edge types (Engram Alpha similar); graph adapter beats plain hybrid on relationship questions (P@5 0.342 vs 0.192); zero-LLM edge extraction on trusted local writes.
- **Multi-hop causal graph traversal** (Vestige `causal_walk`): walk a failure backward over *recorded* edges only, ≤8 hops/500 nodes — "traces the root cause, not the lookalike."
- **Causal links + hypothesis engine** (stash, Somnigraph's NREM/REM sleep consolidation).
- **Token-savior's Thompson-sampled persona lattice** and claude-mem's timeline view add structure to flat stores.
- **deja-vu blame/fix/how**: reverse-direction queries — which sessions touched this file/line (with git-notes attribution), what the machine ran after this error before, how this tool is actually invoked here. Indexes *work*, not just talk: files opened, commands with exit status, exact edit spans (`deja restore` can re-apply a replaced span).

---

## 6. Dashboards & Observability

| System | Dashboard |
|---|---|
| **Kage** | `kage viewer`: packets, memory↔code graph, trust gates, live event stream; native thin Electron shell. |
| **deja-vu** | `deja view` = whole memory as one static local HTML file (no server); `stats --card` terminal/SVG card. |
| **agentmemory** | Real-time viewer on :3113 + **Session Replay** — scrub prompts/tool calls/results as discrete events, 0.5–4x playback. |
| **hindsight** | Web dashboard + live benchmark leaderboard; Prometrics/Prometheus metrics for LLM calls, tokens, latency. |
| **Vestige** | Observatory dashboard at :3927, 60fps store visualization, structure-only share exports. |
| **engram** | TUI (Catppuccin theme) + cloud dashboard; Obsidian graph export. |
| **claude-mem** | Web viewer UI at worker URL, real-time memory stream, observation citations. |
| **Memora** | Live graph UI. |

Pattern: the dashboard reads the **same index/store** the agents use — a free local view, not a separate system. `kage gains` / deja-vu stats quantify savings (tokens/$ avoided), a value ledger traceable to logged events.

---

## 7. Distribution & "Installs And It Works"

| Property | Evidence |
|---|---|
| **Single binary** | deja-vu (Go), engram (Go), vestige (Rust, 7.7 MB), vestige ships 4 binaries incl. upgrader/restorer, Wax (single-file store), Memvid (.mv2 single file), mnemos/YesMem/shodh (Go/Rust). |
| **One-command install + auto-wiring** | `npx -y @agentmemory/agentmemory@latest` (interactive agent picker), `deja install --auto` (detects all agents), `npx -y @kage-core/kage-graph-mcp install` (creates store, builds code graph, writes AGENTS.md policy, wires agents, configures git merge driver). |
| **Keyless-first** | agentmemory (BM25 without any key, optional local MiniLM vectors), gbrain (`--pglite --no-embedding` keyless), deja-vu (no LLM ever; optional local Ollama/LM Studio probe for embeddings). |
| **Multi-agent, one store** | deja-vu (35 agents read one index), Wax (one HTTP writer on loopback, many MCP hosts share one file; second differently-configured process fails fast), Vestige (first agent serves, others connect; takeover on quit), gbrain (per-agent scoped OAuth clients, write-isolation profiles). |
| **Single-writer discipline** | Wax's broker daemon + fail-fast on misconfiguration; Vestige's one-writer log with named-process refusal. Prevents store corruption from concurrent hosts. |
| **Portable formats** | Kage OKF Markdown in-repo (Google-standard; reviewable in PRs); memspec (Markdown canonical + SQLite derived index); memoir (git-like branch/commit/merge memory); deja sync (watermarked, append-only, idempotent, machine-to-machine SSH sync). |
| **Cross-machine** | deja sync ssh; engram Git Sync; GBrain over Tailscale/funnel; Kage via the repo itself. |

---

## 8. Benchmarks Leaders (self-reported unless noted)

| System | LongMemEval | LoCoMo | Other |
|---|---|---|---|
| **deja-vu** | 97.2% R@5 (hit@1 88.1% cleaned) | 70.5% hit@1 | ~200× fewer tokens vs grep; 58% fewer tokens on repeated task |
| **Kage** | R@10 98.72%, R@20 99.79%, MRR 0.909 | — | 0% stale-served; trust 100/100 |
| **ByteRover** | 96.1 | 92.8 | context tree + git-like VC |
| **MemPalace** | 96.6% (verbatim, no summarization) | 88.9 | verbatim storage thesis |
| **hindsight** | 91.4% (independently reproduced by Virginia Tech + WaPo) | — | retain/recall/reflect triad |
| **agentmemory** | 95.2% R@5 | — | 14 ms p50, 92% fewer tokens |
| **memanto** | 89.8 | 87.1 | 13 typed memory kinds |
| **YourMemory** | 89.4 | 59.0 | Ebbinghaus + NER graph |
| **Statewave** | 0.905/0.967 (R) | — | compile-episodes-not-query-time |
| **Mem0** | 94.8 | 91.6 | SaaS baseline |
| **Somnigraph** | 85.1 | — | LightGBM reranker + sleep consolidation |

Caveat from the comparison project: these are largely **self-reported on different setups** — the value is the mechanism inventory, not the leaderboard.

---

## 9. What the Agent Platforms Contribute (memory-relevant only)

- **rakazo**: persistent bots with their own memory + routines; Graphile Worker for scheduled background memory jobs.
- **OpenMausBot**: transcripts logged per-thread as NDJSON (a memory-ready format); permission broker records every risky action as an auditable decision.
- **OpenMuse**: durable task plans with SQL leases to recover interrupted work; "Ideas" feed excludes already-acted-on suggestions (relevance filtering); personal-context memory editable in-app.
- **llm-council**: anonymized cross-review + chairman synthesis — applicable as a memory *consolidation judge* (which of N candidate memories to keep).
- **persistent-ai-memory**: 5 specialized SQLite DBs (conversations/memories/schedule/tool-calls/vscode-project); user_id+model_id isolation; vision-embedding precompute + cache; cross-system dedup on promotion; idle-gated background maintenance.

---

## 10. Distilled Mechanism Checklist (what makes memory performative + hands-free)

**Speed**
- [ ] Local inverted index / FTS5 BM25 as the always-fast path
- [ ] Incremental ingest (per-file state manifest; only re-read changed files)
- [ ] Optional vectors (local quantized MiniLM-class, no API key) fused by RRF
- [ ] No LLM at query time; LLM only at capture/consolidation (and idle-gated)
- [ ] Single binary, in-process; WAL for concurrent-safe local writes

**Hands-free**
- [ ] Lifecycle hooks: capture at PostToolUse/Stop/SessionEnd; inject at SessionStart
- [ ] Condition-based injection (file-open triggers memory about that file — Kage)
- [ ] Skills/rules-file guidance so the model knows when to call memory unprompted
- [ ] Retroactive indexing of existing transcripts ("starts full")
- [ ] Agent-executable setup via INSTALL_FOR_AGENTS.md fetch-and-follow

**Trust**
- [ ] Write-time verification against citations; reject hallucinated anchors
- [ ] Recall-time staleness gate; withhold, never serve stale
- [ ] Diff-time freshness checks (warn before PR lands broken memory)
- [ ] Secret/PII redaction at ingest (shape-based, 45+ patterns), before disk
- [ ] Append-only receipts / lifecycle states (accepted/rejected/superseded)

**Compounding**
- [ ] Consolidation pipeline: raw → observation → lesson → playbook
- [ ] Decay (FSRS/Ebbinghaus) + suppression instead of deletion
- [ ] Stable topic keys to update-in-place vs fork
- [ ] Dream/consolidation cycles scheduled at idle
- [ ] Mental models / knowledge pages: precomputed standing answers = zero-cost recall

**Observability**
- [ ] Local dashboard over the same store (viewer/replay/graph)
- [ ] Value ledger: tokens/$ saved, traceable to events
- [ ] Doctor/selftest/verify commands (vestige selftest plants a known cause and proves the walk finds it)

---

## 11. Memvid — Single-File Serverless Memory (addendum)

**Repo**: https://github.com/memvid/memvid · Rust core (`memvid-core`), 16.5k★

- **Everything in one `.mv2` file**: 4KB header + embedded WAL (1–64MB, crash recovery) + LZ4-compressed data segments + Tantivy lex index + HNSW vec index + time index + footer TOC. **No sidecar files ever** (`.wal/.lock/.shm` eliminated).
- **Smart Frames**: append-only immutable units (content + timestamps + checksums + metadata) — video-encoding-inspired grouping for compression, parallel reads, crash safety.
- **Time-travel**: queries over past memory states, rewind/replay/branch any state; timeline inspection of knowledge evolution.
- **Benchmarks (self-reported)**: +35% SOTA LoCoMo; multi-hop +76%, temporal +56% vs industry average; **0.025 ms P50 / 0.075 ms P99** retrieval latency, 1,372× throughput vs standard. Fully reproducible eval harness.
- **Model consistency guard**: `set_vec_model()` persistently binds the index to an embedding model; mismatched-model queries fail fast with `ModelMismatch` — prevents silent vector corruption.
- **Feature-gated multimodality**: lex (BM25), vec (ONNX BGE/Nomic local embeddings), CLIP image search, Whisper audio transcription (incl. q8k quantized), temporal natural-language date parsing, encryption capsules (`.mv2e`), symspell text repair.
- **Model mismatch prevention**: embedder bound at creation, fail-fast on mismatch.
- **SDK surface**: Rust core + Node SDK + Python SDK + npm CLI.

### Relevance to Muse: strongest single-file layout + time-travel + model-mismatch guard. Time index + frame immutability map directly onto Muse's audit.jsonl and YAML mirror design.

---

## 12. OpenViking (ByteDance) — Filesystem-Paradigm Context Database (addendum)

**Repo**: https://github.com/volcengine/OpenViking · AGPLv3, 35.9k★ · VLDB 2026 / ICDE 2026 papers

- **`viking://` virtual filesystem**: knowledge, memory, and skills as one navigable tree (`ls/tree/read/write/grep`) — memory is inspectable and editable, not a black box of embeddings.
- **L0/L1/L2 layered loading**: `.abstract.md` (one-line summary) → `.overview.md` (structure + key points) → full content on demand. Agents judge relevance before paying full-read tokens.
- **Directory-scoped retrieval**: semantic search scoped to a subtree, not a flat pool; `TrieHI` resolves directory scope before vector ranking (ICDE 2026 paper: directory-aware query & maintenance in vector DBs).
**Benchmark**: LoCoMo 80–83% (up from 24–57% native memory) with 34–91% input token reduction and 58–66% query latency reduction; tau2-bench +6.87/+11.87pp task success.
- **Session-as-file**: committing a session archives the conversation and extracts memories as editable Markdown; `ov compile` organizes material into wiki/KG/report.
- **Academic grounding**: VikingMem (VLDB 2026) event-driven memory extraction/consolidation; VikingRAG (structure-aware, trace-reusing token-efficient retrieval).

### Relevance to Muse: L0/L1/L2 progressive disclosure maps onto `HOT.md` + `CURRENT.md` + full store. Directory-scoped search (project-scoped BM25) already partially exists via `project` filter. Session-as-file ≈ Muse's session nodes + YAML mirrors.

---

## 13. "LLM-Direct Memory" Pattern (Google always-on-memory-agent + TDS write-up) (addendum)

**Sources**: Google's always-on-memory-agent (GoogleCloudPlatform/generative-ai), TDS article "I Replaced Vector DBs with Google's Memory Agent Pattern"

- **Thesis**: at 200K+ context windows, personal-scale stores (hundreds–low thousands of memories) don't need vector search at all — feed structured memories directly to the LLM and let it reason over semantics (LLM > cosine similarity for meaning).
- **Two-table design**: `memories` (summary, entities, topics, importance 0–1) + `consolidations` (memory_ids, connections, insights). Query loads both layers into one prompt with citation IDs (`[memory:a3f1c9d2]`, `[consolidation:3c765a26]`).
- **Consolidation triggers**: startup (process leftovers) + threshold (5+ unconsolidated) + daily forced pass — a "sleeping brain" that never lets anything fall through cracks. Muse's optimize cadence (7d/48h idle) is similar but less frequent; consolidation triggers should be event-driven, not just time-driven.
- **File watching with SHA-256 change detection**: quick scan (60s, path-membership) + full scan (30min, hash diff) → delete/re-ingest changed files, clean up orphaned consolidations. Maps to Muse's mtime-based L1 cache sync + anchors hash verification.
- **Importance-weighted retrieval**: filter/prioritize by importance score so old-but-important memories aren't displaced by recent noise — Muse's utility ROI + recency decay covers this but has no explicit importance field.
- **Caveat**: at scale (millions of docs) vector retrieval is still necessary; this pattern is for personal/team scale.

### Relevance to Muse: validates Muse's lexical-first + knapsack approach; the two-layer memories+consolidations model suggests Muse's compounding rollups could be promoted to first-class queryable entities with citation IDs.

---

## 14. Gap Analysis & Scored Comparison: Muse Memory v2.3 vs the Mechanism Checklist

**Sources verified in code**: `src/store.ts` (save path), `src/anchors/resolver.ts` (attach/audit), `src/retrieval/ranking.ts` (filtering), `src/connect.ts` (wiring), `src/hook.ts` (git pre-commit only).

### Scorecard (0–2 scale: 0 = absent · 1 = partial · 2 = full)

| # | Mechanism | Score | Evidence in Muse |
|---|---|---|---|
| **Speed** | | **15/16** | |
| 1 | Local FTS5/BM25 fast path | 2 | `searchMemoriesFts` + L0 hot cache (sub-50µs) + L1 query cache; benchmark suite |
| 2 | Incremental ingest (per-file state) | 2 | mtime-synchronized dual persistence, only re-syncs changed YAML |
| 3 | Optional local vectors fused by RRF | 1 | 11-dim ranking fuses BM25 + AST + graph — no vector leg yet (R21 planned) |
| 4 | No LLM at query time | 2 | Retrieval is pure lexical+structural; LLM only in distillation |
| 5 | Zero-daemon in-process | 2 | SQLite WAL, no background servers (invariant) |
| 6 | Sub-ms measured lookup | 1 | "sub-2ms lexical" claimed, hot cache sub-50µs; deja-vu-style published per-store medians absent |
| 7 | Incremental index maintenance under growth | 2 | `memory optimize` VACUUM + WAL defrag; mtime sync |
| 8 | WAL concurrent-safe writes | 2 | `PRAGMA busy_timeout=5000` on WAL (v2.2.1 hardening) |
| **Hands-free** | | **4/10** | |
| 9 | Lifecycle hooks (capture/inject) | 0 | Only git `pre-commit` hook exists; **no SessionStart/PostToolUse/Stop hooks shipped** |
| 10 | Session-start context injection | 1 | `get_context`/`muse_context` exist but are *called by the agent*, not auto-injected by a hook |
| 11 | Condition-based injection (file-open) | 0 | Nothing equivalent to Kage's PreToolUse(Read) trigger |
| 12 | Rules-file/skill guidance | 1 | `connect.ts` auto-wires 80+ platforms (MCP registration); no SKILL.md/AGENTS.md memory-usage policy block |
| 13 | Retroactive "starts full" indexing | 1 | `memory_search_transcripts` searches existing JSONL, and harvester distills — but no bulk retroactive index at install |
| 14 | Agent-executable setup (INSTALL_FOR_AGENTS.md) | 1 | `npx musememory` zero-install + `connect` exists; no paste-one-URL agent bootstrap doc |
| **Trust** | | **7/10** | |
| 15 | Write-time secret redaction | 2 | Vibeguard `scanSecrets` enforced at every save path, fail-fast |
| 16 | Write-time citation verification | 0 | `createCodeAnchor` marks orphans but `attachAnchorToMemory` accepts any anchor, **never calls `verifyCodeAnchor`** — hallucinated citations can be stored |
| 17 | Recall-time staleness gate | 1 | Ranking *downranks* conflicted (−0.8) / stale (−0.5); only `superseded`/`rejected` are filtered. Drifted/orphaned/cold entries can still be served |
| 18 | Diff-time freshness catch | 1 | `memory_drift_audit` + `muse pr-context` exist but are pull-based (agent must call), not PR-gate enforced |
| 19 | Secret/PII redaction at ingest before disk | 2 | Redaction in migrator + sync engine; block-on-save elsewhere |
| 20 | Append-only receipts / lifecycle states | 1 | `audit.jsonl` + 7-state machine + schema integrity checks; no per-write replayable receipts (Vestige-style) |
| **Compounding** | | **8/10** | |
| 21 | Consolidation pipeline (raw→obs→lesson) | 2 | Distillation + candidate confirmation + observations tier |
| 22 | Decay/suppression instead of delete | 2 | Per-type staleness policy + archival ladder (active→cold→dormant→archived) + rehydration |
| 23 | Stable topic keys (update-in-place) | 1 | `supersede` chains exist; no stable `topic_key` convention to update-in-place vs fork |
| 24 | Idle/dream consolidation scheduling | 1 | Optimize cadence 7d/48h idle — time-driven only, no event-driven triggers (TDS: startup/threshold/daily) |
| 25 | Precomputed standing answers (mental models) | 0 | Rollups/HOT.md exist but not stored as first-class queryable standing answers with citations |
| **Observability** | | **8/8** | |
| 26 | Local dashboard over same store | 2 | Web Observability Studio + 3D graph + health scorecard |
| 27 | Value ledger (tokens/$ saved) | 1 | ROI tracking exists; not surfaced as user-facing "savings receipt" |
| 28 | Doctor/selftest verification | 2 | `memory doctor`, `memory validate`, benchmark suite, schema referential validator |
| 29 | Session replay / timeline | 2 | Session nodes, observations.jsonl timeline, transcript search with bookends |

### Totals: **42/44** on speed+observability, **11/20** on hands-free, **7/10** on trust-gates at write/recall boundaries.

### The three systemic gaps (ranked by leverage)

**GAP-1 · Write-time citation verification (highest leverage — trust)**
Kage's moat: hallucinated citations rejected at write; stale withheld at recall; 0% stale-served. Muse has *better* primitives (structural hashes, `verifyCodeAnchor`, audit reports) but never invokes verification at the write boundary. `attachAnchorToMemory` stores whatever it is given.

**GAP-2 · Lifecycle hooks (highest leverage — hands-free)**
The entire 2026 hands-free revolution is hooks: capture at PostToolUse/Stop, inject at SessionStart (claude-mem's 5 hooks, agentmemory's 12, deja-vu's 35-agent auto-wire). Muse has the best retrieval engine in its class but requires the agent to *choose* to call it. `src/connect.ts` registers MCP servers; it does not register hooks. Only git pre-commit exists.

**GAP-3 · Recall-time freshness gate (trust/polish)**
Ranking downranks stale but still serves drifted/orphaned-anchor memories. Kage withholds them. A `valid_anchors_only` strict mode would flip Muse from "penalized stale" to "never serve stale" — the single strongest trust benchmark differentiator (Kage: 0% stale-served vs 100% for capture-everything stores).

### Concrete upgrade proposals (priority order)

1. **`enforce` mode for anchor writes** (implements GAP-1) — verify at attach time; reject hallucinated citations with a fail-fast error; auto-mark drifted anchors and stamp `verified_at`. *(Prototyped in this session — see §15.)*
2. **Claude Code hook pack** (GAP-2): `SessionStart` → auto-run `get_context` and inject top-K + CURRENT.md; `PostToolUse` → capture observations.jsonl; `Stop` → distill session candidates. Ship as `memory connect claude-code --with-hooks`, mirroring deja-vu's per-harness wiring.
3. **Strict recall gate** (GAP-3): `include_drifted: false` default in `muse_context`/`get_context`; when a served memory's anchor is drifted, append "⚠ 4 files changed since this memory was written" style provenance instead of silent service (deja-vu pattern).
4. **Event-driven consolidation triggers** (compounding): fire distillation on (a) session end with N+ unconsolidated observations, (b) store threshold, (c) existing 48h-idle cadence as fallback.
5. **Standing answers** (compounding): promote rollups to queryable "mental model" entities — precomputed answers with evidence citation IDs, read as a DB row (hindsight pattern). Boot-time context = CURRENT.md + standing answers, zero retrieval.
6. **Savings ledger** (observability): extend ROI tracking into a `kage gains`-style receipt — per-repo tokens/$ not re-spent, every number traceable to audit.jsonl events.
7. **Topic keys** (compounding): stable `topic_key` slugs (`architecture/auth-model`) so evolving knowledge updates-in-place; reuse `supersede` machinery underneath.
8. **Model-consistency guard for future vectors** (R21): adopt Memvid's `set_vec_model` pattern — persistently bind the store to the embedding model, fail-fast on mismatch before any vector write.
9. **Retroactive index command** (hands-free): `memory retroindex` — bulk-import + distill all discovered JSONL transcripts (agentmemory `import-jsonl` pattern), warning about Claude Code's 30-day `cleanupPeriodDays` deletion.

---

## 15. Prototype: Write-Time Citation Verification (GAP-1)

**Status**: implemented and verified (511/511 tests pass, `tsc --noEmit` clean, build succeeds).

- New module: `src/anchors/verify-write.ts` — `enforceWriteTimeVerification(store, workspaceRoot, entry, opts)`.
- Behavior: for every anchor on a memory, runs `verifyCodeAnchor` against the live filesystem. Hallucinated citations (file/symbol does not exist) are **rejected with `fail_fast`** (default), matching the Vibeguard fail-fast doctrine. Drifted anchors (file exists, body changed) are accepted but flagged, downgraded, and stamped `verified_at`; every decision is written to `audit.jsonl` (`anchor_rejected` / `anchor_drift_flagged`). A `strict` option rejects drift too.
- Wired into: `attachAnchorToMemory` (per-anchor attach path) and `memory_capture`/`anchor_create` MCP tools (entry-level gate), so both the CLI and MCP surfaces are covered.
- Result: Muse gains Kage's core trust property — **hallucinated citations never enter storage** — using its existing structural-hash primitives, zero new dependencies, zero daemons.

- https://carsteneu.github.io/ai-memory-comparison/ (86 systems × 79 features, evidence-cited)
- https://github.com/memvid/memvid
- https://github.com/volcengine/OpenViking
- https://towardsdatascience.com/i-replaced-vector-dbs-with-googles-memory-agent-pattern-for-my-notes-in-obsidian/
- https://github.com/ccrngd1/ProtoGensis (memory-agent-bedrock implementation)
- https://github.com/vshulcz/deja-vu
- https://github.com/thedotmack/claude-mem
- https://github.com/samvallad33/vestige
- https://github.com/christopherkarani/Wax
- https://github.com/Gentleman-Programming/engram
- https://github.com/kage-core/Kage
- https://github.com/rohitg00/agentmemory
- https://github.com/vectorize-io/hindsight
- https://github.com/garrytan/gbrain
- https://github.com/savantskie/persistent-ai-memory
- https://github.com/elie222/rakazo
- https://github.com/milind-soni/OpenMausBot
- https://github.com/CopilotKit/OpenMuse
- https://github.com/ieaves/llm-council
- https://opinionai.substack.com/p/give-perfect-memory-to-your-ai-agent
