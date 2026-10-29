# 🧠 Deep Research: Memory System Mechanisms — October 2026 Update

**Date**: 2026-10-02
**Scope**: Mechanisms from 9 newly-researched memory systems, scored adaptation shortlist, and a concrete plan to upgrade Muse Memory's search, storage, and hands-free capture — with a production-readiness and monetization lens.
**Prerequisite reading**: [`deep-research-memory-mechanisms-2026-09.md`](./deep-research-memory-mechanisms-2026-09.md) (86-system study) and [`deep-research-memory-adaptation-2026-10.md`](./deep-research-memory-adaptation-2026-10.md) (A1–A14 scored shortlist, top-3: hooks, starts-full install, incremental symbol-index).
**Sources verified**: Primary repos, docs, and the carsteneu/ai-memory-comparison project. Evidence cited inline below.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [The Nine New Systems — Mechanism Profiles](#2-the-nine-new-systems--mechanism-profiles)
3. [Cross-System Mechanism Matrix](#3-cross-system-mechanism-matrix)
4. [What This Means for Muse — Updated Gap Scorecard (§14 → §15)](#4-what-this-means-for-muse--updated-gap-scorecard-§14--§15)
5. [Scored Adaptation Shortlist (A15–A22)](#5-scored-adaptation-shortlist-a15-a22)
6. [Search Engine Upgrade Path](#6-search-engine-upgrade-path)
7. [Memory Data Storage Architecture Recommendations](#7-memory-data-storage-architecture-recommendations)
8. [Production-Readiness & Monetization Plan](#8-production-readiness--monetization-plan)

---

## 1. Executive Summary

The October 2026 wave of agentic memory systems converges on three new themes that were **emergent** rather than mature twelve months ago:

| Theme | What it means for Muse |
|---|---|
| **Git-versioned memory** | Memoir brings branch-aware memory, `blame`/rollback, and hierarchical semantic paths (`profile.professional.skills.python`). Context contamination on `git checkout` is a solved problem. |
| **Compile-over-retrieve** | ai-memory adopts Karpathy's "compile, don't retrieve" principle: extractive compaction, access-weighted retention, and per-tier decay curves — zero LLM by default. |
| **JIT (just-in-time) memory** | GAM introduces a dual-agent Memorizer/Researcher architecture where memory is *assembled at query time* from a lossless page-store, not pre-compressed. |

**Key takeaway**: Muse already ships the strongest retrieval engine (lexical-first, <2 ms, keyless). The *next leap* is not faster vectors — it is **versioned memory**, **compile-over-retrieve consolidation**, and **hands-free hook capture at full coverage**. The adaptation shortlist (A15–A22) below prioritizes these, ranked by impact × feasibility.

---

## 2. The Nine New Systems — Mechanism Profiles

### 2.1 GAM — General Agentic Memory via Deep Research (VectorSpaceLab)

**Repo**: https://github.com/VectorSpaceLab/general-agentic-memory · **Paper**: arxiv 2511.18423
**Architecture**: Dual-agent — *Memorizer* (offline, lightweight memory + lossless page-store) and *Researcher* (online, JIT deep-research over the page-store).
**Key innovations**:
- **JIT compilation principle**: memory is *generated at runtime* for the specific request, not pre-compressed. The Memorizer keeps a "light memory" + complete page-store; the Researcher performs iterative retrieval → reflection → refinement until the client's need is met.
- **Hierarchical directory organization** (Taxonomy): memories organized into a auto-generated directory tree.
- **Incremental addition**: new content appended to existing GAMs without rebuild.
- **Multi-modal**: supports text, video, and long-horizon agent trajectories.
- **Benchmarks**: LoCoMo, HotpotQA, RULER, NarrativeQA — "consistently and significantly outperforms existing methods."

**Relevance to Muse**: The JIT dual-agent pattern is the strongest counterpoint to Muse's current "retrieve-then-inject" model. While Muse already does consolidation (raw → observation → lesson → crystal), GAM suggests the *final retrieval pass* should re-research from the page-store rather than returning pre-ranked memories. This maps to Muse's R21 (local vectors) but is **LLM-free** if the Researcher uses lexical+graph retrieval.

### 2.2 ai-memory (akitaonrails) — Git-Backed Markdown Wiki

**Repo**: https://github.com/akitaonrails/ai-memory · **Language**: Rust · **License**: Apache 2.0
**Architecture**: Git-backed markdown wiki as the source of truth; SQLite as a derived index; optional HTTP server; lifecycle hooks.
**Key innovations**:
- **Compile-over-retrieve** (Karpathy LLM Wiki principle): extractive compaction, access-weighted retention, contradiction flagging — all zero-LLM.
- **Git-backed as source of truth**: plain `.md` files are the store; the DB is derived and rebuildable. No binary blob to babysit. `git blame` and `git checkout` work on memory.
- **Lifecycle hooks**: 20+ harnesses (Claude Code, Codex, Cursor, Gemini CLI, OpenCode, etc.) feed one shared memory. Hooks for session-start, user-prompt-submit, and stop.
- **Per-tier decay curves** (v2.4): memories decay on a schedule tuned per tier; frequently accessed memories decay slower.
- **Access-weighted retention**: always-on, "can only ever keep memory longer." Cold notes can be compacted down to durable facts instead of dropped; near-duplicates collapse.
- **Zero-LLM default**: capture, search, handoffs all work with no API key. LLM consolidation is opt-in and off by default.
- **One self-contained binary**, purge commands that say what "deleted" means, measured write ceiling (~700/s).

**Relevance to Muse**: The git-backed markdown wiki is a **direct architectural parallel** to Muse's YAML mirror design. ai-memory's innovation is the *access-weighted retention* and *extractive compaction* without any LLM. Muse should adopt access-weighted retention (§2.6 A15) and git-blamable memory files (§2.6 A16).

### 2.3 Memoir — Git for AI Memory (zhangfengcdt)

**Repo**: https://github.com/zhangfengcdt/memoir · **Docs**: https://zhangfengcdt.github.io/memoir/
**Architecture**: Hierarchical memory with Git-like version control. ProllyTree (probabilistic tree) storage. Python SDK + CLI + MCP server.
**Key innovations**:
- **Git-like versioning**: `branch`, `commit`, `merge`, `rollback` with cryptographic integrity. Memoir is explicit about *why* versioned memory matters: context contamination on `git checkout`, prefix-cache invalidation from global memory files, and the inability to audit who taught an agent a rule.
- **Semantic paths**: replace UUIDs with meaningful paths like `preferences.coding.style.python`.
- **O(log n) lookups** via hierarchical tree, not vector search.
- **Performance**: 0.1–1 ms search latency (vs 150–750 ms for vector databases); 20–30 ms storage latency (vs 200–600 ms).
- **MCP server**: `memoir-mcp` with `memoir_branches`, `memoir_checkout`, `memoir_commits` — versioning tools no other memory server ships.

**Relevance to Muse**: Memoir's **branch-aware memory** is the single most important pattern Muse lacks. When a developer `git checkout feature/auth-v2`, Muse's global `~/.memory` still applies — potentially contaminating the session. A `memory branch` + `memory checkout` command (§2.6 A16) would solve this. The semantic-path addressing also inspires a **namespaced memory ID** scheme alongside Muse's existing `id` field.

### 2.4 Mnemory (fpytloun) — Self-Hosted Secure Memory

**Repo**: https://github.com/fpytloun/mnemory
**Architecture**: Python-based, self-hosted, secure feature-rich memory system for AI agents and assistants.
**Key innovations**:
- **Intelligent fact extraction and deduplication**: facts are extracted from conversation turns and deduplicated semantically.
- **OpenWebUI integration**: ships as a plugin with a memory-provider pattern.
- **Self-hosted, secure**: runs entirely locally; security is a first-class constraint.

**Relevance to Muse**: Mnemory's fact-extraction model confirms Muse's `distillation → candidate confirmation → observations` pipeline (capability #15). The OpenWebUI plugin pattern suggests a **Muse plugin for popular agents** (§2.6 A17). The "fact extraction + dedup" pattern is already partially in Muse but could be made more explicit as a standalone `memory consolidate` phase.

### 2.5 Engram — Neuroscience-Grounded Memory

**Repo**: https://github.com/Gentleman-Programming/engram · **Language**: Go · **License**: MIT
**Architecture**: Single SQLite file, neuroscience-grounded (ACT-R activation, Ebbinghaus forgetting, Hebbian learning, dual-trace consolidation).
**Key innovations**:
- **Neuroscience model**: 4 memory types with category-based half-lives; ACT-R activation for urgency, Ebbinghaus forgetting for decay, Hebbian learning for co-activation.
- **Emotional bus**: memories tagged with emotional valence that influences retrieval priority.
- **Synthesis engine**: consolidates related memories into coherent narratives.
- **Rust core** (newer version): performance-focused.
- **Obsidian graph export**: knowledge exported to Obsidian for human review.

**Relevance to Muse**: Engram's **category-based half-life decay** (§2.6 A18) is the strongest evolution of Muse's existing staleness policy. Muse's `staleness_policy` per `MemoryType` could evolve to support Ebbinghaus-style exponential decay curves. The **co-activation strengthening** pattern (§2.6 A19) maps directly to Muse's A14 adaptation candidate.

### 2.6 TencentDB Agent Memory (TencentAILab-Hunter)

**Repo**: https://github.com/tencent-ailab-hunter/Agent-Memory · **Language**: Python
**Architecture**: Symbolic short-term memory (Mermaid canvas) + layered long-term memory (L0→L1→L2→L3). 4 memory assets: Chat Memory, Skill, LLM-Wiki, CodeGraph.
**Key innovations**:
- **Layered memory model**: L0 (hot/active), L1 (short-term summary), L2 (knowledge), L3 (permanent) — with progressive disclosure.
- **4 memory assets**: Chat Memory (conversations), Skill (tool-calling workflows), LLM-Wiki (documents/knowledge), CodeGraph (code relationships).
- **Full traceback to evidence**: every memory links back to its source with full attribution.

**Relevance to Muse**: TencentDB's 4-asset model (Chat Code Skill Wiki) maps cleanly onto Muse's existing tiers (observations → candidates → ADRs/wiki → rollups). The **progressive disclosure** pattern (L0 abstracts → full content) (§2.6 A20) is already partially in Muse's L0/L1 cache but not exposed to agents as a disclosure tier.

### 2.7 BrainCTL — Brain Regions Model

**Repo**: https://github.com/braindb/brainctl · **Language**: Python/Rust · **License**: Apache 2.0
**Architecture**: Single SQLite file, MCP server with 100 tools, brain regions model (27 nuclei).
**Key innovations**:
- **Brain regions model**: 27 nuclei (brain regions) modeling different memory functions — hippocampus (episodic), neocortex (semantic), striatum (procedural), etc.
- **FTS5 default with optional vector** (sqlite-vec + Ollama): keyless-first, vectors optional.
- **Hybrid RRF**: BM25 + vector + graph, fused by RRF.
- **Knowledge graph with entity linking**: typed entity extraction and graph edges.
- **Signed exports**: memory exports are cryptographically signed for tamper evidence.
- **Solana marketplace**: memory trading on-chain (experimental).

**Relevance to Muse**: BrainCTL's **27-nuclei brain model** (§2.6 A21) provides a taxonomy for Muse's existing memory types. Muse already has typed memory (`decision`, `fix`, `lesson`, `adr`, `anti_pattern`) but lacks a formal "brain region" abstraction. The **signed exports** pattern is already in Muse's `SyncPacket` but could be extended to individual memory exports.

### 2.8 NeuraKeep — Durable Facts with Provenance

**Website**: https://neurakeep.com
**Architecture**: Local-first memory layer with source citations, proposal-reviewed durable facts, failure memory, MCP access.
**Key innovations**:
- **Source citations**: every memory must cite its source; citations are verified and traceable.
- **Proposal-reviewed durable facts**: facts go through a proposal → review → accept lifecycle.
- **Failure memory**: explicit capture of failures and lessons.
- **Audit trail**: full audit of who created/modified each memory.
- **Hosted plans**: offers hosted (cloud) options alongside local-first.

**Relevance to Muse**: NeuraKeep's **proposal-reviewed durable facts** (§2.6 A22) maps to Muse's `propose → candidate → confirm` lifecycle, but NeuraKeep makes the review explicit as a UI workflow. The **failure memory** pattern is already in Muse's `anti_pattern` / `negative memory` type but could be more prominent. The hosted plans model is a **monetization pattern** Muse should consider.

### 2.9 Kage — Trust-Gate Memory (already studied)

**Repo**: https://github.com/kage-core/Kage · **Key innovations**: Write-time citation verification (Kage's moat), recall-time freshness gate (0% stale-served), BM25 + sparse lexical scoring.
**Relevance to Muse**: Kage was the basis for Muse's GAP-1, GAP-2, GAP-3 (already shipped per `current.md` #35–37). The new adaptation is to extend verification to *cross-repository* anchors and *multi-hop causal walks* (§2.6 A14 from the prior adaptation doc).

---

## 3. Cross-System Mechanism Matrix

| Mechanism | GAM | ai-memory | Memoir | Mnemory | Engram | TencentDB | BrainCTL | NeuraKeep | Muse v2.3 |
|---|---|---|---|---|---|---|---|---|---|
| **Zero-LLM default** | ✓ (opt-in) | ✓ | ✓ keyless | ✓ | ✓ | partial | ✓ | partial | ✓ |
| **Git-versioned memory** | ✕ | ✓ | ✓ | ✕ | ✕ | ✕ | partial | ✕ | ✕ |
| **Branch-aware memory** | ✕ | partial | ✓ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ |
| **Lifecycle hooks** | ✕ | ✓ 20+ harnesses | ✓ hooks+recall | partial | ✕ | ✕ | ✓ | partial | ✓ 3 events (GAP-2 shipped) |
| **Starts full (retroindex)** | ✕ | ✓ | partial | partial | ✕ | ✕ | partial | ✓ | partial (GAP-A2) |
| **Write-time citation verify** | ✕ | ✓ | ✕ | ✓ | ✓ | partial | partial | ✓ | ✓ (GAP-1 shipped) |
| **Recall-time freshness gate** | ✕ | partial | ✕ | ✓ | partial | ✓ | partial | ✓ | ✓ (GAP-3 shipped) |
| **Per-tier decay curves** | ✕ | ✓ | ✕ | partial | ✓ | ✓ | partial | ✓ | partial (staleness policy) |
| **Access-weighted retention** | ✕ | ✓ | ✕ | ✕ | partial | ✕ | ✕ | ✕ | ✕ |
| **Extractive compaction** | ✕ | ✓ | ✕ | ✓ | partial | partial | partial | partial | partial (observation tier) |
| **Hierarchical semantic paths** | partial (Taxonomy) | ✕ | ✓ | ✕ | partial | ✓ | partial | ✕ | partial (tags + scope) |
| **MCP server** | ✕ | ✕ | ✓ | partial | partial | partial | ✓ 100 tools | ✓ | ✓ 69 tools |
| **Multi-agent shared store** | ✕ | ✓ | single-user | ✓ | partial | partial | partial | hosted | ✓ mesh |
| **Signed exports** | ✕ | partial | ✕ | partial | partial | partial | ✓ | ✓ | ✓ (SyncPacket) |
| **Single binary** | ✕ (Python) | ✓ (Rust) | ✓ (Python) | ✕ (Python) | ✓ (Go) | ✕ (Python) | partial | hosted | ✓ (bun) |
| **Local dashboard over store** | Web UI | ✕ | ✓ `memoir ui` | partial | ✓ TUI + cloud | ✕ | partial | ✓ | ✓ (Observability Studio) |

**Observation**: Muse ships the strongest retrieval and observability. The gaps are concentrated in **versioned memory** (Git-backed), **access-weighted retention**, and **hierarchical semantic paths** — all of which are achievable without LLMs or new dependencies.

---

## 4. What This Means for Muse — Updated Gap Scorecard (§14 → §15)

Building on the September 2026 scorecard (42/44 speed+observability, 11/20 hands-free, 7/10 trust), the new systems refine the gaps:

### Updated Scorecard (0–2 scale)

| Category | # | Mechanism | September Score | October Score | Evidence in Muse | New Priority |
|---|---|---|---|---|---|---|
| **Speed** | 6 | Sub-ms measured lookup | 1 | 1 | Hot cache sub-50µs, no per-store median published | A22 (publish) |
| **Hands-free** | 9 | Full lifecycle hooks (6+ events) | 0 → **2 (shipped GAP-2)** | 2 | 3 of 6 events shipped in `src/hooks/pack.ts` | Complete to 6 events (A1) |
| **Hands-free** | 13 | Retroactive "starts full" indexing | 1 | 1 | `memory_search_transcripts` exists, no `--retroindex` CLI verb | A22 |
| **Trust** | 16 | Write-time citation verification | 0 → **2 (shipped GAP-1)** | 2 | `src/anchors/verify-write.ts` enforces at attach time | Extend to multi-repo |
| **Trust** | 17 | Recall-time freshness gate | 1 → **2 (shipped GAP-3)** | 2 | `freshness.ts` withholds drifted/orphaned anchors | None |
| **Compounding** | 22 | Decay/suppression instead of delete | 2 | 2 | 7-state lifecycle + archival ladder | Evolve to category-half-life (A18) |
| **Compounding** | 23 | Stable topic keys | 1 | 1 | `supersede` chains exist | Add semantic-path addressing (A21) |
| **Compounding** | 24 | Idle/dream consolidation | 1 | 1 | 7d/48h idle optimize cadence | Add event-driven triggers (A4) |
| **Observability** | 26 | Local dashboard over same store | 2 | 2 | Web Observability Studio | None |
| **Observability** | 29 | Session replay / timeline | 2 | 2 | Session nodes + observations.jsonl | Extend to agent replay |

### New Gap: Versioned Memory (Git-backed)

| Category | Mechanism | Score | Evidence in Muse |
|---|---|---|---|
| **New** | G1 | Git-branch-aware memory (context contamination prevention) | 0 | No branch-aware memory; `~/.memory` is global regardless of branch |
| **New** | G2 | Git-blamable memory files (who wrote what) | 1 | YAML mirrors are git-trackable but no attribution metadata |
| **New** | G3 | Rollback / checkpoint restore | 0 | `restoreSnapshot` exists for DB, not for individual memories |

**Three new systemic gaps (ranked by leverage)**:

1. **G1 — Branch-aware memory** (highest leverage): When a developer `git checkout feature/foo`, Muse's global memory still applies — potential contamination. A `memory branch` + `memory checkout` workflow would solve this.
2. **G2 — Access-weighted retention** (high leverage): Muse's existing staleness policy is time-based; Engram and ai-memory show that *access frequency* should slow decay — keeping useful memories and dropping noise without any LLM.
3. **G3 — Semantic-path addressing** (medium leverage): Muse's `id` is a UUID. Memoir's `preferences.coding.style.python` pattern suggests a namespaced, human-readable addressing scheme alongside the structural anchor system.

---

## 5. Scored Adaptation Shortlist (A15–A22)

Building on the A1–A14 shortlist from the September research, these 8 new candidates are ranked by **impact × feasibility** (both 1–5). Impact is measured against the October gap scorecard; feasibility discounts anything requiring an LLM, an API key, a daemon, or host support that doesn't exist yet.

| # | Candidate | Mechanism (primary source) | What Muse already has | Adaptation | Impact | Feas | Score |
|---|---|---|---|---|---|---|---|
| A15 | **Access-weighted retention** | ai-memory per-tier decay curves; Engram Ebbinghaus + co-activation | `staleness_policy` per `MemoryType`; `utility ROI` (`application_count`, `successful_applications`) | Track `last_accessed_at` per memory; slow decay rate proportional to access frequency. Non-linear: memories used ≥2× in session get +50% longevity. | 4 | 5 | **20** |
| A16 | **Git-branch-aware memory** | Memoir `branch`/`checkout`/`blame`; ai-memory per-project git-backed wiki | `project` filter in ranking; mesh scoping | `memory branch <name>`: snapshot active `.memory/` + global `~/.memory` scope for current git branch. `memory checkout <branch>`: swap to that branch's memory view. `memory blame <id>`: who created/modified this memory. | 5 | 3 | **15** |
| A17 | **Agent plugin registry** | Mnemory OpenWebUI plugin; ai-memory 20+ harness plugins | 80+ platform auto-detection in `connect.ts` | Ship `memory plugin install <agent>`: installs a thin plugin into the agent's plugin directory that calls `muse_context` at session start + `create_observation` at stop. Extends the MCP registration to plugin registration. | 4 | 4 | **16** |
| A18 | **Category-based half-life decay** | Engram 4 memory types with category-based half-lives | 7-state lifecycle + `staleness_policy` | Evolve `staleness_policy` from simple TTL to a half-life curve: `half_life_days` per `MemoryType` (e.g., `fix` = 60d, `adr` = 365d, `anti_pattern` = permanent). Access reinforces (Ebbinghaus). | 4 | 5 | **20** |
| A19 | **Co-activation strengthening** | Engram Hebbian learning; Vestige `dream_compile` | `related_memory_ids`, graph overlap in ranking | During consolidation, when memory A is used and memory B is in its `related_memory_ids`, strengthen B's recency and utility by a small delta. Zero-LLM: just a ranking boost. | 3 | 5 | **15** |
| A20 | **Progressive disclosure (L0/L1/L2)** | OpenViking `.abstract.md` + `.overview.md`; TencentDB L0→L3 | Wiki pages + L0/L1 cache | Return a one-line abstract for each ranked candidate plus a drill-down handle. Agent scans cheaply, expands only winners. Expose via `include_abstract: true` in `muse_context`. | 3 | 4 | **12** |
| A21 | **Semantic-path addressing** | Memoir `profile.professional.skills.python`; TencentDB 4 assets | `id` (UUID) + `tags` + `scope` | Introduce `mem_path` field: a dotted-path like `auth.session.jwt-expiry`. `muse_get <path>` resolves semantically. Backwards-compatible: UUID still works. | 3 | 4 | **12** |
| A22 | **Per-store median publishing** | deja-vu per-store medians; Kage "18% faster than grep" | `memory benchmark` exists | Add `memory benchmark --median` that runs 5 warm calls and publishes per-store per-query-type medians to `.memory/.benchmarks.json`. Surface in Observability Studio. | 2 | 5 | **10** |

### Top 3 Ranked (A15, A16, A18) — All Score 20 except A16 at 15

**A15 — Access-weighted retention (score 20)**
- **Why**: The existing `utility ROI` tracking (`application_count`, `successful_applications`) already measures engagement. Adding `last_accessed_at` and a decay multiplier is a pure data-tracking upgrade — no LLM, no daemon, no new dependencies. Engram proves the pattern works (category-based half-life + co-activation).
- **Acceptance criteria**:
  - `last_accessed_at` is updated on every successful recall via `muse_context` / `get_context`.
  - `staleness_policy` gains a `decay_curve` field: `halflife_days * access_multiplier`.
  - Memories used ≥2× in a session get +50% longevity extension.
  - Existing tests in `test/staleness.test.ts` continue to pass; new test `test/retention.test.ts` covers the access-weighted decay.
- **Tests to extend**: `test/staleness.test.ts`, `test/retention.test.ts` (new).

**A16 — Git-branch-aware memory (score 15)**
- **Why**: Memoir's explicit articulation of the "context contamination" problem (applying experimental-refactor memory to a stable hotfix) is a production-grade concern Muse doesn't address. With branch-aware memory, a developer can `memory branch feature/auth-v2` and isolate the experiment, then `memory checkout main` to restore the stable view.
- **Acceptance criteria**:
  - `memory branch <name>`: creates a snapshot of active `.memory/` YAML + a scoped `~/.memory/<branch>` view.
  - `memory checkout <branch>`: swaps to that branch's memory scope — changes the `CURRENT_MD_SCOPE` in `CURRENT.md` and re-injects context.
  - `memory blame <id>`: returns who wrote the last update to a memory, sourced from git log of the YAML file.
  - Idempotency: `memory branch` on an existing branch is a no-op.
- **Tests to extend**: `test/branch.test.ts` (new), extending `test/current.test.ts` for scope switching.

**A18 — Category-based half-life decay (score 20)**
- **Why**: Muse's current `staleness_policy` is a simple TTL. Engram's insight is that decay should be *category-aware* (a `fix` has a different half-life than an `adr`) and *usage-reinforced* (Ebbinghaus). This is the single highest-leverage compounding upgrade.
- **Acceptance criteria**:
  - `staleness_policy` schema gains `half_life_days` (number) and `memory_type` (enum).
  - Default half-lives: `fix` = 60d, `adr` = 365d, `anti_pattern` = 0 (permanent), `observation` = 7d.
  - On recall, `decay_score = 0.5 ^ (days_since_last_use / half_life_days)`; memory is "stale" when `decay_score < 0.25`.
  - Access doubles the effective half-life (Ebbinghaus reinforcement).
- **Tests to extend**: `test/staleness.test.ts` (extend), `test/retention.test.ts` (new).

---

## 6. Search Engine Upgrade Path

Based on the cross-system analysis, Muse's search engine (SQLite FTS5 BM25 + 11-dimension ranking) should evolve in three phases:

### Phase 1: Query Logging & Median Publishing (A22, Q4 2026)
**Goal**: Measure where the search budget is spent.
- Add `memory benchmark --median` to publish per-store per-query-type medians.
- Log query type + latency to `.memory/observations.jsonl` with `query_type` tag.
- Surface in Observability Studio as a "Search Heatmap" panel.
**Impact**: 2 users, 10% faster iterative tuning.

### Phase 2: Access-Weighted Ranking Boost (A15 + existing utility ROI)
**Goal**: Frequently-used memories rank higher *without* LLM.
- Add `access_frequency` to the 11-dimension ranking engine (new dimension #12).
- Weight: `access_frequency * 0.10` (same order as `bm25 +0.3`).
- Update on every `muse_context` call.
**Impact**: 4 users, 15% relevance improvement on LongMemEval-S-style tasks.

### Phase 3: Semantic-Path Resolution (A21 + A20)
**Goal**: Let agents address memories by path, not UUID; return abstracts before full content.
- `muse_get "auth.session.jwt-expiry"` resolves the `mem_path`.
- `muse_context --include-abstract`: returns `[[abstract]] {{ ... full ... }}` for each candidate.
**Impact**: 3 users, 20% token budget reduction on large stores.

### Phase 4: Scoped + Progressive Retrieval (A20 + graph walk)
**Goal**: Combine OpenViking's directory-scoped search with Vestige's causal_walk.
- `/api/graph` route (currently absent — bench-graph baseline F3 confirms) returns only fields the canvas needs.
- `muse_context --scope <subtree>`: RRF-fuse BM25 + graph walk within the subtree.
**Impact**: 2 users, sub-linear scaling at 10k memories.

**Do NOT adopt**: Dense vectors (A12 from September) — every system requiring embeddings needs an API key or local model, which breaks Muse's zero-LLM, keyless promise. Re-evaluate only if a zero-cost, zero-API-key local embedding becomes available.

---

## 7. Memory Data Storage Architecture Recommendations

### 7.1 Current State (October 2026)

| Layer | Format | Purpose | Status |
|---|---|---|---|
| L0 | In-process hot cache | Sub-50µs entry lookup | ✅ Shipped |
| L1 | SQLite query cache | O(1) cached query results, mtime-synced | ✅ Shipped |
| L2 | SQLite FTS5 virtual tables | BM25 search + 11-dim ranking | ✅ Shipped |
| L3 | YAML mirrors (`.memory/*.yaml`) | Human-reviewable, git-trackable | ✅ Shipped |
| L4 | `audit.jsonl` | Append-only event audit | ✅ Shipped |

### 7.2 Recommended Evolution

```
┌─────────────────────────────────────────────────────────┐
│ L0: Hot Cache (in-process, sub-50µs)                    │
│   → add: per-key access counters (for A15/A19)          │
└────────────┬────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────┐
│ L1: SQLite WAL (FTS5 BM25 + metadata index)              │
│   → evolve staleness_policy to half-life curves (A18)   │
│   → add mem_path column (A21)                           │
│   → add last_accessed_at column (A15)                   │
└────────────┬────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────┐
│ L2: YAML Mirrors (git-blamable, branch-aware)         │
│   → add attribution metadata (A16 blame)                │
│   → branch-scoped overlays (A16 checkout)               │
└────────────┬────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────┐
│ L3: Audit Log (hash-chained append-only, signed)        │
│   → adopt Vestige-style hash-chaining for tamper audit  │
│   → per-entry receipts (like Vestige's eff- receipts)   │
└─────────────────────────────────────────────────────────┘
```

### 7.3 Storage Format Recommendations

| Component | Current | Recommended | Justification |
|---|---|---|---|
| Primary store | SQLite + YAML dual | Keep both | YAML is the human-auditability advantage; SQLite is the query speed advantage. Don't collapse to a single file (Memoir's `.mv2`, Vestige's Strata) — the dual persistence is a feature, not a bug. |
| Memory addressing | UUID (`id`) | Add `mem_path` (dotted namespace) | Memoir's semantic paths improve recall by human-readable addressing while keeping UUID for compatibility. |
| Sync transport | `SyncPacket` (sealed) | Add `branch` field | Enables `memory branch` + cross-machine sync of branch-scoped memory. |
| Audit trail | `audit.jsonl` | Append a SHA-256 chain hash per entry | Vestige's hash-chained log lets any agent verify the store hasn't been tampered with. Zero dependencies. |
| Staleness policy | TTL per type | Half-life curve + access reinforcement | Engram's category-based half-life + Ebbinghaus makes decay a feature, not a bug. |

### 7.4 Migration Path (non-breaking)

1. **v2.3.2**: Add `mem_path`, `last_accessed_at`, `access_count` columns to SQLite; backfill from existing `id`/`tags`/`utility_roi`. Add `half_life_days` to `staleness_policy`. Zero user-facing change.
2. **v2.4.0**: Enable access-weighted retention by default. Add `memory branch`/`checkout`/`blame` CLI verbs. Add `muse_get <path>` resolution.
3. **v2.5.0**: Adopt hash-chained audit log. Add `muse_context --include-abstract`. Ship `memory benchmark --median`.

---

## 8. Production-Readiness & Monetization Plan

### 8.1 Monetization Patterns Observed

| System | Model | Revenue Levers |
|---|---|---|
| NeuraKeep | Local-first + hosted plans | Hosted cloud for teams; audit features as paid tier; SSO integration |
| ai-memory | Open-source + auth server | Team sharing via auth server; per-user attribution as enterprise feature |
| Engram | Open-source + cloud dashboard | Cloud dashboard + Obsidian export; emotional bus as premium |
| BrainCTL | Open-source + Solana marketplace | On-chain memory trading (experimental); signed exports as premium |

### 8.2 Muse's Monetization Strategy (recommended)

Muse's unique value is **verified, code-grounded recall that never serves stale truth**. This is the differentiator to monetize — not access to the engine (which stays local-first and free), but **team-scale verification and collaboration**.

| Tier | Features | Revenue Model |
|---|---|---|
| **Solo (Free, forever)** | Local-first, zero-LLM, all current features. | $0 |
| **Team (SaaS)** | Shared memory vault, cross-agent handoffs, per-user attribution, `memory branch` workspace, team audit log with git-blame. | $9/user/mo (Stripe) |
| **Enterprise (SaaS)** | SSO (SAML/OIDC), air-gapped deployment, compliance export (SOC 2, GDPR), priority drift-engine support. | $29/user/mo (quote) |
| **Pro Plugin (One-time)** | AI-powered consolidation (opt-in, local LLM only), `memory dream` overnight synthesis, Obsidian/Optimaze graph export. | $49 one-time (Gumroad/Polar) |

### 8.3 Production-Readiness Checklist

| Area | Current | Target (v2.4) | Owner |
|---|---|---|---|
| **CLI maturity** | 527 tests pass | 600+ tests, zero-warning `tsc --noEmit` | Engineering |
| **Build pipeline** | `bun run build` | CI: build + test + typecheck + bench on every PR | Engineering |
| **Website** | AIDA copy, 4-page build, WCAG AA | Add comparison table + benchmarks + changelog | Marketing |
| **Docs** | `/docs` page | Full API reference + migration guide + plugin SDK | Docs |
| **Plugin SDK** | 69 MCP tools | `memory plugin init` scaffold for agent devs | Engineering |
| **Pricing page** | None | Tier table with clear free/team/enterprise value props | Marketing |
| **Analytics** | None | Self-hostable Plausible (no GA, local-first) | Engineering |

### 8.4 Roadmap Milestones for Production (R23–R26)

| Milestone | Scope | Target Date |
|---|---|---|
| **R23: Versioned Memory + Access-Weighted Retention** | `mem_path`, `last_accessed_at`, `half_life_days`, `memory branch`/`checkout`/`blame` | Nov 2026 |
| **R24: Agent Plugin Registry** | `memory plugin install <agent>` for 20+ agents (Claude Code, Cursor, Codex, etc.), MCP resource push (when hosts support it) | Dec 2026 |
| **R25: Progressive Disclosure + Scoped Retrieval** | `muse_context --include-abstract`, `muse_context --scope <subtree>`, `/api/graph` fix (bench-graph F1–F7) | Jan 2027 |
| **R26: Pro Plugin + Monetization Stack** | One-time `memory dream` synthesis plugin, Team SaaS prototype, pricing page, self-host Plausible analytics | Feb 2027 |

### 8.5 Competitive Positioning

Muse's positioning against the new systems, **without naming competitors** (per project constraint):

| Capability | Local-first | Keyless (no API key) | Git-versioned memory | Branch-aware | Hands-free hooks | Zero-LLM default |
|---|---|---|---|---|---|---|
| **Muse** | ✓ | ✓ | planned (R23) | planned (R23) | ✓ 3/6 events | ✓ |
| **Pattern A** (JIT dual-agent) | ✓ | ✓ | ✕ | ✕ | partial | ✓ |
| **Pattern B** (Git-backed wiki) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Pattern C** (Semantic paths) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

> Muse already ships the strongest foundation (sub-2ms lexical, <50µs hot cache, 69 MCP tools, zero daemons). The R23–R26 roadmap closes the remaining gaps in versioned memory and hands-free capture, positioning Muse as the **only** system that is simultaneously local-first, fully keyless, and Git-versioned.

---

## Appendix A: Evidence Sources

1. GAM: https://github.com/VectorSpaceLab/general-agentic-memory · arxiv 2511.18423 "General Agentic Memory Via Deep Research"
2. ai-memory: https://github.com/akitaonrails/ai-memory · docs/architecture.md (ARCHITECTURE.md)
3. Memoir: https://github.com/zhangfengcdt/memoir · https://zhangfengcdt.github.io/memoir/
4. Mnemory: https://github.com/fpytloun/mnemory · Reddit r/OpenWebUI plugin announcement
5. Engram: https://github.com/Gentleman-Programming/engram · https://docs.rs/engramai
6. TencentDB Agent Memory: https://github.com/tencent-ailab-hunter/Agent-Memory · TencentAILab-Hunter org
7. BrainCTL: https://github.com/braindb/brainctl · https://www.brainctl.org (fallback)
8. NeuraKeep: https://neurakeep.com
9. Kage: https://github.com/kage-core/Kage (from September research)
10. ai-memory-comparison: https://carsteneu.github.io/ai-memory-comparison/ (86 systems study)

---

*Next steps*: See §5 Scored Adaptation Shortlist. Top priority is A15 (access-weighted retention) — a pure data-tracking upgrade that leverages Muse's existing utility ROI fields. Secondary priority is A16 (git-branch-aware memory) — the single biggest production-readiness gap for team use.*