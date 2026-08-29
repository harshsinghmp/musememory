# 🧠 Muse Memory (`musememory`) — System Architecture & Agent Guidelines

> **Project**: Muse Memory (Autonomous Persistent Cognitive Memory System for AI Agents & Agency Networks)  
> **Binary Names**: `memory` (primary), `musememory` (alias), `npx musememory` (zero-install)  
> **Storage Locations**: Local `.memory/` (per project) and Global `~/.memory/` (user-wide)  
> **MCP Protocol**: MCP 2024-11-05 (stdio transport)  
> **Test Suite**: `bun test` (count grows per PR — run it, don't quote it)  

---

## 🏛️ System Architecture Snapshot

Muse Memory is a zero-daemon, file-backed cognitive memory engine designed to give AI agents (Claude Code, Cursor, Antigravity, Windsurf, Codex, Gemini CLI, Hermes, OpenCode, OpenClaw, etc.) persistent, self-organizing memory across sessions without external database daemons or cloud servers.

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
│              Dual-Scope File Storage (.memory/)             │
│                                                             │
│  .memory/                                                   │
│  ├── CURRENT.md         # Active hard constraints & open loops│
│  ├── USER.md            # Persona & developer preferences     │
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
│   ├── cli.ts              # Command router & dispatcher
│   ├── cli/                # Modular domain command handlers
│   │   ├── ecosystem.ts    # Install, doctor, uninstall, init, connect, agents, migrate, ui
│   │   ├── lifecycle.ts    # Propose, capture, confirm, supersede, stale, reject, delete, list, stats
│   │   ├── persona.ts      # USER.md persona profile and CURRENT.md working constraints
│   │   ├── retrieval.ts    # Context, search, recall, search-transcript, harvest, import-transcript
│   │   └── shared.ts       # Flag parsing, root detection, and entry printing
│   ├── commands/            # Shared command core (single seam for CLI + MCP)
│   │   ├── lifecycle.ts     # Propose, supersede, confirm, link, stale, reject, delete ops
│   │   └── retrieval.ts     # Harvest distillation loop
│   ├── connect.ts           # Declarative zero-permission auto-wiring across 80+ agent platforms
│   ├── current.ts          # CURRENT.md read/append constraints engine
│   ├── doctor.ts           # Ecosystem diagnostic & health check engine
│   ├── graph.ts            # CodeGraph AST integration adapter
│   ├── harvest.ts          # Chat/transcript distillation (re-exports snapshot fns)
│   ├── mcp.ts              # Model Context Protocol stdio server
│   ├── prompt.ts           # Interactive terminal select prompts & wizard
│   ├── retrieval.ts        # Unified Context & Retrieval Engine with knapsack token budgeting
│   ├── root.ts             # Hierarchical root detection & auto-bootstrap (shared memory-dir path helpers)
│   ├── schema.ts           # JSON Schema & store referential validator
│   ├── secrets.ts          # Vibeguard zero-leakage secret scanner & redactor
│   ├── sessions.ts         # Session timeline nodes & cognition graph
│   ├── snapshot.ts         # Portable JSON memory snapshot export/import
│   ├── store.ts            # Dual-scope storage layout, lifecycle state machine & free-fn ops
│   ├── transcript.ts       # Universal JSONL parser, dialogue windowing & bookend search
│   ├── types.ts            # Core TypeScript interfaces & enums
│   ├── ui.ts               # Embedded zero-dependency visual graph server
│   ├── user.ts             # Persona & working preference engine with 5 role archetypes
│   ├── agents/             # Workstation coding agents detection & registry (80+ platforms)
│   │   ├── detect.ts       # Pure TypeScript binary & config scanner
│   │   ├── registry.ts     # Declarative metadata registry of 80+ agents
│   │   └── types.ts        # Agent interfaces & categories
│   └── migrator/           # Multi-provider auto-detection & migration engine
│       ├── detect.ts       # Prober for 24+ external memory formats
│       ├── engine.ts       # Orchestrator & state preservation mapper
│       ├── types.ts        # Migrator interfaces & normalizers
│       └── adapters/       # Specialized parsers (AgentMemory, Beads, Mem0, Letta, EverOS, etc.)
├── test/                   # Comprehensive automated test suites (run `bun test` for current count)
├── scripts/                # Distribution & installation scripts (install.sh)
├── package.json            # Package metadata, dependencies, and bin declarations
└── README.md               # User documentation & quick start guide
```

---

## 🔄 Memory LifeCycle State Machine & Transition Invariants

All memory entries transition through a deterministic lifecycle state machine guarded by `src/store.ts`:

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

### Invariant Rules for Agents:
1. **Confirmation Gate**: Only `candidate`, `disputed`, or `stale` entries can be promoted to `confirmed`.
2. **Supersession Requirement**: When calling `supersede(old_id, new_id)`, the `new_id` entry **must already exist and have `confirmed` status**. Self-supersession (`old_id === new_id`) is strictly prohibited.
3. **Bidirectional Graph Links**: Supersession automatically updates `superseded_by` on the old entry and `supersedes` on the replacement entry.
4. **Audit Ledger Logging**: Every mutation (`propose`, `confirm`, `supersede`, `mark_stale`, `reject`, `delete`, `link`) automatically writes an immutable log record to `.memory/audit.jsonl`.

---

## ⏳ Per-Type Staleness Policy Reference

Knowledge decays naturally based on its semantic domain:

| Memory Type | Policy Lifetime | Description & Agent Guidance |
|---|---|---|
| `fix` | **90 days** | Bug workarounds, dependency patches, edge-case fixes. |
| `operation` | **180 days** | Build scripts, deployment instructions, local dev commands. |
| `architecture` | **365 days** | System architecture, database schemas, core abstractions. |
| `discovery` | **30 days** | Ephemeral research notes, transient experiments. |
| `preference` | **Permanent (`null`)** | User coding preferences, tone/style rules, agency stances. |
| `constraint` | **Active** | Immediate hard constraints synced directly to `CURRENT.md`. |
| `session` | **Permanent (`null`)** | Session start/end timeline nodes in the cognition graph. |

---

## ⚖️ Multi-Factor Scoring & Knapsack Retrieval Mechanics

The unified retrieval engine ([`src/retrieval.ts`](src/retrieval.ts)) scores memory entries using a calibrated multi-factor formula:

$$\text{Score} = 1.0 \times \text{Applicability} + \text{StatusPenalty} + \text{VerificationBonus} + \text{GraphBonus} + \text{SalienceBonus} + 0.3 \times e^{-\frac{\Delta t}{90\text{ days}}}$$

### Scoring Breakdown:
- **Applicability ($0.0 \to 1.0$)**: Token overlap ratio across title, content, tags, project, and CodeGraph symbols.
- **Status Penalties / Bonuses**:
  - `confirmed`: **+0.4**
  - `active`: **0.0**
  - `stale`: **-0.3**
  - `disputed`: **-0.5**
  - `candidate`: **-0.6**
  - `superseded` / `rejected`: **-1.0**
- **Verification Trust Bonus**:
  - `independently-verified`: **+0.3**
  - `user-confirmed`: **+0.2**
  - `unverified`: **0.0**
- **CodeGraph AST Bonus**: **Up to +0.2** for matching active AST symbol names in the codebase.
- **Salience Bonus**: **Up to +0.1** ($0.1 \times \text{salience}$).
- **Exponential Time Decay**: $0.3 \times e^{-\Delta t / 90\text{d}}$ ensures recently updated insights rank above older ones without discarding permanent architectural knowledge.
- **Knapsack Token Budgeting**: Packed greedily up to the requested `tokenBudget` to fit within LLM prompt limits.

---

## 🌐 Dual-Scope Routing Guidelines (Local vs Global)

Agents must choose the correct storage scope based on knowledge generality:

| Storage Scope | Filesystem Location | When AI Agents Must Use It |
|---|---|---|
| **Local Workspace** *(Default)* | `<project_root>/.memory/` | Repository-specific architectural decisions, bug fixes, schema rules, local `CURRENT.md` constraints, and session timeline nodes. |
| **Global System** | `~/.memory/` (via `--global` / `-g`) | User-wide preferences, principal directives, universal prompt patterns, cross-repo coding conventions, and global tool settings. |

---

## 👤 Persona & Working Preference Engine (`USER.md`)

Muse Memory maintains a persistent user profile (`~/.memory/USER.md` globally, or `.memory/USER.md` locally) to ground AI agents in the user's role, communication style, and toolchain rules.

### 5 Clean Archetypes:
1. **`developer`**: Code-first, direct, concise, runnable diffs, strict types, fail-fast mechanics.
2. **`designer`**: Visual hierarchy, CSS/Tailwind systems, GSAP animations, WCAG accessibility, Figma/tokens design tokens.
3. **`marketer`**: Conversion-rate optimization (CRO), punchy copy, SEO clustering, audience hooks.
4. **`casual`**: Plain English, jargon-free explanations, step-by-step guidance.
5. **`custom`**: Clean blank template for custom instructions.

### 🧠 Prompt Injection Hierarchy & Proactive Self-Nudge
When `get_context` or `formatPromptContext()` builds the context for the agent, it orders information deterministically:
1. `### User Profile & Preferences (USER.md)`
2. `### Active Working Constraints (CURRENT.md)`
3. `### Relevant Memories & Learned Patterns` (Top-$K$ ranked memories)
4. `*Memory Directive: When learning durable facts, bug resolutions, or user preferences, call memory_capture immediately.*`

---

## 📜 Full-Text Transcript Search with Conversation Bookends

In addition to knowledge distillation, agents can perform full-text searches over raw `.jsonl` conversation transcripts using `memory_search_transcripts` or `memory search-transcript <query> [file.jsonl]`. Results include:
- **Conversation Bookends**: The initial user prompt + concluding turn.
- **Context Window**: $N$ dialogue turns immediately preceding and following every matched turn.

---

## 🛡️ Vibeguard Zero-Leakage Policy for Agents

Muse Memory includes a built-in, zero-dependency secret scanner ([`src/secrets.ts`](src/secrets.ts)) that guards every write transaction:

1. **Auto-Interception**: `store.propose`, `store.save`, `setUserProfile`, `importSnapshot`, and `importTranscript` automatically scan content and throw immediately if a secret is detected.
2. **Blocked Patterns**:
   - OpenAI / Anthropic / AI API keys (`sk-...`, `sk-proj-...`)
   - GitHub Personal Access Tokens (`ghp_...`, `gho_...`, `github_pat_...`)
   - NPM tokens (`npm_...`)
   - AWS Access Key IDs (`AKIA...`, `ASIA...`)
   - Private Key blocks (`-----BEGIN ... PRIVATE KEY-----`)
   - Database URIs (`postgres://[USER]:[PASS]@[HOST]:5432/[DB]`)
   - Hardcoded password assignments (`password = ...`, `api_key = ...`)
3. **Agent Action**: If proposing memories from conversation transcripts, always sanitize credentials as `[REDACTED_SECRET]` before proposing.

---

## 🔌 Comprehensive MCP Tool Matrix & Agent Execution Cheatsheet

| MCP Tool | Execution Phase | Agent Purpose |
|---|---|---|
| `get_context` | **Session Start** | Load Top-$K$ relevant memories, USER.md profile, and active constraints before writing any code. |
| `search` | **Investigation** | Query knowledge base with token budget, status, and type filtering. |
| `memory_get_user_profile` | **Context Loading** | Read active `USER.md` profile and preferences. |
| `memory_set_user_profile` | **Preferences** | Update `USER.md` profile with inline secret defense. |
| `memory_search_transcripts` | **History Search** | Search past `.jsonl` transcripts with conversation bookends and surrounding context. |
| `memory_capture` | **During Fixes** | Propose a new memory unit with inline Vibeguard secret inspection. |
| `memory_confirm` | **Decision Approval** | Promote candidate insight to confirmed status. |
| `memory_supersede` | **Refactoring** | Mark outdated knowledge superseded by a confirmed replacement. |
| `memory_link` | **Graph Building** | Link related memories bidirectionally. |
| `memory_mark_stale` | **Deprecation** | Flag decaying knowledge with deprecation rationale. |
| `memory_reject` | **Hypothesis Refutation**| Mark invalidated hypotheses as rejected. |
| `memory_delete` | **Purge** | Permanently delete entry and record audit trail log. |
| `memory_harvest` | **Session End** | Distill chat transcript into structured fix/decision memory units. |
| `memory_import_transcript`| **Transcript Sync** | Ingest `.jsonl` transcript and auto-bind memories to session nodes. |
| `memory_audit` | **Governance** | Query append-only audit trail. |
| `memory_detect_agents` | **Onboarding** | Scan workstation for 80+ coding agent installations. |
| `memory_connect` | **Setup** | Auto-wire MCP server into detected installed agents with zero permissions. |
| `memory_detect_providers` | **Migration** | Scan machine for 24+ external memory formats. |
| `memory_migrate` | **Migration** | Ingest external memories with state preservation and secret scrubbing. |
| `memory_export` / `import` | **Team Sharing** | Export/import portable JSON memory snapshots. |
| `memory_validate` | **Integrity Check** | Verify YAML schema conformity and referential integrity. |
| `memory_tree_search` | **Tree Retrieval** | Hierarchical reasoning search across partitioned memory shards with disclosure depths. |
| `memory_wiki_compile` | **Wiki Compiler** | Compile confirmed memories into Obsidian-compatible markdown wiki pages. |
| `memory_wiki_search` / `get` | **Wiki Reading** | Search and read compiled concept/entity wiki pages. |
| `memory_entities_search` / `get` | **Entity Graph** | Search extracted named entities and inspect co-occurrence strengths. |
| `memory_pageindex_index` | **Doc Indexing** | Ingest Markdown documents into hierarchical tree representations with secret defense. |
| `memory_pageindex_search` | **Doc Search** | Search PageIndex document tree with reasoning explanations. |
| `memory_pageindex_import` | **Doc Knowledge** | Import PageIndex search results into structured memory entries. |
| `memory_disconnect_pageindex` | **Doc Cleanup** | Disconnect and clean up PageIndex document indexes. |
| `memory_settings_get` / `set` | **Configuration** | Read and update unified global or project configuration settings. |
| `graph_status` | **AST Graph** | Inspect CodeGraph symbol overlap provider status. |

---

## 📋 Scope of Work Tracking & PR Workflow

All Scope-of-Work items live as GitHub issues (labels: `planned` / `in-progress` / `done`) and are mirrored in the README "Scope of Work & Roadmap" table.

1. **No direct-to-main feature work**: every SOW item ships via a feature branch → pull request that references its issue (`Closes #N` in the PR body).
2. **Start every SOW as a PR immediately**: when the feature branch opens, open a **draft PR** right away (`gh pr create --draft`) referencing the issue — before any implementation. Convert to ready-for-review only when the item is complete and validated. Work is never batched onto an untracked branch.
3. **Status transitions**: flip the issue label to `in-progress` when the branch + draft PR open, to `done` when the PR merges; update the README table marker (`☐` → `◐` → `✅`) in the same PR.
4. **New SOW items**: open an issue with the `planned` label first, then add its row to the README table.
5. **Registry sync is automatic**: publishing to npm happens via CI (`.github/workflows/npm-publish.yml`) whenever a `v*` tag is pushed — the same act that creates the GitHub release. Never run `npm publish` manually except as a CI-failure fallback. Version bumps in `package.json` accompany every release tag.

---

## 🧪 Testing & Validation Standards

All modifications must pass the full test suite and TypeScript validation before committing:

```bash
bun test          # full suite — must pass before committing
bunx tsc --noEmit # 0 static type errors
bun run build     # Clean bundled distribution build (dist/index.js)
```

## 🐚 Shell Wrapper Constraints

The sandboxed bash proxy rejects several common constructs — rewrite instead of retrying:

- **Loops** (`for`/`while`): not proxied. Write the loop to a temp script (e.g. `/tmp/opencode/x.sh`) and run `bash /tmp/opencode/x.sh`.
- **Subshells** (`( cmd & )`): syntax error. Use bare `nohup cmd > log 2>&1 &` form instead.
- **Command substitution in quoted args** (e.g. `git commit -m "$(cat <<'EOF' …)"`): mangles the message. Pass `-m "plain text"` directly.
- **`pkill -f <pattern>`** can match its own wrapper shell and hang. Prefer `pgrep -fa` to list PIDs, then `kill <pid>` individually.
