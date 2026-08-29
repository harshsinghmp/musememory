# 📜 Changelog

All notable changes to the **Muse Memory** (`musememory`) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.4.0] - 2026-08-29

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
