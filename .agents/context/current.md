# 📍 Current Shipped State & Active Invariants

> **Version**: `v2.3.0`  
> **Status**: Feature Release (Autonomous Memory Optimizer, UI Dashboard Controls & Concurrent Multi-Agent Workstream Tracking)

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
23. **Autonomous Engineering Cognition & "Why" Reasoner**: Historical "Why" explanation engine synthesizing ADRs, bug fixes, trade-offs, and invariants; recurring bug and fragility clustering across 5 root causes; and technical debt scanner detecting TODOs/FIXMEs, `as any` type bypasses, and drifted anchors.
24. **Unified 5-Pillar Project Health Gate (`muse_health`)**: Comprehensive architectural health evaluation auditing store integrity, native code anchors, doc/code alignment, anti-pattern sentry, and technical debt; computes composite grade (A-F), gate status (PASS/WARN/FAIL), prioritized remediation checklist, and CLI dashboard.
25. **Cross-Agent Knowledge Sync & P2P Gossip Protocol (R14)**: Portable sealed `SyncPacket` with SHA-256 integrity, vector clock causal ordering, bidirectional shared pool drop-directory gossip exchange, deduplication, Vibeguard secret scrubbing, and semantic contradiction tagging with mutual `conflict_ids`.
26. **Full Web Observability Studio & Interactive Visual Dashboard (R15)**: Integrated web studio served over local HTTP (`memory studio`), featuring a 5-pillar health scorecard, overall letter grade, prioritized remediation action checklist, ADR registry with code-to-doc drift inspector, autonomous "Why" reasoner, bug friction clusters heatmap, debt hotspots, and live P2P mesh topology visualizer.
27. **Multi-Repo & Monorepo Cross-Project Mesh (R16)**: Automatic workspace detection across pnpm, npm, bun, lerna, and multi-repo sibling groups; cross-project memory querying with origin package provenance; cross-package contract and entrypoint export auditing; explicit mesh linking (`mesh_links.json`); and shared invariant propagation across the entire mesh.
28. **Unified Code & Memory Impact Analysis**: Pre-flight blast radius analysis evaluating AST callers, test suites, governing ADRs, negative warnings, and risk levels (`memory code-impact` / `muse_code_impact`).
29. **PR & Change Context Generator**: Automatically turns git diffs into rich, memory-grounded GitHub PR descriptions linking touched anchors and active constraints (`memory pr-context` / `muse_pr_context`).
30. **Interactive Code Anchor Reconciler**: Audits and repairs code anchors across memories, pruning dead references and updating structural hashes (`memory reconcile` / `muse_reconcile_anchors`).
31. **Latency & Quality Telemetry Suite**: Benchmarks microsecond hot caches, FTS5 BM25 search, knapsack token packing, and ROI in a clean ASCII scoreboard (`memory benchmark`).
32. **Linus-Style Architectural Hardening (v2.2.1)**: Elimination of shell command injection via `execFileSync`, concurrency-safe `PRAGMA busy_timeout = 5000` on SQLite WAL mode, O(N) stat storm elimination in `list(store)`, structured warnings on YAML dual-write failures, and tightened word-boundary/code-anchor ADR matching.
33. **Autonomous Memory Optimizer & Auto-Cadence Engine (v2.3.0)**: Multi-factor noise and junk pruning engine with zero-daemon auto-cadence (every 7 days or after 48h idle), SQLite WAL defragmentation (`VACUUM;` + `PRAGMA optimize;`), CLI command `memory optimize`, and dashboard "⚡ Optimize" button.
34. **Concurrent Multi-Agent Workstream Tracking & Clean `CURRENT.md` (v2.3.0)**: Live `AgentWorkstream` tracking table in `CURRENT.md` enabling multi-agent swarms across separate chat sessions to coordinate active tasks and target scopes; injected into prompt context (`formatPromptContext`, `resolveMuseContext`); sanitized single-pane executive summary for humans with strict grounding rules for agents.

---

## 🔒 Active System Invariants

- **Zero External Daemons**: All operations must execute in-process via SQLite (`memory.db`) or flat files. Never depend on background servers.
- **Fail Fast**: Throw loudly on secret detection, invalid schema shapes, or unconfirmed supersessions.
- **Verification Gate**: Before declaring changes complete, `bun test`, `bun run build`, and `tsc --noEmit` must pass.
