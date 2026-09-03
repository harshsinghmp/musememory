# 📜 Changelog

All notable changes to the **Muse Memory** (`musememory`) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-09-03

### Summary
Major feature expansion introducing Cross-Agent Knowledge Sync & P2P Gossip Protocol (R14), Full Web Observability Studio (R15), and Multi-Repo & Monorepo Cross-Project Mesh (R16).

### Added
- **Cross-Agent Knowledge Sync & P2P Gossip Protocol (`src/sync/`)**:
  - `SyncPacket` engine with whole-packet SHA-256 integrity verification and vector clock causal ordering (`src/sync/packet.ts`).
  - Gossip state machine with deduplication, inline Vibeguard credential scrubbing, and semantic contradiction tagging with mutual `conflict_ids` (`src/sync/engine.ts`).
  - Shared filesystem drop-directory gossip pool (`src/sync/pool.ts`) for zero-daemon multi-agent pods.
  - CLI command: `memory sync` (`--status`, `--broadcast`, `--ingest`, `--pool`, `--agent-id`, `--pool-dir`).
  - MCP tools: `muse_sync_broadcast`, `muse_sync_ingest`, `muse_sync_status`, `muse_sync_pool`.
- **Full Web Observability Studio (`src/ui.ts`)**:
  - Embedded web dashboard control plane accessible via `memory studio` (or `memory ui`).
  - 5-Pillar Project Health Gate card with letter grade (A-F), composite score (0-100), pillar progress bars, and actionable remediation checklist.
  - Interactive ADR registry and bi-directional documentation ↔ code drift audit table.
  - Autonomous historical "Why" reasoner query interface explaining code evolution.
  - Fragility bug clustering heatmap and technical debt scanner report.
  - Live P2P gossip mesh status and interactive broadcast/shared pool sync controls.
  - 9 REST API endpoints: `/api/health`, `/api/adrs`, `/api/drift`, `/api/cognition/why`, `/api/cognition/clusters`, `/api/cognition/debt`, `/api/sync/status`, `/api/sync/pool`, `/api/sync/broadcast`.
- **Multi-Repo & Monorepo Cross-Project Mesh (`src/mesh/`)**:
  - Workspace monorepo discovery (`src/mesh/discovery.ts`): auto-detects pnpm, npm, bun, lerna workspaces, and sibling git repositories.
  - Explicit external repository linking via `.memory/mesh_links.json`.
  - Cross-project memory query resolver (`src/mesh/resolver.ts`): queries memories across all package stores with origin package provenance tags (`[mesh:@scope/pkg]`).
  - Shared invariant and working constraint propagation across the workspace mesh (`propagateConstraintToMesh`).
  - Cross-package dependency contract and entrypoint export auditor (`src/mesh/contracts.ts`) validating cross-package imports and cross-repo code anchors.
  - CLI command: `memory mesh` (`query`, `check`, `link`, `unlink`, `propagate`).
  - MCP tools: `muse_mesh_status`, `muse_mesh_query`, `muse_mesh_audit`, `muse_mesh_link`.
  - Studio panel: 🕸️ Monorepo Mesh tab with topology cards, package node grid, cross-project search, and contract audit table.

## [2.0.0] - 2026-09-03 — Autonomous Cognitive Engine Major Overhaul

### Summary
Major architectural milestone evolving Muse Memory from an episodic store into an autonomous, self-correcting, evidence-aware cognitive engine with native code anchors, first-class ADRs, bidirectional drift auditing, "Why" reasoning, and a 5-pillar health gate.

## [1.22.0] - 2026-09-03

### Added
- **Unified 5-Pillar Project Health Gate (`src/health/gate.ts`)**:
  - Comprehensive single-call architectural and memory health evaluation across 5 critical pillars:
    1. *Memory Store Integrity*: Contradictions, unverified/expired memories, timeless constraints.
    2. *Native Code Anchor Validity*: Live AST structural verification, drift detection, orphaned anchors.
    3. *Documentation ↔ Code Alignment*: Bi-directional drift, undocumented exports, stale references.
    4. *Negative Lessons & Anti-Pattern Sentry*: Saliency and defense against known traps.
    5. *Technical Debt & Friction*: TODO/FIXME/HACK markers, `as any` type bypasses, recurring bug clusters.
  - Generates composite score ($0 \dots 100$), letter grade (`A`, `B`, `C`, `D`, `F`), and gate status (`PASS`, `WARN`, `FAIL`).
  - Produces an automated, prioritized Actionable Remediation Checklist.
- **CLI Health Command (`src/cli/health.ts`)**:
  - `musememory health`: Rich terminal dashboard with ANSI styling, pillar scorecards, and remediation lists.
  - Supports `--json` flag for CI/CD gates and exit code 1 on `FAIL` status.
- **New MCP Tool (`src/mcp.ts`)**:
  - `muse_health`: Exposes the 5-pillar health audit to AI coding agents with profile integration across `review`, `architecture`, and `maintenance`.

## [1.21.0] - 2026-09-03

### Added
- **Autonomous Engineering Cognition & "Why" Reasoner (`src/cognition/why.ts`)**:
  - `explainWhyCodeIsTheWayItIs`: Synthesizes the historical rationale behind a piece of code, symbol, or constraint.
  - Chronological timeline reconstructing initial architectural decisions, hardening bug fixes, accepted trade-offs, negative warnings, and timeless invariants.
  - Generates evidence-backed confidence scores ($0.0 \dots 1.0$) based on authoritative verifications and native code anchors.
- **Recurring Bug & Friction Clustering (`src/cognition/clustering.ts`)**:
  - `clusterRecurringBugsAndFriction`: Automatically clusters bug fixes, negative lessons, and failure records into architectural fragility hotspots.
  - 5 root-cause categories: race conditions, type drift, missing boundary guards, resource leaks, and architecture flaws.
  - Computes fragility scores per subsystem and formulates root-cause hypotheses with preventative recommendations.
- **Technical Debt & Workaround Registry (`src/cognition/tech-debt.ts`)**:
  - `analyzeTechnicalDebt`: Scans repository files and memory store for debt markers (`// TODO:`, `// FIXME:`, `// HACK:`, `// WORKAROUND:`), dangerous `as any` type assertions, and drifted code anchors.
  - Calculates composite technical debt score ($0 \dots 100$) and surfaces top hotspot files.
  - Generates prioritized, memory-grounded refactoring recommendations.
- **New MCP Tools (`src/mcp.ts`)**:
  - `muse_why`: Autonomous "Why" code explanation engine.
  - `muse_bug_clusters`: Recurring bug hotspot clustering and fragility analysis.
  - `muse_tech_debt`: Technical debt and workaround scanner.

## [1.20.0] - 2026-09-03

### Added
- **First-Class Architecture Decision Records (`src/adrs/engine.ts`)**:
  - Treats ADRs as living, queryable memory entities rather than static dead files.
  - Auto-incrementing sequential ADR numbering (`ADR-1`, `ADR-2`, etc.).
  - Structured ADR format: status (`proposed`, `accepted`, `superseded`, `rejected`), context & drivers, decision, consequences (positive, negative trade-offs, neutral), options considered (with pros, cons, rejection reasons), and native code anchors.
  - Native ADR supersession workflow: mutually links older ADRs to newer replacements with append-only audit tracking.
- **Bidirectional Documentation ↔ Code Drift Engine (`src/adrs/drift.ts`)**:
  - `detectDocumentationCodeDrift`: Compares memory/ADR claims against live filesystem ASTs and conversely scans code for undocumented exports.
  - 6-state alignment classification:
    - `DOCUMENTED`: Documented memory confirmed present in live codebase.
    - `IMPLEMENTED`: ADR decision verified in source implementation.
    - `PARTIAL`: Code signature or implementation body drifted from documented hash.
    - `CONFLICTING`: Direct contradiction with active architectural rules.
    - `STALE`: Outdated documentation pointing to deleted or renamed files/symbols.
    - `MISSING`: Exported code symbols lacking any documentation or architectural record.
  - Computes repository alignment score and provides actionable remediation suggestions.
- **New MCP Tools (`src/mcp.ts`)**:
  - `memory_adr_record`: Record a first-class Architecture Decision Record.
  - `memory_adr_list`: List ADRs filtered by status.
  - `memory_drift_audit`: Run bidirectional documentation ↔ code drift audit.

## [1.19.0] - 2026-09-03

### Added
- **Flagship Unified Context Orchestrator (`src/orchestrator/context.ts`)**:
  - `muse_context`: Single-call fused entry point accepting query, active file, symbol, error message, task intent, and token budget.
  - Returns ranked memories, code anchor matches, negative anti-pattern warnings, active `CURRENT.md` constraints, and actionable next steps in one unified payload.
  - Strict token-budget knapsack packing: prioritizes active invariants and negative lessons to prevent context overflow while preserving essential constraints.
- **Bidirectional Code ↔ Memory Lookups (`src/orchestrator/bidirectional.ts`)**:
  - `muse_code_for_memory`: Given a memory ID, extracts all anchored code files, symbols, and backtick references.
  - `muse_memory_for_code`: Given a file path or symbol, returns all associated decisions, negative lessons, and constraints.
- **Task-Focused MCP Profiles (`src/orchestrator/profiles.ts`)**:
  - 6 dedicated profiles reducing agent context bloat: `core`, `coding`, `debugging`, `review`, `architecture`, `maintenance` (plus `full`).
  - Filter tools dynamically via `MUSE_MCP_PROFILE` environment variable or `createServer` initialization.
- **New MCP Tools (`src/mcp.ts`)**:
  - `muse_context`: Flagship unified context fusion.
  - `muse_code_for_memory`: Code reference extraction for memory entry.
  - `muse_memory_for_code`: Associated memory search for codebase file/symbol.
  - `muse_profile_list`: Profile inspector and tool definitions.

## [1.18.0] - 2026-09-03

### Added
- **Native Code Anchors & Stable Structural Code Identity (`src/anchors/`)**:
  - First-class code anchor entities independent of any external provider (`repository`, `file`, `directory`, `module`, `symbol`, `qualified_symbol`, `route`, `test`, `commit`, `pr`).
  - Structural fingerprinting engine (`src/anchors/fingerprint.ts`): normalizes comments, punctuation spacing, and whitespace to generate stable, line-independent SHA-256 structural hashes.
  - Immunity to line shifts, formatting, and documentation comments while remaining strictly sensitive to AST/logic changes.
  - Balanced brace block extractor for functions, classes, methods, and arrow expressions.
  - Code-aware drift and orphan verification (`src/anchors/resolver.ts`): detects deleted files/symbols (`orphaned`), code logic modifications (`drifted`), and verified matches (`valid`).
  - Repository-wide anchor audit (`auditMemoryAnchors`): calculates store integrity score and flags degraded anchors with append-only audit trail logging.
- **New MCP Tools for Code Anchors (`src/mcp.ts`)**:
  - `memory_anchor_create`: Create and attach a structural code anchor to a memory entry.
  - `memory_anchor_verify`: Verify code anchors on a memory entry against live repository files.
  - `memory_anchor_audit`: Run repository-wide audit of all code anchors and compute integrity metrics.

## [1.17.0] - 2026-09-03

### Added
- **Scoped Promotion & Generalization Engine (`src/promotion/`)**:
  - 3-tier scope migration ladder: `LOCAL` (workspace/session) → `PROJECT` (repo `.memory/`) → `GLOBAL` (reusable cross-project `~/.memory/`).
  - 5× Success Promotion Policy: enforces `>= 5` successful uses, 100% success rate, 0 regressions, 0 conflicts, and sufficient evidence before automatic global promotion.
  - Generalization Engine (`src/promotion/generalization.ts`): scrubs specific repository file paths, line numbers, and commit hashes into universal architectural principles.
  - Manual global promotion support bypassing 5× requirement with full provenance.
  - Promotion audit records in `.memory/audit.jsonl` with operation `promote`.
- **Extended Archival Lifecycle & Dynamic Rehydration (`src/promotion/archival.ts`)**:
  - Multi-tier lifecycle: `ACTIVE` → `COLD` → `DORMANT` → `ARCHIVED`.
  - Stale policy and utility evaluation sweeps automatically transitioning aging, unused, or superseded memories down the tier ladder.
  - Dynamic Rehydration: automatically restores `ARCHIVED`/`DORMANT` memories to `ACTIVE`/`CONFIRMED` upon high retrieval query relevance match.
  - Archival audit records with operations `archive` and `rehydrate`.
- **New MCP Tools for Promotion and Lifecycle (`src/mcp.ts`)**:
  - `memory_evaluate_promotion`: Evaluates an entry against the 3-tier promotion ladder and 5× success rule.
  - `memory_promote`: Executes scoped promotion (local → project or project → global) with generalization.
  - `memory_generalize`: Previews and tests content generalization.
  - `memory_archive`: Transitions memory entries to cold, dormant, or archived tiers.
  - `memory_rehydrate`: Restores archived memories back to active status.
  - `memory_lifecycle_status`: Inspects store-wide lifecycle distribution and triggers optional archival sweeps.

## [1.16.0] - 2026-09-03

### Added
- **Context Compaction & Interruption-Proof Session Handoff Engine (`src/compaction/`)**:
  - Context usage evaluation enforcing the 70% threshold invariant: `"Context at 70%. Compact now or continue?"`.
  - Canonical 5-invariant lockdown protocol:
    1. High level goal of your build spec
    2. Current architecture and data flow
    3. What is already implemented and considered done
    4. What is explicitly not done yet
    5. The next concrete task we are working on
  - Interruption-proof checkpoint compiler: writes structured handoffs into `.memory/CURRENT.md` with compact resumption prompt generation.
  - Continuous Session Memory Harvester (`src/compaction/harvester.ts`): automatically extracts durable decisions, bug fixes, invariants, and negative lessons directly from conversational turns without user friction.
- **New MCP Tools for Compaction and Harvesting (`src/mcp.ts`)**:
  - `memory_compaction_check`: Check token usage against the 70% threshold.
  - `memory_compact_handoff`: Lock down the 5 invariants and compile interruption-proof `CURRENT.md` handoff.
  - `memory_harvest_turn`: Continuously harvest durable knowledge from agent turns.

## [1.15.0] - 2026-09-03

### Added
- **Multi-Factor Ranking Engine (`src/retrieval/ranking.ts`)**:
  - Replaces naive retrieval with an 11-dimension scoring model:
    - Exact symbol match: +1.0
    - Path / directory match: +0.4
    - Lexical BM25 match via SQLite FTS5: +0.3
    - Graph / call-graph overlap: +0.3
    - Blast-radius relevance: +0.25
    - Recency decay: -0.05 per 30 days untouched (timeless constraints immune)
    - Utility / reuse success-rate bonus: +0.25 for verified high-utility memories
    - Negative lesson warning bonus: +0.3 for anti-patterns matching query/paths
    - Invariant / timeless boost: +0.2 for constraints
    - Status penalties: -0.8 conflicted, -0.5 stale/superseded
  - Priority-based knapsack token budget packing: ensures critical project invariants and constraints fit first without overflowing token budgets.
- **New MCP Tool for Multi-Factor Ranked Retrieval (`src/mcp.ts`)**:
  - `memory_ranked_retrieval`: Queries memories with full 11-factor scoring breakdowns and knapsack token packing.

## [1.14.0] - 2026-09-03

### Added
- **Pluggable Code Intelligence Provider Architecture (`src/intelligence/`)**:
  - Standardized `CodeIntelligenceProvider` interface specifying `resolveSymbols`, `getCallers`, `getCallees`, `getRelatedFiles`, `getBlastRadius`, and `extractGraphContext`.
  - Dynamic `ProviderRegistry` with automatic capability detection and zero-crash fault isolation.
  - Multi-tier fallback chain: CodeGraph → Graphify → LSP → Heuristic Fallback → Safe Empty.
  - Zero mandatory external dependencies: pure autonomous operation if no external intelligence engines are present.
- **Optional Provider Adapters (`src/intelligence/adapters/`)**:
  - `CodeGraphProvider`: Integrates with `.codegraph` indexes or CLI when available.
  - `GraphifyProvider`: Ingests graph networks and dependencies from `.graphify/graph.json`.
  - `LspProvider`: Hooks into language server protocols or agent-lsp when active.
  - `HeuristicFallbackProvider`: Built-in zero-dependency AST/regex file scanner providing baseline symbol and relationship resolution across workspace files.
- **Code Intelligence Memory Enrichment (`src/intelligence/enrichment.ts`)**:
  - Enriches memory entries with code intelligence evidence (symbol kinds, definition lines, source files) without modifying core content.
- **New MCP Tools for Code Intelligence (`src/mcp.ts`)**:
  - `memory_code_intel_status`: Query active providers and capabilities.
  - `memory_code_intel_symbols`: Resolve symbols across active providers with fallback.
  - `memory_code_intel_blast_radius`: Calculate ripple effects and blast radius for files and symbols.
  - `memory_enrich`: Enrich memories with code intelligence evidence.

## [1.13.0] - 2026-09-03

### Added
- **Ephemeral Observation Tier (`src/learning/observation.ts`)**:
  - Append-only `.memory/observations.jsonl` ledger for raw event streams (tool outputs, test outputs, build failures, code review comments, file edits).
  - Built-in Vibeguard secret defense preventing credential leakage into raw observation streams.
  - State tracking linking observations to extracted candidate memories.
- **First-Class Negative Memories (`src/learning/negative.ts`)**:
  - Dedicated `negative` memory type capturing `DO_NOT_USE`, `FAILED_APPROACH`, and `BUG_PRONE_PATTERN` lessons.
  - Structured fields: `failed_approach`, `failure_reason`, `alternative_recommended`, `reproduction_command`, and `severity`.
  - Enforced `timeless` temporal mode and elevated baseline salience (`0.85`) to safeguard future agent turns against known traps.
- **Autonomous Distillation Pipeline (`src/learning/distill.ts`)**:
  - Distills raw observation streams into structured candidate bug fixes (`fix`), architectural conventions (`architecture`), and anti-patterns (`negative`).
- **Session Outcome Feedback & Reinforcement Loop (`src/learning/feedback.ts`)**:
  - Automatically evaluates test and command exit codes against memories applied during the session.
  - Grants positive reinforcement on success and flags regressions with failure logs on command errors.
- **New MCP Tools for Autonomous Learning (`src/mcp.ts`)**:
  - `memory_observe`: Ingest ephemeral raw observation events.
  - `memory_distill_observations`: Trigger autonomous distillation of raw observations into candidates.
  - `memory_negative_capture`: Explicitly record negative patterns and failed approaches.

## [1.12.0] - 2026-09-03

### Added
- **Memory Quality, Deduplication & Canonical Consolidation (`src/quality/dedup.ts`)**:
  - Deterministic SHA-256 content fingerprinting on normalized markdown text.
  - Word-level Jaccard similarity and exact fingerprint duplicate detection.
  - Canonical memory consolidation: duplicate observations merge into existing canonical memories with supporting evidence arrays and reinforcement bonuses.
  - Temporal mode inference: distinguishes `current` facts, `historical` past architectures/migrations, and `timeless` constraints.
  - Categorical quality model: classifies entries into `LOW`, `MEDIUM`, `HIGH`, `VERIFIED`, `CONFLICTED`, `STALE`.
- **Contradiction Engine & Conflict Resolution (`src/quality/contradiction.ts`)**:
  - Semantic conflict detection flagging opposing polarities, technological clashes, and direct negations without silent overwrites.
  - First-class `conflicted` status with mutual `conflict_ids` linking opposing memories.
  - Deterministic resolution protocols: `supersede`, `historical` (preserves obsolete memory as historical context), `reject`, or `keep_both`.
- **Utility Tracking & Memory ROI Calculator (`src/quality/utility.ts`)**:
  - First-class memory utility tracking: `retrieval_count`, `application_count`, `successful_applications`, `failed_applications`, `regressions`, `reuse_success_rate`.
  - Automated safety threshold: flags memories as `disputed` when 3+ consecutive regressions occur.
  - Full Memory ROI report: overall reuse success rate, high-performing memories, and harmful regressions.
- **New MCP Tools for Quality and Feedback (`src/mcp.ts`)**:
  - `memory_feedback`: Agent outcome feedback loop to report task success, failure, or regression.
  - `memory_resolve_conflict`: Programmatic conflict resolution across competing memories.
  - `memory_roi`: Store-wide utility and return-on-investment telemetry.
- **In-Process L0 Hot Memory Cache & L1 Context Cache (`src/cache.ts`)**:
  - Microsecond-level O(1) in-memory cache for memory entries, filtered queries, and formatted prompt contexts.
  - Bounded LRU eviction, configurable TTL, and store-version generation invalidation on mutations.
  - Dual-persistence synchronization with disk `mtimeMs` verification: guarantees zero YAML parsing for untouched files while immediately detecting external edits or file corruptions.
- **SQLite FTS5 Full-Text Virtual Table & BM25 Search (`src/sqlite.ts`)**:
  - Integrated `memories_fts` virtual table using SQLite FTS5 with Unicode61 tokenizer.
  - Automatic backfill migration for existing databases and automatic synchronization on insert and delete.
  - High-performance `searchMemoriesFts()` API delivering sub-millisecond lexical and prefix search.
  - Performance-tuned PRAGMAs (WAL mode, synchronous=NORMAL, 64MB cache size, 256MB mmap).
- **Comprehensive Benchmarks & Latency Suite (`test/benchmark.test.ts`, `test/cache.test.ts`)**:
  - Hot cache lookup verified under 0.05ms (sub-50 microseconds).
  - Bulk listing with query cache verified under 0.1ms for 100+ entries.
  - FTS5 BM25 search verified under 2ms.

## [1.10.0] - 2026-08-31

### Added
- **Universal Multi-Agent Transcript Harvester & Auto-Learner (`memory learn` / `memory sync-chats`)**:
  - Automatically probes the host machine for active AI agent session transcripts across 80+ platforms (Antigravity, Gemini CLI, Claude Code, OpenCode, Hermes, Goose, Codex, Cursor, etc.).
  - Extracts conversational fixes, architectural decisions, hard constraints, user preferences, and open loops from natural language turns without requiring rigid markdown formatting.
  - Incrementally indexes chats with content-hash ledgers (`.memory/harvested-transcripts.json`) to guarantee zero duplicate re-harvests.
- **Proactive Background Auto-Sync**:
  - `memory ui` automatically synchronizes recent agent transcripts on launch so the visual graph reflects latest conversations immediately.
  - `get_context` in MCP automatically triggers non-blocking incremental transcript harvests on session start.
  - `memory doctor` surfaces real-time unharvested chat counts and diagnostic remediation steps.
- **Enhanced MCP Integration**:
  - `memory_harvest` tool now supports `{ all: true }` and `{ auto: true }` to trigger machine-wide background harvests directly from any connected IDE/CLI agent.

---

## [1.9.0] - 2026-08-31

### Added
- **Autonomous Upgrade & Self-Healing Engine (`memory upgrade` / `memory update`)**:
  - Automatically probes host environment to detect active package managers (`bun`, `npm`, `pnpm`, `yarn`).
  - Fetches the latest published release directly from npm registry and executes seamless global upgrades.
  - Automatically heals corrupted/missing files (`.memory/`, `CURRENT.md`, `USER.md`), auto-wires newly installed agent platforms, and re-indexes AST symbol graphs.
  - Added `--check` flag to inspect upstream updates without applying.
- **Gamified ASCII Level-Up & Onboarding Matrix**:
  - Integrated 5-level animated progress loaders (`[████████████] 100%`) with Level milestones across `memory install`, `memory upgrade`, and `memory uninstall`.
  - TTY-aware with graceful ANSI carriage return animations and clean CI logging fallbacks.
- **Comprehensive Upgrading & Self-Healing Maintenance Guide**: Detailed cross-toolchain upgrade instructions and verification procedures in `README.md`.

---

## [1.8.0] - 2026-08-31

### Added
- **SOW-201: Live Runtime File & Symbol Verification Gate**: Instant sub-millisecond CPU disk check verifying referenced code files in `affected_paths` with `STRONG`, `WEAK`, and `STALE` trust verdicts and scoring adjustments (+0.15 for verified live code, -0.4 for deleted files).
- **SOW-202: Deterministic Relevance Cutoff Gate**: Hard relevance score cutoff ($\text{Score} \ge 0.45$) preventing weakly-related memories from bloating LLM prompt windows and saving 500–2,000 prompt tokens on unrelated queries.
- **SOW-203: Git Code-Drift Scanner (`memory drift` / `memory check` CLI & `memory_drift` MCP tool)**: High-speed Git workspace scanner detecting modified or deleted code files and AST symbols, flagging drifted memories for re-verification or supersession.
- **SOW-204: Gradient-Free Hebbian Co-Activation Plasticity**: Associative synaptic link reinforcement incrementing edge weights (+0.05) when concepts are co-retrieved or confirmed together, enabling natural concept clustering with zero resident daemons.
- **SOW-205: Semantic Memory Prompt Compression (`memory compress` CLI & `memory_compress` MCP tool)**: Lossless prompt compression stripping redundant Markdown whitespace and verbose headers, reducing prompt context token usage by 30–40%.
- **4-Phase Sprint & Roadmap Operating Lifecycle**: Structured sprint pipeline (`Requested` ➔ `Planned` ➔ `In Progress` ➔ `Done`) with top-level Table of Contents and collapsible Roadmap board in `README.md`.

---

## [1.7.1] - 2026-08-30

### Fixed
- **Zero-Friction Global Installation**: Removed obsolete `postinstall` lifecycle hook from `package.json` to prevent package manager untrusted script blocks during `bun add -g musememory` and `npm install -g musememory`.

---

## [1.7.0] - 2026-08-30

### Added
- **Turnkey Agent Memory Skills Suite (`.agents/skills/` & `skills/`)**:
  - **`muse-ground`**: Session start pre-flight grounding injecting `USER.md` persona profile, `CURRENT.md` hard working constraints, and Top-$K$ relevant past decisions/fixes before writing code.
  - **`muse-capture`**: Post-fix and architectural decision distillation with empirical evidence validation, inline Vibeguard secret inspection, and automatic knowledge supersession.
  - **`muse-current`**: Active working constraints and interruption-proof session handoffs directly synchronized to `.memory/CURRENT.md`.
  - **`muse-graph`**: AST CodeGraph & Graphify symbol indexer and code-aware retrieval query optimizer with `+0.2` graph overlap bonus.
  - **`muse-wiki`**: Obsidian-compatible knowledge garden compiler and named entity co-occurrence graph generator.
  - **`muse-brief`**: Proactive daily briefing and knowledge hygiene governor tracking 90/180-day staleness policies and open loops with zero daemons.
- **AST Symbol Graph Integration (SOW-107, Issue #35)**: Pluggable CodeGraph & Graphify symbol provider detection, `memory graph index` symbol map caching under `.memory/graph-symbols.json`, auto-stamping on capture, and `graphSymbolOverlapBonus` (+0.2) in knapsack retrieval.
- **Complete Uninstallation & Removal Workflows**: Added comprehensive clean removal steps with dry-run safety and zero-trace agent unwiring in `README.md`.

---

## [1.6.1] - 2026-08-29

### Security & Hardening
- **Web UI Loopback & CORS CSRF Hardening**: Bound embedded dashboard server strictly to `127.0.0.1` (loopback only) and rejected untrusted third-party `Origin` headers on state-mutating POST endpoints (`HTTP 403 Forbidden`).
- **HTTP Security Headers**: Enforced `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy` across all embedded UI responses.
- **DoS Payload Limiter**: Enforced 1 MB request body streaming limit in `parseJsonBody`, terminating oversized streams to prevent memory exhaustion.
- **Path Traversal Containment**: Enforced strict directory boundary validation in `fileForId` and `slugifyId` to prevent file escape attempts.
- **Vibeguard Secret Scanner Scoping**: Corrected private key block regex precedence to eliminate false positives on technical prose while strictly intercepting actual private key blocks.

### Added & Refined
- **Asynchronous Tree Index Builder (`buildTreeIndexAsync`)**: Added non-blocking microtask-yielding hierarchical tree indexing for large stores.
- **Dynamic Schema Cache Invalidation (`clearSchemaCache`)**: Added exported schema cache reset for dynamic testing and custom schema reloading.
- **Punctuation-Resilient Entity Normalization**: Supported fuzzy entity lookups across punctuation variations (`next.js` $\leftrightarrow$ `nextjs`).
- **Wiki Frontmatter Deserialization**: Implemented robust native array, number, and boolean frontmatter parsing without body duplication.

---

## [1.6.0] - 2026-08-29

### Added
- **MCP Multi-Root Workspace Routing**: Authoritative per-request store routing across multi-root IDE workspaces.
- **CLI Positional Argument Alignment**: Corrected subcommand indexing for `settings` (`get`, `set`, `reset`) and `entities` (`show`, `related`).
- **Stale Command Status Filter**: Added staleness detection for decayed `confirmed` entries past policy lifetimes.
- **AST Symbol Overlap Provider**: Integrated CodeGraph AST symbol co-occurrence provider into the knapsack retrieval scoring engine.

---

## [1.5.0] - 2026-08-29

### Added
- **MemoryStore Shim Removal**: Deleted the deprecated `MemoryStore` class from `src/store.ts`; free functions are now the sole storage surface and `openStore()` returns a plain `Store` object.
- **Scene-Based Hierarchical Consolidation (`memory consolidate`)**: Clusters confirmed memories by (project, type) + weighted token-bag cosine similarity; clusters of ≥3 members become confirmed `Scene:` architecture rollups bidirectionally linked to every member. Idempotent (clusters already covered by a scene are skipped), supports `--project`/`--dry-run`, and is exposed as the `memory_consolidate` MCP tool.
- **Multi-Hop Causality Graph Tracer (`memory trace <id>`)**: Cycle-safe, depth-bounded (default 5) recursive walk of supersedes/superseded_by + related-memory edges, rendered as an indented tree with status/type/age per hop. Pure read path; exposed as the `memory_trace` MCP tool.
- **Ambient Open-Loop Tracker (`memory loops`)**: Read-only prioritized open-loop report grouped by source — workspace git state (uncommitted changes, unmerged local branches; tolerated in non-git dirs), memory-side loops (candidates older than 7 days never confirmed, disputed entries), and active CURRENT.md constraints. Exposed as the `memory_loops` MCP tool.
- **Self-Evolving Skill Distillation (`memory distill`)**: Clusters confirmed fix-type entries by tag overlap + title token similarity; clusters with ≥ `--min-count` (default 3) members become `.agents/skills/<slug>/SKILL.md` folders with frontmatter and deduplicated steps ordered oldest-first. Never overwrites existing skill folders; generated content is Vibeguard secret-scanned; supports `--dry-run`. Exposed as the `memory_distill` MCP tool.
- **Autonomous Verification Oracle (`memory verify <id>`)**: Executes a fix entry's `test_command` (new optional entry field) in the workspace root with a timeout (default 60s). Exit 0 promotes candidates to confirmed and stamps `independently-verified`; non-zero leaves status untouched. Both outcomes audit-logged. Exposed as the `memory_verify` MCP tool.
- **Automated Post-Turn Transcript Harvester Hook**: `memory hook install --git` writes an executable `.git/hooks/pre-commit` invoking `memory harvest-auto` (never clobbers an existing hook; creates nothing else). `memory harvest-auto [--from <glob>]` distills discovered transcripts — explicit glob, else newest `*.jsonl` in the lazily-created `.memory/inbox/` — proposing units strictly as candidates, then archives processed files to `.memory/inbox/processed/` with audit logging.
- **Real-Time Agency Hub (`memory daemon [--port N]`, default 7878)**: Live peer event notifications implemented as Server-Sent Events over plain `node:http` (zero dependencies; same capability as the planned WebSocket hub — SSE chosen because one-way fanout needs no protocol upgrade). `GET /events` streams JSON events; `POST /publish {type,payload}` fans out to all connected peers and echoes `{delivered:N}`; the daemon also fs.watch-debounces `.memory/memories/` and CURRENT.md, broadcasting `memory.changed` / `constraints.changed`.
- **Local Offline Hybrid Vector Engine**: Fully offline hybrid search with zero dependencies — deterministic hashed char-trigram embeddings (256-dim, L2-normalized) fused 0.5/0.5 with BM25 over word tokens. Index persisted at `.memory/index.json` via `memory reindex`; `memory search --hybrid` and the MCP `search` tool's `hybrid` param use it when present, falling back to live scoring (with a reindex hint) otherwise.
- **Knowledge Graph UI v2**: The embedded dashboard's graph is now a 3D force-directed canvas layout (repulsion + springs, perspective projection, drag-to-rotate, wheel-to-zoom) with nodes colored by type and sized by degree, a timeline slider filtering by `updated_at`, cluster filter checkboxes per project/type, and click-to-inspect in the side panel. All existing HTTP endpoints and the data shape stay backward-compatible; empty graphs render a friendly guard message.
- **Bi-Temporal Reinforcement Feedback**: Memory entries gain optional `valid_from`/`valid_to` valid-time stamps and a `reinforcement` counter (+1 on confirm, −1 on stale/reject/supersede). Retrieval decay now uses `valid_from` (event time) when set, and reinforcement adds a bounded ±0.05×min(|n|,5) score adjustment.
- **In-Place Core Memory Partitioning (`memory core`)**: Letta/MemGPT-style permanent operating guidelines in `.memory/CORE.md` across four tiers (`identity`, `directives`, `conventions`, `context`). CLI `memory core <tier> [--set T|--remove|--show]` plus bare listing; new `memory_core` MCP tool; CORE.md content injected into `get_context` between the USER profile and CURRENT constraints sections; Vibeguard secret scan guards writes.
- **Tree-Indexed Retrieval Architecture (`memory search --tree`, `memory_tree_search`)**: Hierarchical partition routing by `(project, type, YYYY-MM)` with automatic depth balancing, progressive disclosure token budgeting (L1/L2/L3), greedy best-first tree traversal, and incremental memory upsert.
- **Markdown Wiki Compilation Engine (`memory wiki [compile|list|show]`, `memory_wiki_*`)**: Compiles confirmed memory clusters into structured, Obsidian-compatible Markdown wiki pages under `.memory/wiki/` (`concepts/`, `entities/`, `index.md`, `log.md`) with bidirectional `[[slug]]` wikilinks and incremental change detection.
- **Named Entity & Concept Extraction (`memory extract-entities`, `memory entities`, `memory_entities_*`)**: Regex-based entity recognition for 5 entity types (`person`, `product`, `organization`, `file`, `concept`), alias normalization, frequency scoring, and co-occurrence relationship building stored in `.memory/entities.json`.
- **PageIndex Native Reasoning Engine (`memory_pageindex_*`)**: Ingests Markdown/text documents (up to 10MB) into hierarchical tree representations with Vibeguard secret inspection, reasoning-based search with explanation trails, and direct memory import conversion.
- **Scaled Graph UI with Barnes-Hut Repulsion & Standalone Export**: 3D force-directed layout upgraded with Barnes-Hut quadtree spatial subdivision for $O(n \log n)$ repulsion scaling on large memory stores ($n > 50$), along with offline standalone HTML export via `exportStandaloneHtml()` and `/api/export-html`.
- **Unified Global & Project Settings Module (`memory settings`, `memory_settings_*`)**: Centralized type-safe settings schema with Zod/AJV validation, directory traversal security guards (`validateSafePath`), file watcher hot-reload, version migrations, and project override scoping.
- **3-Layer Progressive Disclosure**: `get_context` gains a `depth` tier (default L2). L1 = one line per memory (id + title), L2 = current behavior (title + content + tags), L3 = full raw entry with complete metadata block. Exposed via MCP `depth` param and CLI `memory context --depth L1|L2|L3`.

### Changed
- **Shared Command Core (`src/commands/`)**: CLI and MCP now route lifecycle mutations (propose, supersede, confirm, link, mark-stale, reject, delete) and the harvest distillation loop through a single command core with structured results; adapters only parse args and format output. Duplicate MCP handler logic, double secret-scanning, and divergent error strings eliminated.
- **Single Storage Interface**: Free functions in `src/store.ts` are now the sole production surface.
- **Migrator Respects Lifecycle State Machine**: Migration writes now flow through audited store transitions (`markSuperseded`, `markStale`, `addConstraint`) instead of raw status assignment — every migrated entry lands in `audit.jsonl`.
- **Registry-Driven Connectors**: 19 near-identical `connectX()` wrappers collapsed into a factory over the agent registry metadata (468 → 439 LOC, zero behavior change).
- **Deduplicated Root Detection**: Memory-dir suffix detection unified into one shared helper (`src/root.ts`) used by store, migrator, and root bootstrap.
- **Harvest/Snapshot Separation**: Portable JSON snapshot export/import moved to `src/snapshot.ts`; `harvest.ts` keeps transcript distillation.

### Planned (Phase 3 & Beyond)
- **Knowledge Graph UI v2**: 3D force-directed WebGL graph with timeline scrubbing and cluster filtering.

---

## [1.2.0] - 2026-08-22

### Added
- **Zero-Install NPX & BunX Distribution (`npx musememory <cmd>`)**:
  - Single-file standalone Node.js production bundle (`dist/index.js`) supporting instant zero-install execution via `npx` or `bunx` with no global `npm i -g` required.
- **One-Line System Installer & Diagnostic Doctor (`memory install` / `memory doctor`)**:
  - `memory install`: One-line initialization, auto-connecting all detected coding agents and checking legacy memory stores.
  - `memory doctor`: In-depth health check across storage paths, YAML schema validity, credential leaks, MCP auto-approvals, and operational audit trail.
- **Clean Agent Uninstaller (`memory uninstall`)**:
  - Safely unwires memory MCP server from all configured coding agent configs without leaving orphaned configuration entries or damaging user settings.
- **80+ Coding Agent Baseline & Smart Auto-Connect (`memory agents` / `memory connect --all`)**:
  - Comprehensive registry and detector for 80+ terminal coding agents, OpenClaw ecosystems, and major AI IDEs (Claude Code, Cursor, Hermes Agent, OpenCode, OpenClaw, Codex CLI, Gemini CLI, Goose, Continue, Cline, Roo Code, Pi, Crush, Warp, GitHub Copilot, etc.).
  - **Clean Workspace Guarantee**: `memory connect --all` auto-detects installed coding agents and wires MCP **only into installed agents**, leaving out uninstalled systems to prevent generating unwanted files/folders.
  - Dedicated CLI command `memory agents` (alias: `memory detect-agents`) displaying installed, connected, binary, and config paths across all supported agents.
- **Universal Multi-Provider Auto-Detection & Migrator (`memory detect` / `memory migrate`)**:
  - Probes local workspace and machine directories for 24+ external memory formats (AgentMemory, Beads, Mem0, Letta/MemGPT, EverOS, ByteRover, Supermemory, and generic markdown/JSON formats).
  - Deterministic state preservation mapping: `active`/`open` ➔ `confirmed`, `archived`/`closed` ➔ `superseded`, and core constraints/personas ➔ `.memory/CURRENT.md`.
  - Non-destructive `--dry-run`, `--overwrite`, and `--from <provider>` filtering controls.
- **Vibeguard Ingestion Defense**: Real-time secret scanning on all imported memories, masking sensitive credentials as `[REDACTED_SECRET]` during migration.
- **Multi-Runtime Resilient Installer (`scripts/install.sh`)**:
  - Auto-configures Bun, Node.js/NPM (bypassing `EALLOWGIT`), local repository linking, and `$PATH` verification.
- **MCP Agent Tools**: Registered `memory_detect_agents`, `memory_connect`, `memory_detect_providers`, and `memory_migrate` with zero-permission auto-approval across all supported agent platforms.
- **Interactive 24-Provider Comparison Dashboard (`musememory-comparison.html`)**:
  - Standalone dark-mode responsive comparison dashboard with live search, category filter chips, and provider deep-dives.
- **Extended Test Suite**: 107 automated tests passing across 19 test suites with 0 TypeScript static type errors.

---

## [1.1.0] - 2026-08-21

### Added
- **Dynamic Prompt Token Budgeter**: Exact token packing (`--token-budget <N>` / `token_budget` in MCP) using greedy knapsack packing with character heuristics to eliminate prompt bloat.
- **Universal JSONL Transcript Ingestion**: Ingest raw `.jsonl` session transcripts from Claude Code, Antigravity, Cursor, and Codex into structured outcome, decision, and fix units (`memory import-transcript`).
- **Operational Compliance Audit Ledger**: Append-only log (`.memory/audit.jsonl` / `memory audit`) capturing actor, operation, timestamp, and details with `memory delete` tombstone auditing.
- **Zero-Permission Multi-Agent Connect (`memory connect <agent>`)**: Automatically configures MCP settings and pre-approves tools without permission dialogs across Claude Code, Cursor, Antigravity, Windsurf, Codex, and Gemini CLI.
- **Default `.memory/` Storage Path**: Switched default workspace storage to `.memory/` and global storage to `~/.memory/` while preserving backward compatibility with `.musememory/`.
- **Automatic `CURRENT.md` Bootstrapping**: Automatically generates and syncs `.memory/CURRENT.md` hard constraints file upon agent and project initialization.

---

## [1.0.0] - 2026-08-21

### Added
- **Core Storage Engine**: Atomic file write mechanism (`.tmp` + atomic rename) with zero external database dependencies or locks, storing human-readable YAML documents in `.memory/memories/`.
- **Lifecycle State Machine**: Strict lifecycle state transitions (`candidate` ➔ `confirmed` ➔ `superseded` / `stale` / `disputed` / `rejected`) preventing knowledge rot and hallucinations.
- **Outcome & Fix Harvester**: Automated distillation engine (`memory harvest`) extracting root causes, fixes, decisions, constraints, and failures from raw chat logs and transcripts.
- **Mathematical Salience & Relevance Ranker**: Calibrated scoring function combining query applicability, verification level, graph symbols, salience weighting, and exponential temporal decay.
- **Vibeguard Zero-Leakage Secret Defense**: Built-in, pure TypeScript secret scanner intercepting 8 credential classes (API keys, GitHub tokens, NPM tokens, AWS keys, private keys, database connection strings, passwords) before disk write.
- **Deep Store Referential Validator**: Schema and link auditor (`memory validate`) detecting schema violations, broken relation links, missing supersession pointers, and stored credentials.
- **Provider-Neutral Graph AST Integration**: Automatic detection of CodeGraph indices awarding bounded relevance bonuses for matching AST symbols.
- **Embedded Web Dashboard (`memory ui`)**: Self-contained, zero-dependency HTML5 Canvas 2D interactive force-directed knowledge graph and live search inspector running on a native HTTP server.
- **Agency Network Snapshot Sync**: Portable JSON snapshot `export` and `import` for team-wide cross-machine memory synchronization.
- **Dual Tool Surface**: 19 CLI commands with concise `memory` command and conflict-safe `musememory` alias, plus 13 Model Context Protocol (MCP 2024-11-05 stdio) tools for AI agents.
