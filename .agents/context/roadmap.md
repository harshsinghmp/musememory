# 🗺️ Muse Memory Roadmap & Backlog

---

## ✅ Completed Milestones
- **R14: Cross-Agent Knowledge Sync & P2P Gossip Protocol**: Sealed SyncPackets, vector clock causal tracking, filesystem shared pool drop-directory synchronization, contradiction tagging.
- **R15: Full Web Observability Studio**: Embedded visual web dashboard (`memory studio`) featuring 5-pillar health scorecards, ADR drift inspection, autonomous "Why" reasoner, and live mesh visualization.
- **R16: Multi-Repo & Monorepo Cross-Project Mesh**: Monorepo auto-discovery (pnpm, npm, bun, lerna), cross-project memory resolution with origin provenance, cross-package contract integrity auditing.
- **GAP-1 (2026-09-30): Write-Time Citation Verification** — hallucinated citations rejected at write; shipped in `src/anchors/verify-write.ts` + MCP `memory_anchor_create` gate. From the 2026-09 memory-mechanisms deep research (`.agents/context/deep-research-memory-mechanisms-2026-09.md` §14–15).
- **GAP-2 (2026-09-30): Claude Code Lifecycle Hook Pack** — SessionStart/PostToolUse/Stop hooks, hands-free capture & injection; `memory hooks install` / `memory connect --with-hooks`. Same research §14 (GAP-2).
- **GAP-3 (2026-09-30): Recall-Time Freshness Gate** — drifted/orphaned-anchor memories withheld from `muse_context` by default with explicit notices; `include_drifted` opt-in. Same research §14 (GAP-3). Remaining roadmap below.

---

## 🚀 Active Roadmap & Future Horizons (Agentic Cognitive OS Evolution)

### 1. **R17: Tri-Cognitive Memory Architecture (Procedural Playbooks & Episodic Horizons)**
- **Procedural Playbook Engine (`ProceduralMemory`)**:
  - Capture executable tool-calling workflows, pre-conditions, step trajectories, verification assertions, and rollback recipes distilled from successful agent sessions.
  - Tool additions: `muse_playbook_recall`, `muse_playbook_record`, `memory playbook --run <id>`.
- **Episodic Causal Narrative Horizon**:
  - Transform flat observation streams into structured episodic sequences: `Goal ➔ Hypothesis ➔ Action Trajectory ➔ Verification ➔ Retrospective Insight`.
  - Enables agents to query historical causal chains ("Have we attempted this fix before, and what was the failure cascade?").
- **Bi-Temporal Validity Windows (Zep / Graphiti Temporal Pattern)**:
  - Dual timestamps: transaction assertion time (`asserted_at`) and valid world time (`valid_from` / `valid_until`).
  - Prevents historical regressions during git blame/code reviews of legacy branches without clobbering modern rules.
- **Ebbinghaus Utility-Reinforced Cognitive Forgetting Curve**:
  - Automated half-life decay for unverified candidate notes; exponential reinforcement for memories with verified green test runs and high reuse ROI.

---

### 2. **R18: AST Associative Callgraph Retrieval & Speculative Pre-Flight Recall**
- **Recursive SQLite CTE Associative Expansion (Zero-Daemon HippoRAG Pattern)**:
  - 2-hop associative graph traversal using in-process SQLite recursive CTEs (`WITH RECURSIVE call_tree AS (...)`).
  - Queries touching an entrypoint symbol automatically pull governing ADRs, test requirements, and negative anti-patterns anchored to downstream callees.
- **Speculative Pre-Flight Context Push**:
  - Git/editor hooks that pre-calculate the optimal token-budgeted memory knapsack upon file opening or branch switching (`feat/*`), eliminating agent context-query latency.
- **Cross-File Symbol Blast-Radius Risk Scoring**:
  - Correlates AST identifiers with route handlers, exported interfaces, and test files to provide instant pre-flight risk ratings for proposed changes.

---

### 3. **R19: Git-Branchable Memories & Multi-Tenant Agency Enclaves**
- **Git-Aware Branchable Memory Overlays (`memory branch`)**:
  - Branch-isolated working memory overlays that mirror git branch lifecycles (`feature/*`, `fix/*`).
  - Automated `memory branch-merge` command with interactive semantic contradiction resolution when merging feature branches into `main`.
- **Agency Multi-Tenant Enclaves (`scope: client`)**:
  - Cryptographically isolated client memory vaults tailored for multi-client agency delivery (Sol, Jasper, Crew, Nexus).
  - Enforces zero cross-client knowledge contamination while allowing global engineering invariants (`scope: global`) to propagate safely.
- **Zero-Knowledge Memory Attestation**:
  - Cryptographic SHA-256 signing of SyncPackets with tamper-evident audit chains for verifiable client handoffs.

---

### 4. **R20: Test-Driven Memory Reinforcement & Autonomous Regression Sentry**
- **Automated CI / Test Harness Integration Loop**:
  - Binds memory utility ROI directly to test outcomes (`bun test`, `vitest`, `jest`, `cargo test`).
  - Passing tests increment memory confidence and `successful_applications`; failing tests trigger automated dispute and regression tracking.
- **Negative Anti-Pattern Regression Sentry**:
  - Proactive watchdog matching test failure signatures and stack traces against known `BUG_PRONE_PATTERN` and `DO_NOT_USE` entries, generating immediate remediation playbooks.
- **Flaky Test & Environment Drift Detector**:
  - Correlates test intermittency with past dependency upgrades, node runtime versions, and environmental invariants.

---

### 5. **R21: Local Vector Embeddings & Hybrid Search Fusion (engine: llama.cpp)**
- **Local embedding engine — llama.cpp server (default)**:
  - `llama-server` with a small GGUF embedding model (e.g. bge-small / nomic-embed-text), CPU-only, started on demand — no background service.
  - One OpenAI-compatible `/v1/embeddings` adapter (zero npm deps, bun `fetch`): llama.cpp, Ollama, hosted providers, and a future Hermes embedding facade are the same code path behind a URL.
  - Embedding pipeline fingerprint (`model|dims|endpoint`) stored with the vector index; mismatch refuses reuse and requires `memory embed reindex` (qdrant-memory `init` pattern).
  - Vectors as float32 BLOBs in SQLite; brute-force cosine at current store scale — no ANN index until measured otherwise.
  - **Unblocks A12** (dense vectors, deferred in the October research): the re-evaluation condition — "zero-cost, zero-API-key local embedding" — is now met. Embeddings stay **opt-in / off by default**; the keyless lexical path remains the default.
- **Reciprocal Rank Fusion (RRF) Hybrid Engine**:
  - Mathematical fusion blending SQLite FTS5 BM25 lexical ranking, AST symbol proximity, and dense semantic vector similarity into a unified top-$K$ candidate set.

---

### 6. **R22: Agent Development Environment (ADE) & Meta-Cognitive Self-Reflection MCP**
- **Agent Self-Reflection MCP Tooling (`muse_reflect`)**:
  - End-of-session reflective pass allowing agents to critique their own trajectory, extract reusable lessons, and update `CURRENT.md` checkpoints.
- **Counterfactual Decision Reasoner (`muse_counterfactual`)**:
  - Records why alternative options were discarded during architecture reviews, preventing future agents from re-proposing rejected paths.
- **Autonomous Memory Consolidation & Synthesis (A-Mem Evolution Pattern)**:
  - Zero-daemon background consolidation that synthesizes related micro-memories into coherent macro-concepts and updates inter-memory links.

## 🧬 R23–R26: Production-Readiness & Versioned Memory Milestones

### 7. **R23: Versioned Memory + Access-Weighted Retention**
- **`Memory Versioning` (Git-branchable memory)**:
  - `mem_path` field: human-readable dotted-path addressing (e.g., `auth.session.jwt-expiry`).
  - `memory branch <name>`, `memory checkout <branch>`, `memory blame <id>` CLI verbs.
  - Branch-isolated `.memory/` + `~/.memory/<branch>` scope snapshots with `CURRENT_MD_SCOPE` switching.
  - Backwards-compatible: UUID `id` still works alongside `mem_path`.
- **`Access-Weighted Retention` (A15)**:
  - `last_accessed_at` and `access_count` columns added to SQLite; backfilled from existing `utility_roi`.
  - `staleness_policy` gains `half_life_days` field; decay curve: `0.5 ^ (days_since_last_use / half_life_days)`.
  - Memories used ≥2× in a session get +50% longevity extension.
  - Default half-lives: `fix` = 60d, `adr` = 365d, `anti_pattern` = permanent, `observation` = 7d.
- **Acceptance criteria**:
  - `last_accessed_at` updated on every successful `muse_context` / `get_context` recall.
  - `memory branch`/`checkout`/`blame` verbs work in non-git folders (single main branch).
  - Existing tests in `test/staleness.test.ts` continue to pass; new `test/retention.test.ts` and `test/branch.test.ts` cover the new behaviour.

---

### 8. **R24: Agent Plugin Registry**
- **`memory plugin install <agent>`**:
  - Thin plugin installers for 20+ agents (Claude Code, Cursor, Codex, Gemini CLI, OpenCode, Hermes, OpenClaw, VS Code, Cline, Windsurf, Zed).
  - Extends MCP registration to plugin registration; each plugin calls `muse_context` at session start + `create_observation` at stop.
- **`memory plugin init`**:
  - Scaffold for agent plugin developers (`.mcp.json` + hooks + skills template).
- **Acceptance criteria**:
  - `memory plugin list` shows supported agents.
  - `memory plugin install claude-code` produces a working hook setup.
  - Documentation at `/docs/plugins`.

---

### 9. **R25: Progressive Disclosure + Scoped Retrieval**
- **Progressive disclosure**:
  - `muse_context --include-abstract`: returns a one-line abstract per candidate plus a drill-down handle.
  - Agent scans cheaply, expands only winners.
- **Scoped retrieval**:
  - `muse_context --scope <subtree>`: RRF-fuse BM25 + graph walk within the subtree.
  - `/api/graph` route fix (bench-graph baseline F1–F7): returns only fields the canvas needs.
- **Acceptance criteria**:
  - `--include-abstract` reduces token usage on large stores by ~20%.
  - `--scope` sub-linear scaling at 10k memories.
  - `/api/graph` eliminates F1–F7 failures from bench-graph baseline.

---

### 🔟 **R26: Pro Plugin + Monetization Stack**
- **Pro Plugin (One-time purchase)**:
  - `memory dream`: overnight synthesis of related micro-memories into macro-concepts (opt-in, zero-LLM by default; local LLM optional).
  - Obsidian/Optimaze graph export.
  - Distributed via Gumroad/Polar at $49 one-time.
- **Team SaaS (Subscription)**:
  - Shared memory vault, cross-agent handoffs, per-user attribution.
  - `memory branch` workspace command for team isolation.
  - Team audit log with git-blame.
  - $9/user/mo (Stripe).
- **Enterprise SaaS (Quote)**:
  - SSO (SAML/OIDC), air-gapped deployment, compliance export (SOC 2, GDPR).
  - $29/user/mo.
- **Solo (Free, forever)**:
  - All current features, local-first, zero-LLM. $0.
- **Other production-readiness items**:
  - Self-hostable Plausible analytics (no GA, local-first).
  - Pricing page at `/pricing`.
  - `memory benchmark --median` publishing per-store medians.

---

## 📊 Current Status (as of v2.3.0)

| Area | Status | Next Milestone |
|---|---|---|
| **Speed & Observability** | ✅ Shipped (sub-2ms, <50µs hot cache, 527 tests) | R25 (--include-abstract, --scope) |
| **Hands-free hooks** | ✅ 3/6 events shipped (GAP-2) | R24 (full plugin registry) |
| **Trust gates** | ✅ Write-time verify + recall-time freshness gate (GAP-1, GAP-3) | R23 (extend to multi-repo) |
| **Version control** | ⚠️ No branch-aware memory | R23 (memory branch/checkout/blame) |
| **Compounding** | ✅ 7-state lifecycle + archival ladder | R23 (access-weighted retention, half-life decay) |
| **Team/SaaS** | ⚠️ Not yet built | R26 (pricing page, Plausible, SaaS prototype) |

---

### 11. **R27: Recall Quality Eval Harness (LoCoMo-style, CI-gated)**
- **Golden recall fixture**: labeled queries plus same-topic distractors covering the five LongMemEval-V2 abilities (static state recall, dynamic state tracking, workflow knowledge, environment gotchas, premise awareness). Muse already covers 3–4 of the 5; the fixture proves it.
- **CI gate**: `bun test` fails below a recall@5 threshold; p50 latency reported beside it. Current benchmarks measure speed only — recall quality is unmeasured.
- Reuses `src/benchmark/` and existing test infrastructure. Prerequisite for judging R21 and every future retrieval change.

### 12. **R28: Memory Poisoning Trust Tiers (OWASP ASI06)**
- **`trust: trusted | candidate | untrusted`** set by ingest source: known agent transcripts are candidates; web or external content is untrusted.
- `muse_context` filters untrusted by default and reports `withheld_memories` — mirrors the GAP-3 freshness gate pattern.
- Reuses `src/provenance.ts` and `src/orchestrator/freshness.ts`.

### 13. **R29: I/O Budget & NVMe Telemetry**
- **`memory io`**: bytes-written/day from `/proc/self/io` with an alert threshold — makes SSD wear visible instead of theoretical.
- YAML dual-write mirror becomes async-batched or opt-out (it currently doubles every write's amplification).
- Rotation caps for `audit.jsonl` / `observations.jsonl` via existing `src/retention.ts`; `wal_autocheckpoint` tuning note.

### 14. **R30: Tombstones & Scoped Deletion (extends A7 suppress)**
- **Content-hash tombstones on delete**: replayed events cannot resurrect deleted memories (qdrant-memory fence pattern; A7's suppress state already hides the bytes).
- `memory delete-all --scope <user|client> --confirm` with a fail-closed `recovery_required` state on interruption (agency client-data deletion).

### 15. **R31: Multi-Writer Merge (extends R19 + sync mesh)**
- Concurrent writers on one shared store: observations merge append-only; memory-level conflicts are flagged, never clobbered (existing contradiction invariant).
- Reuses `src/sync/` vector clocks and the contradiction engine. Single-writer remains the default; merge mode is opt-in. No distributed locks.

### 16. **R32: Studio Recall-Debug (extends R15 + A22)**
- Surface `ranking.ts` per-factor score breakdowns in the Observability Studio: *why* was this memory retrieved.
- Eval-harness (R27) results panel. Small diffs on `src/ui.ts`.
