# 🏗️ Muse Memory Architecture & System Design

---

## 🏛️ System Architecture Snapshot

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
│ │  Retrieval Engine │ │ Vibeguard Secret │ │ Auto-Migrate │ │
│ │ (Token Knapsack)  │ │ Defense Scanner  │ │  (24+ Formats)│ │
│ └───────────────────┘ └──────────────────┘ └──────────────┘ │
│ ┌───────────────────┐ ┌──────────────────┐ ┌──────────────┐ │
│ │ LifeCycle Machine │ │ JSONL Harvester  │ │ Audit Ledger │ │
│ │(State Transitions)│ │(Transcript Parser│ │(audit.jsonl) │ │
│ └───────────────────┘ └──────────────────┘ └──────────────┘ │
└──────────────────────────────┬──────────────────────────────┘
                               │ Atomic File I/O
┌──────────────────────────────▼──────────────────────────────┐
│              Dual-Scope Storage Engine (.memory/)           │
│                                                             │
│  .memory/                                                   │
│  ├── memory.db          # Primary SQLite cognitive database │
│  ├── CURRENT.md         # Active hard constraints & handoff │
│  ├── USER.md            # Persona & developer preferences   │
│  ├── HOT.md             # Working memory cache (rollups)    │
│  ├── sources.json       # Provenance Source Ledger          │
│  ├── claims.json        # Evidence-grounded Claim Ledger    │
│  ├── audit.jsonl        # Append-only operational audit trail│
│  └── memories/          # Dual-persisted YAML export mirror │
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
│   ├── adrs/               # Living Architecture Decision Records & Drift Engine
│   ├── anchors/            # Native structural code anchors & live drift verification
│   ├── audit.ts            # Append-only compliance audit ledger
│   ├── cache.ts            # L0 hot cache, query cache, & SQLite WAL tuning
│   ├── claims.ts           # Evidence-backed claim ledger & confidence tags
│   ├── cli.ts              # Command router & dispatcher
│   ├── cli/                # Modular domain command handlers (health, wiki, etc.)
│   ├── cognition/          # Autonomous "Why" reasoner, bug clustering, tech debt
│   ├── compaction/         # 70% context compaction engine & session handoffs
│   ├── compounding/        # Unified knowledge compounding (temporal & clustering)
│   ├── connect.ts          # Declarative zero-permission auto-wiring across 80+ agent platforms
│   ├── current.ts          # CURRENT.md read/append constraints engine
│   ├── doctor.ts           # Ecosystem diagnostic & health check engine
│   ├── health/             # Unified 5-Pillar Project Health Gate engine
│   ├── harvester.ts        # Universal agent transcript discovery and auto-learner engine
│   ├── intelligence/       # Pluggable code intelligence providers (CodeGraph, Graphify, LSP, AST)
│   ├── learning/           # Observation, candidate distillation, negative anti-patterns
│   ├── mcp.ts              # Model Context Protocol stdio server (69 tools with profiles)
│   ├── mesh/               # Multi-repo & monorepo workspace discovery, query resolver, contracts
│   ├── orchestrator/       # Flagship muse_context fusion, bidirectional lookups, MCP profiles
│   ├── promotion/          # 3-tier promotion ladder, 5x success rule, archival lifecycle
│   ├── quality/            # Deduplication, semantic contradiction engine, utility & ROI
│   ├── retrieval/          # 11-dimension multi-factor scoring & token knapsack packing
│   ├── root.ts             # Hierarchical root detection & auto-bootstrap
│   ├── schema.ts           # JSON Schema & store referential validator
│   ├── secrets.ts          # Vibeguard zero-leakage secret scanner & redactor
│   ├── store.ts            # Dual-scope storage layout & lifecycle state machine
│   ├── sync/               # Cross-agent knowledge sync, P2P gossip protocol, shared pool
│   ├── transcript.ts       # Universal JSONL parser, dialogue windowing & search
│   ├── types.ts            # Core TypeScript interfaces & enums
│   ├── ui.ts               # Full Web Observability Studio & 3D knowledge graph
│   ├── user.ts             # Persona & working preference engine
│   ├── agents/             # Workstation coding agents detection & registry (80+ platforms)
│   └── migrator/           # Multi-provider auto-detection & migration engine (24+ formats)
├── test/                   # Automated Bun test suites (498 tests across 81 suites)
├── package.json            # Package metadata & dependencies (v2.0.0)
└── dist/                   # Compiled Node/Bun bundle
```

---

## 🔄 Memory LifeCycle State Machine

```
  [propose] ──► candidate ──► confirm() ──► active / confirmed ──► supersede() ──► superseded
                    │                             │                      │
                    ├──► markStale() ─────────────┤                      ├──► cold ──► dormant ──► archived
                    │         │                   │                      │                           │
                    │         ▼                   ▼                      └────────◄── rehydrate() ───┘
                    └──►    stale             conflicted
                              │                   │
                              └──► delete() ◄─────┘
                                      │
                                      ▼
                           [Purged from SQLite/YAML + audit.jsonl logged]
```

### Invariant Rules:
1. **Confirmation Gate**: Only `candidate`, `disputed`, or `stale` entries can be promoted to `confirmed`.
2. **Supersession Requirement**: When calling `supersede(old_id, new_id)`, the `new_id` entry must already exist and have `confirmed` status. Self-supersession (`old_id === new_id`) is strictly prohibited.
3. **Contradiction Management**: Contradictory evidence creates explicit `conflicted` status with mutual `conflict_ids` instead of silently clobbering truth.
4. **Scoped Promotion Ladder**: Promotions move `local` $\rightarrow$ `project` $\rightarrow$ `global` following the 5× repeated success policy and universal generalization (stripping local paths and project-specific artifacts).
5. **Archival Rehydration**: Cold and archived memories dynamically rehydrate to `active` upon high-relevance queries.
6. **Audit Ledger Logging**: Every mutation automatically writes an immutable log record to `.memory/audit.jsonl`.

---

## ⏳ Per-Type Staleness Policy

| Memory Type | Policy Lifetime | Description & Agent Guidance |
| :--- | :--- | :--- |
| `fix` | **90 days** | Bug workarounds, dependency patches, edge-case fixes. |
| `operation` | **180 days** | Build scripts, deployment instructions, local dev commands. |
| `architecture` | **365 days** | System architecture, database schemas, core abstractions. |
| `discovery` | **30 days** | Ephemeral research notes, transient experiments. |
| `preference` | **Permanent (`null`)** | User coding preferences, tone/style rules, agency stances. |
| `constraint` | **Active** | Immediate hard constraints synced directly to `CURRENT.md`. |
| `session` | **Permanent (`null`)** | Session start/end timeline nodes in the cognition graph. |

---

## 🛡️ Built-in Vibeguard Secret Defense (`src/secrets.ts`)

Every write transaction (`store.propose`, `store.save`, `setUserProfile`, `importSnapshot`, and `importTranscript`) automatically scans content and rejects writes if any of the following are detected:
- OpenAI / Anthropic / AI API keys (`sk-...`)
- GitHub Personal Access Tokens (`ghp_...`, `github_pat_...`)
- NPM tokens (`npm_...`)
- AWS Access Key IDs (`AKIA...`, `ASIA...`)
- Private Key blocks (`-----BEGIN ... PRIVATE KEY-----`)
- Database connection strings with embedded credentials (`postgres://...`)
