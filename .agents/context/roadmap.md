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

### 5. **R21: Zero-API-Key Local Vector Embeddings & Hybrid Search Fusion**
- **In-Process 100% Offline Vector Embeddings (FastEmbed / SQLite-Vec)**:
  - Embedded lightweight quantized embedding models (via ONNX runtime or native SQLite-Vec) running completely in-process.
  - Zero cloud API keys, zero network egress, zero third-party billing, and sub-5ms cosine similarity lookups.
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

