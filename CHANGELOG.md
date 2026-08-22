# 📜 Changelog

All notable changes to the **Muse Memory** (`musememory`) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned (Phase 3 & Beyond)
- **Self-Evolving Skill Distillation**: Autonomous extraction of recurring multi-turn fix patterns into modular agent skill folders (`.agents/skills/`).
- **3-Layer Progressive Disclosure**: Tiered context injection (`L1: Summary` ➔ `L2: Core Anchors` ➔ `L3: Full Raw State`).
- **Bi-Temporal Reinforcement Feedback**: Recording valid/event time alongside system time with implicit +1/-1 reinforcement scores.
- **Ambient Open-Loop Tracker**: Proactive tracking of uncommitted branches, pending migrations, and unresolved debugging sessions.
- **Knowledge Graph UI v2**: 3D force-directed WebGL graph with timeline scrubbing and cluster filtering.

---

## [1.2.0] - 2026-08-22

### Added
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
- **Extended Test Suite**: 105 automated tests passing across 18 test suites with 0 TypeScript static type errors.

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
