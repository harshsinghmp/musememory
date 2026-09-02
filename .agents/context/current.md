# 📍 Current Shipped State & Active Invariants

> **Version**: `v1.11.0`  
> **Status**: Production / Published to npm (`musememory`)

---

## 🚀 Shipped Capabilities

1. **Dual-Scope Cognitive Engine**: Project-local `.memory/` and global `~/.memory/`.
2. **Deterministic Lifecycle Machine**: Propose → Candidate → Confirm → Supersede → Stale → Delete.
3. **Model Context Protocol (MCP)**: Native stdio server implementing MCP 2024-11-05.
4. **Universal Agent Detection**: Auto-detects and connects 80+ coding agent platforms.
5. **Universal Migrator**: Imports memories from 24+ external formats (AgentMemory, Mem0, Letta, etc.).
6. **Vibeguard Secret Defense**: Built-in regex scanner preventing credential commits to memory.
7. **Compounding & Rollups**: Temporal rollups and token-bag centroid clustering.
8. **In-Process L0 Hot Memory Cache & L1 Context Cache**: Sub-50 microsecond entry lookups, O(1) query caching, and mtime-synchronized dual persistence.
9. **SQLite FTS5 BM25 Engine**: Integrated full-text search virtual tables with sub-2ms lexical search.
10. **Memory Quality & Deduplication**: Deterministic SHA-256 content fingerprinting, canonical memory consolidation with supporting evidence arrays, and temporal mode inference (`current`, `historical`, `timeless`).
11. **Contradiction Engine**: Semantic conflict detection, first-class `conflicted` state machine with mutual `conflict_ids`, and multi-strategy resolution (`supersede`, `historical`, `reject`, `keep_both`).
12. **Utility Tracking & Memory ROI**: Operational feedback loop tracking `application_count`, `successful_applications`, `regressions`, `reuse_success_rate`, and automated dispute escalation.
13. **Ephemeral Observation Tier**: Structured append-only event logging in `.memory/observations.jsonl` from tool results, test outputs, build errors, and review comments.
14. **First-Class Negative Memories**: Explicit capture of `DO_NOT_USE`, `FAILED_APPROACH`, and `BUG_PRONE_PATTERN` with reproduction commands and timeless salience.
15. **Autonomous Distillation & Outcome Feedback Loop**: Distills raw observation streams into candidate fixes/architecture, coupled with automatic session command evaluation and memory reinforcement.
16. **Pluggable Code Intelligence Architecture**: Pluggable provider registry with zero-crash fallback chain (CodeGraph → Graphify → LSP → Heuristic AST scanner → Safe Empty) and automated symbol evidence memory enrichment.
17. **Multi-Factor Ranking Engine**: 11-dimension scoring model combining exact symbol matching, path proximity, FTS5 BM25, graph overlap, blast radius, recency decay, utility ROI, negative warning boosts, and knapsack token budget packing.
18. **Context Compaction & Session Handoff Engine**: 70% context usage threshold detector, 5-invariant lockdown protocol, interruption-proof CURRENT.md checkpoint compilation, and continuous conversational knowledge harvesting.
19. **Scoped Promotion, Generalization & Archival Lifecycle Engine**: 3-tier scope ladder (`local` → `project` → `global`), 5× repeated success policy gate, structural generalization of project specifics into universal principles, and extended archival lifecycle (`active` → `cold` → `dormant` → `archived`) with dynamic query rehydration.
20. **Native Code Anchors & Stable Structural Code Identity**: First-class code anchors (`repository`, `file`, `module`, `symbol`, `route`, `test`), line-independent structural fingerprinting with comment/spacing normalization, and live drift/orphan verification (`valid`, `drifted`, `orphaned`) with repository audit scoring.
21. **Flagship Unified Context Orchestrator & Task-Focused MCP Profiles**: Flagship `muse_context` tool fusing active constraints, code anchors, ranked memories, and negative lessons under strict token budgets with suggested next actions; bidirectional code ↔ memory lookups (`muse_code_for_memory`, `muse_memory_for_code`); and 6 task-focused MCP profiles (`core`, `coding`, `debugging`, `review`, `architecture`, `maintenance`) preventing agent tool bloat.
22. **First-Class Architecture Decision Records (ADRs) & Bidirectional Drift Engine**: ADRs as living memory entities (`proposed`, `accepted`, `superseded`, `rejected`) with native code anchors and supersession lineage; bidirectional documentation ↔ code drift engine classifying alignment (`DOCUMENTED`, `IMPLEMENTED`, `PARTIAL`, `CONFLICTING`, `STALE`, `MISSING`) and scoring repository health.

---

## 🔒 Active System Invariants

- **Zero External Daemons**: All operations must execute in-process via SQLite (`memory.db`) or flat files. Never depend on background servers.
- **Fail Fast**: Throw loudly on secret detection, invalid schema shapes, or unconfirmed supersessions.
- **Verification Gate**: Before declaring changes complete, `bun test`, `bun run build`, and `tsc --noEmit` must pass.
