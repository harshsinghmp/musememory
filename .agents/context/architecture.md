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
│   ├── audit.ts            # Append-only compliance audit ledger
│   ├── claims.ts           # Evidence-backed claim ledger & confidence tags
│   ├── cli.ts              # Command router & dispatcher
│   ├── cli/                # Modular domain command handlers
│   ├── compounding/        # Unified knowledge compounding (temporal & clustering)
│   ├── connect.ts          # Declarative zero-permission auto-wiring across 80+ agent platforms
│   ├── current.ts          # CURRENT.md read/append constraints engine
│   ├── doctor.ts           # Ecosystem diagnostic & health check engine
│   ├── graph.ts            # CodeGraph AST integration adapter
│   ├── harvester.ts        # Universal agent transcript discovery and auto-learner engine
│   ├── mcp.ts              # Model Context Protocol stdio server
│   ├── retrieval.ts        # Unified Retrieval Engine with knapsack token budgeting
│   ├── root.ts             # Hierarchical root detection & auto-bootstrap
│   ├── schema.ts           # JSON Schema & store referential validator
│   ├── secrets.ts          # Vibeguard zero-leakage secret scanner & redactor
│   ├── store.ts            # Dual-scope storage layout & lifecycle state machine
│   ├── transcript.ts       # Universal JSONL parser, dialogue windowing & search
│   ├── types.ts            # Core TypeScript interfaces & enums
│   ├── user.ts             # Persona & working preference engine
│   ├── agents/             # Workstation coding agents detection & registry (80+ platforms)
│   └── migrator/           # Multi-provider auto-detection & migration engine (24+ formats)
├── test/                   # Automated Vitest/Bun test suites
├── package.json            # Package metadata & dependencies
└── dist/                   # Compiled Node/Bun bundle
```

---

## 🔄 Memory LifeCycle State Machine

```
  [propose] ──► candidate ──► confirm() ──► confirmed ──► supersede() ──► superseded
                    │                           │
                    ├──► markStale() ───────────┤
                    │         │                 │
                    │         ▼                 ▼
                    └──►    stale            rejected
                              │
                              └──► delete() ──► [Purged from Disk + audit.jsonl logged]
```

### Invariant Rules:
1. **Confirmation Gate**: Only `candidate`, `disputed`, or `stale` entries can be promoted to `confirmed`.
2. **Supersession Requirement**: When calling `supersede(old_id, new_id)`, the `new_id` entry must already exist and have `confirmed` status. Self-supersession (`old_id === new_id`) is strictly prohibited.
3. **Audit Ledger Logging**: Every mutation automatically writes an immutable log record to `.memory/audit.jsonl`.

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
