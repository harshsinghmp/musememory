# 🧠 Muse Memory (`musememory`) — System Architecture & Agent Guidelines

> **Project**: Muse Memory (Autonomous Persistent Cognitive Memory System for AI Agents & Agency Networks)
> **Binary Names**: `memory` (primary), `musememory` (alias)
> **Storage Locations**: Local `.memory/` (per project) and Global `~/.memory/` (user-wide)
> **MCP Protocol**: MCP 2024-11-05 (stdio transport)

---

## 🏛️ System Architecture Snapshot

Muse Memory is a zero-daemon, file-backed cognitive memory engine designed to give AI agents (Claude Code, Cursor, Antigravity, Windsurf, Codex, Gemini CLI) persistent, self-organizing memory across sessions without external database daemons or cloud servers.

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Agents & IDE Platforms                │
│  (Claude Code, Cursor, Antigravity, Windsurf, Codex, CLI)   │
└──────────────────────────────┬──────────────────────────────┘
                               │ MCP stdio / Terminal CLI
┌──────────────────────────────▼──────────────────────────────┐
│                    Muse Memory Core Engine                  │
│                                                             │
│ ┌───────────────────┐ ┌──────────────────┐ ┌──────────────┐ │
│ │  Ranker & Budget  │ │ Vibeguard Secret │ │ Auto-Migrate │ │
│ │ (Token Knapsack)  │ │ Defense Scanner  │ │  (24+ Formats)│ │
│ └───────────────────┘ └──────────────────┘ └──────────────┘ │
│ ┌───────────────────┐ ┌──────────────────┐ ┌──────────────┐ │
│ │ LifeCycle Machine │ │ JSONL Harvester  │ │ Audit Ledger │ │
│ │(State Transitions)│ │(Transcript Parser│ │(audit.jsonl) │ │
│ └───────────────────┘ └──────────────────┘ └──────────────┘ │
└──────────────────────────────┬──────────────────────────────┘
                               │ Atomic File I/O
┌──────────────────────────────▼──────────────────────────────┐
│              Dual-Scope File Storage (.memory/)             │
│                                                             │
│  .memory/                                                   │
│  ├── CURRENT.md         # Active hard constraints & open loops│
│  ├── audit.jsonl        # Append-only operational audit trail│
│  └── memories/                                              │
│      ├── m_1700000001000_auth.yaml                          │
│      └── m_1700000002000_arch.yaml                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Repository Layout

```
musememory/
├── bin/                    # Command-line entry points (memory.ts, musememory.ts)
├── src/                    # Core TypeScript source code
│   ├── audit.ts            # Append-only compliance audit ledger
│   ├── cli.ts              # Command dispatcher & formatting
│   ├── connect.ts          # Zero-permission auto-wiring across 6 agent platforms
│   ├── current.ts          # CURRENT.md read/append constraints engine
│   ├── graph.ts            # CodeGraph AST integration adapter
│   ├── harvest.ts          # Chat/transcript distillation & JSON snapshot sync
│   ├── mcp.ts              # Model Context Protocol stdio server
│   ├── rank.ts             # Calibrated scoring, decay & token budget estimator
│   ├── root.ts             # Hierarchical root detection & auto-bootstrap
│   ├── schema.ts           # JSON Schema & store referential validator
│   ├── search.ts           # Token search & greedy budget packing
│   ├── secrets.ts          # Vibeguard zero-leakage secret scanner & redactor
│   ├── sessions.ts         # Session timeline nodes
│   ├── store.ts            # Atomic file storage & state transitions
│   ├── types.ts            # Core TypeScript interfaces & enums
│   ├── ui.ts               # Embedded zero-dependency visual graph server
│   └── migrator/           # Multi-provider auto-detection & migration engine
│       ├── detect.ts       # Prober for 24+ external memory formats
│       ├── engine.ts       # Orchestrator & state preservation mapper
│       ├── types.ts        # Migrator interfaces & normalizers
│       └── adapters/       # Specialized parsers (AgentMemory, Beads, Mem0, Letta, EverOS, etc.)
├── test/                   # Comprehensive automated test suites (92 tests)
├── scripts/                # Distribution & installation scripts (install.sh)
├── package.json            # Package metadata, dependencies, and bin declarations
└── README.md               # User documentation & quick start guide
```

---

## ⚡ Core Operational Directives for AI Agents

1. **At Session Start**:
   - Call `get_context` (or `memory context --token-budget <N>`) with the current task prompt to load active constraints, decisions, and past bug fixes before beginning work.
   - Read `.memory/CURRENT.md` to adhere to immediate project constraints.
2. **During Bug Fixes / Architectural Decisions**:
   - Propose candidate or confirmed memories using `memory_capture` (or `memory capture "<text>" --project P --confirmed`).
   - The built-in Vibeguard scanner automatically checks for secrets before any memory is written.
3. **When Replacing Outdated Knowledge**:
   - Use `memory_supersede` (`memory supersede <old_id> --with <new_id>`) to retire stale entries while maintaining backward causal links.
4. **On First Workspace Setup**:
   - Run `memory detect` and `memory migrate` to automatically ingest any pre-existing legacy memories into the standardized `.memory/` store.

---

## 🧪 Testing & Validation Standards

All pull requests and code modifications must pass the full test suite and TypeScript validation before committing:

```bash
bun test          # 92 passing tests across 16 test suites
bunx tsc --noEmit # 0 static type errors
```
