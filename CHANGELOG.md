# 📜 Changelog

All notable changes to the **Muse Memory** (`musememory`) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- Scene-based hierarchical consolidation engine (`mem_scenes` / `memory consolidate`).
- Autonomous verification test oracle (`memory verify <id>`).
- Dynamic prompt token budgeter for 95% token savings (`--token-budget <N>`).
- Multi-hop causality graph path tracer (`memory trace <id>`).
- In-place Core Memory runtime partitioning (`memory core`).
- Automated post-turn transcript harvester hook.
- Real-time multi-agent WebSocket synchronization daemon (`memory daemon`).
- Local offline hybrid vector embedding engine (ONNX/WASM).

---

## [1.0.0] - 2026-08-21

### Added
- **Core Storage Engine**: Atomic file write mechanism (`.tmp` + atomic rename) with zero external database dependencies or locks, storing human-readable YAML documents in `.musememory/memories/`.
- **Lifecycle State Machine**: Strict lifecycle state transitions (`candidate` ➔ `confirmed` ➔ `superseded` / `stale` / `disputed` / `rejected`) preventing knowledge rot and hallucinations.
- **Outcome & Fix Harvester**: Automated distillation engine (`memory harvest`) extracting root causes, fixes, decisions, constraints, and failures from raw chat logs and transcripts.
- **Mathematical Salience & Relevance Ranker**: Calibrated scoring function combining query applicability, verification level, graph symbols, salience weighting, and exponential temporal decay.
- **Vibeguard Zero-Leakage Secret Defense**: Built-in, pure TypeScript secret scanner intercepting 8 credential classes (API keys, GitHub tokens, NPM tokens, AWS keys, private keys, database connection strings, passwords) before disk write.
- **Deep Store Referential Validator**: Schema and link auditor (`memory validate`) detecting schema violations, broken relation links, missing supersession pointers, and stored credentials.
- **Provider-Neutral Graph AST Integration**: Automatic detection of CodeGraph indices awarding bounded relevance bonuses for matching AST symbols.
- **Embedded Web Dashboard (`memory ui`)**: Self-contained, zero-dependency HTML5 Canvas 2D interactive force-directed knowledge graph and live search inspector running on a native HTTP server.
- **Agency Network Snapshot Sync**: Portable JSON snapshot `export` and `import` for team-wide cross-machine memory synchronization.
- **Universal Project Discovery & Auto-Init**: Dynamic upward directory scanning with automatic `.musememory/` workspace bootstrapping.
- **Dual Tool Surface**: 19 CLI commands with concise `memory` command and conflict-safe `musememory` alias, plus 13 Model Context Protocol (MCP 2024-11-05 stdio) tools for AI agents.
- **Multi-Platform Distribution**: Packaging support for one-line curl installer (`install.sh`), npm global binary, Bun native runtime, and multi-stage Docker container.
- **Test Suite**: 70 automated tests passing across 11 test suites with 0 TypeScript static type errors.
