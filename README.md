# <h1> 🧠 Muse Memory</h1>

<div align="center">

![GitHub Release](https://img.shields.io/github/v/release/harshsinghmp/musememory?style=for-the-badge&logo=github&color=blue)
![NPM Version](https://img.shields.io/npm/v/musememory?style=for-the-badge&logo=npm&color=red)
![Bun](https://img.shields.io/badge/Bun-1.4.0-black?style=for-the-badge&logo=bun)
![MCP](https://img.shields.io/badge/MCP-2024--11--05-green?style=for-the-badge&logo=anthropic)
![CI Tests](https://img.shields.io/badge/Tests-297%20Passed-brightgreen?style=for-the-badge&logo=checkmarx)
![License](https://img.shields.io/badge/License-MIT-purple?style=for-the-badge)

**Autonomous, Self-Organizing Cognitive Memory System for AI Agents & Agency Networks**

</div>

---

## 💡 What is Muse Memory? (TL;DR)

Most AI chatbots and coding assistants have **"goldfish memory"**: every time you close a session, switch tasks, or start a new prompt, they forget your project invariants, coding habits, and the hard-fought bug workarounds you solved yesterday.

**Muse Memory gives your AI assistants a persistent, self-organizing cognitive notebook directly on your machine.**

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
│ │ (Token Knapsack)  │ │ Defense Scanner  │ │  (29 Engines)│ │
│ └───────────────────┘ └──────────────────┘ └──────────────┘ │
│ ┌───────────────────┐ ┌──────────────────┐ ┌──────────────┐ │
│ │ LifeCycle Machine │ │ Knowledge Wiki   │ │ Audit Ledger │ │
│ │(State Transitions)│ │ (Obsidian/Entities│ │(audit.jsonl) │ │
│ └───────────────────┘ └──────────────────┘ └──────────────┘ │
└──────────────────────────────┬──────────────────────────────┘
                               │ Atomic I/O
┌──────────────────────────────▼──────────────────────────────┐
│              Dual-Scope Storage Engine (.memory/)           │
│                                                             │
│  .memory/                                                   │
│  ├── memory.db          # Primary SQLite cognitive database │
│  ├── CURRENT.md         # Active hard constraints & handoff │
│  ├── USER.md            # Persona & developer preferences   │
│  ├── audit.jsonl        # Append-only operational audit trail│
│  └── memories/          # Dual-persisted YAML export mirror │
│      ├── m_1700000001000_auth.yaml                          │
│      └── m_1700000002000_arch.yaml                          │
└─────────────────────────────────────────────────────────────┘
```

- 👤 **Remembers You (`USER.md`)**: Configures your role (`developer`, `designer`, `marketer`, `casual`, `custom`) and communication preferences so AI models talk your language.
- 📐 **Remembers Active Constraints (`CURRENT.md`)**: Real-time auto-synchronization ensures agents never break hard invariants or lose in-flight task context across session interruptions.
- 💾 **Primary SQLite + Dual YAML Mirror**: Millisecond queries from `.memory/memory.db` with human-readable YAML mirrors in `.memory/memories/` for seamless Git tracking and team diffing.
- ⚖️ **Token Knapsack Retrieval**: Multi-factor scoring and exact prompt token budgeting pack relevant memories into prompts with zero token waste.
- 📚 **Knowledge Compounding**: Compiles memories into Obsidian-compatible Markdown wikis (`memory wiki`), named entity co-occurrence graphs (`memory entities`), and hierarchical PageIndex reasoning trees.
- 🔌 **Zero-Permission Auto-Wiring**: Automatically scans for 80+ coding agent platforms (Claude Code, Cursor, Antigravity, Windsurf, OpenCode, Codex, etc.) and wires them with zero friction.
- 🛡️ **Zero-Leakage Secret Defense (Vibeguard)**: Intercepts and rejects API keys, AWS tokens, private keys, and database passwords before they can touch disk.

---

## ⚡ Quick Start & Installation

> [!TIP]
> ### ⚡ Instant 5-Second Setup (Zero-Install NPX / BunX)
> **No global installation required.** Set up your memory system and wire your AI agents with a single command:
>
> ```bash
> npx musememory install
> # (or with Bun: bunx musememory install)
> ```
>
> This command automatically:
> 1. Initializes the SQLite primary database (`.memory/memory.db`) and `CURRENT.md` constraints file.
> 2. Auto-detects all installed AI coding agents on your machine.
> 3. Auto-wires the memory MCP server into installed agents with zero-permission auto-approval.
> 4. Scans for existing memory stores (Letta, Mem0, Beads, Supermemory, etc.) for instant migration.
>
> **Verify anytime**: `npx musememory doctor`  
> **Explore Studio UI**: `npx musememory ui` (Opens cognitive studio on port 2222)

---

### 📦 Persistent Installation Options

```bash
# Option A: Global Install with NPM or Bun (Recommended)
npm install -g musememory
# or with Bun:
bun add -g musememory

# Option B: One-Line Shell Installer
curl -fsSL https://raw.githubusercontent.com/harshsinghmp/musememory/main/scripts/install.sh | bash

# Option C: Docker Container
git clone https://github.com/harshsinghmp/musememory.git && cd musememory
docker build -t musememory .
```

> [!NOTE]
> ### 📊 How does Muse Memory compare to other solutions?
> Explore our interactive, table-free **[30-System Architectural Comparison Dossier](musememory-comparison.html)** (`musememory-comparison.html`) to inspect concrete architectural differentials and one-click migration recipes against 29 external memory engines (Letta, Mem0, Supermemory, Cognee, Beads, Mnemosyne, GBrain, etc.).

---

## 🔄 Complete NPX Lifecycle (Install → Verify → Connect → Uninstall)

Every command works with **zero installation** via `npx musememory <cmd>` (or `bunx musememory <cmd>`). Use plain `memory <cmd>` if installed globally.

### 1️⃣ Install & Auto-Wire
```bash
# Full setup: init .memory/, detect agents, wire MCP, scan for migratable stores
npx musememory install

# Initialize workspace only (no agent wiring)
npx musememory init
```

### 2️⃣ Verify & Health Check
```bash
# Comprehensive ecosystem diagnostic (storage, schemas, secrets, MCP wiring)
npx musememory doctor

# Memory store breakdown and active briefing
npx musememory stats
npx musememory briefing
```

### 3️⃣ Connect Coding Agents (80+ Platforms)
```bash
# Scan workstation for installed AI coding agents
npx musememory agents

# Auto-wire all detected agents with zero permissions
npx musememory connect all

# Wire one specific agent explicitly
npx musememory connect claude-code
npx musememory connect cursor
npx musememory connect antigravity
npx musememory connect windsurf
npx musememory connect opencode
```

### 4️⃣ Clean Uninstallation
```bash
# Preview what would be unwired
npx musememory uninstall --dry-run

# Unwire MCP from all agents (preserves .memory/ data)
npx musememory uninstall

# Unwire AND purge local project .memory/ data
npx musememory uninstall --purge
```

---

## 🏛️ System Capabilities & Architecture

### 1. Dual-Scope Storage (Local vs Global)
- **Local Workspace (`<project>/.memory/`)**: Repository-specific architectural decisions, bug fixes, active `CURRENT.md` constraints, and session timeline nodes.
- **Global System (`~/.memory/` via `--global` / `-g`)**: Universal developer preferences, cross-repo coding conventions, and global prompt patterns.

### 2. Deterministic 7-State Lifecycle Machine & Audit Ledger
All memory entries transition through a guarded state machine:
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
Every mutation (`propose`, `confirm`, `supersede`, `mark_stale`, `reject`, `delete`, `link`) writes an immutable log record to `.memory/audit.jsonl`.

### 3. Knapsack Token Budgeting & Multi-Factor Scoring
Retrieval dynamically ranks knowledge using a calibrated multi-factor formula:
$$\text{Score} = 1.0 \times \text{Applicability} + \text{StatusBonus} + \text{VerificationBonus} + \text{GraphBonus} + \text{SalienceBonus} + 0.3 \times e^{-\frac{\Delta t}{90\text{ days}}}$$
The engine greedily packs ranked memories up to the requested `--token-budget` to guarantee zero prompt overflow.

### 4. Real-Time `CURRENT.md` Synchronization & Session Handoff
- Active constraint memories automatically mirror into `CURRENT.md`.
- In-flight task states, agent checkpoints, and active loops persist across terminal restarts, context compactions, and sudden interruptions.

### 5. Unified Compounding: Obsidian Wiki & Entity Graph
- **Obsidian Wiki Compiler (`memory wiki`)**: Compiles confirmed memory clusters into linked Markdown pages (`wiki/concepts/`, `wiki/entities/`) with bidirectional `[[slug]]` wikilinks.
- **Named Entity Extraction (`memory entities`)**: Automatically extracts persons, products, organizations, tools, and code symbols with co-occurrence edge weights.
- **PageIndex Reasoning Engine (`memory pageindex`)**: Indexes unstructured documents into hierarchical reasoning trees.

### 6. Universal Migration Engine (29 Memory Formats)
Auto-detects and ingests existing memory stores across 29 external engines:
```bash
# Auto-detect all external memory stores on your machine
memory detect

# Ingest and preserve state mappings
memory migrate --provider letta
memory migrate --provider mem0
memory migrate --provider beads
memory migrate --all
```
> See [`musememory-comparison.html`](musememory-comparison.html) for the full table-free 30-system architectural dossier.

---

## 🌐 Cognitive Studio Dashboard (`memory ui`)

Muse Memory includes an embedded, zero-dependency visual graph studio:

```bash
memory ui
# or specify a custom port (default: 2222)
memory ui --port 2222
```

Navigate to `http://localhost:2222` to access:
- 🌐 **3D Force-Directed Knowledge Graph**: Orbital canvas physics, degree-scaled node radii, and link relationship viewer.
- ⚡ **Active Invariants & Real-Time Handoff**: Live `CURRENT.md` monitor tracking in-flight session status and agent checkpoints.
- 📚 **Obsidian Wiki Browser**: Concept and entity page reader with full Markdown rendering.
- 👤 **Persona Studio (`USER.md`)**: 5 archetype picker (`developer`, `designer`, `marketer`, `casual`, `custom`) and live editor.
- 🔍 **Knapsack Retrieval Sandbox**: Interactive token budget simulator (500–6,000 tokens) with live prompt context generation.
- 📜 **Compliance Audit Ledger**: Live tabular feed of state transitions and audit logs.

---

## 📖 Deep Technical References & Documentation

<details>
<summary><b>🔌 Complete MCP Tool Reference (28 Tools)</b> — <i>Click to expand</i></summary>

When registered as an MCP server, `musememory` exposes the following native tools:

| MCP Tool | Execution Phase | Description |
| :--- | :--- | :--- |
| `get_context` | **Session Start** | Fetches Top-$K$ ranked memories, `USER.md` profile, and active `CURRENT.md` constraints. |
| `search` | **Investigation** | Searches memory units with query, token budget, project, type, and verification filters. |
| `memory_current` | **Constraints** | Reads or appends active project working constraints (`CURRENT.md`). |
| `memory_get_user_profile` | **Context Loading** | Reads active `USER.md` persona and communication preferences. |
| `memory_set_user_profile` | **Preferences** | Updates `USER.md` profile with inline secret defense. |
| `memory_capture` | **During Fixes** | Saves a memory entry with inline Vibeguard secret inspection. |
| `memory_confirm` | **Decision Approval** | Promotes candidate insight to confirmed status. |
| `memory_supersede` | **Refactoring** | Marks outdated knowledge superseded by a confirmed replacement. |
| `memory_link` | **Graph Building** | Connects related memories bidirectionally. |
| `memory_mark_stale` | **Deprecation** | Flags decaying knowledge with deprecation rationale. |
| `memory_reject` | **Hypothesis Refutation** | Marks invalidated hypotheses as rejected. |
| `memory_delete` | **Purge** | Permanently deletes an entry and records audit ledger log. |
| `memory_tree_search` | **Tree Retrieval** | Hierarchical reasoning search across partitioned memory shards. |
| `memory_wiki_compile` | **Wiki Compiler** | Compiles confirmed memories into Obsidian-compatible Markdown pages. |
| `memory_wiki_search` / `get` | **Wiki Reading** | Searches and reads compiled concept and entity wiki pages. |
| `memory_entities_search` / `get` | **Entity Graph** | Searches extracted entities and inspects co-occurrence strengths. |
| `memory_pageindex_index` | **Doc Indexing** | Builds a hierarchical reasoning tree from document content. |
| `memory_pageindex_search` | **Doc Search** | Searches PageIndex document tree with reasoning explanations. |
| `memory_pageindex_import` | **Doc Knowledge** | Imports PageIndex search insights directly into memory units. |
| `memory_search_transcripts` | **History Search** | Full-text search over past `.jsonl` transcripts with dialogue context windows. |
| `memory_harvest` | **Session End** | Distills conversation turns into structured fix/outcome units. |
| `memory_import_transcript` | **Transcript Sync** | Ingests `.jsonl` transcript and auto-binds memories to session nodes. |
| `memory_audit` | **Governance** | Queries the append-only operational audit ledger. |
| `memory_detect_agents` | **Onboarding** | Scans workstation for 80+ coding agent installations. |
| `memory_connect` | **Setup** | Auto-wires MCP server into detected installed agents with zero permissions. |
| `memory_detect_providers` | **Migration** | Scans machine for 29 external memory formats. |
| `memory_migrate` | **Migration** | Ingests external memories with state preservation and secret scrubbing. |
| `memory_export` / `import` | **Team Sharing** | Exports and imports portable JSON memory snapshots. |
| `memory_validate` | **Integrity Check** | Verifies database integrity and scans for credential leaks. |
| `memory_settings_get` / `set` | **Configuration** | Reads and updates unified global or project configuration settings. |
| `graph_status` | **AST Graph** | Inspects CodeGraph symbol overlap provider status. |

</details>

<details>
<summary><b>💻 Full CLI Command Matrix (35 Commands)</b> — <i>Click to expand</i></summary>

```bash
memory <command> [arguments] [flags]  # alias: musememory
```

| Command | Arguments / Flags | Description |
| :--- | :--- | :--- |
| `install` | `[path] [--global]` | **One-line complete setup**: initializes `.memory/`, `USER.md`, and auto-wires coding agents. |
| `doctor` | `[path] [--global]` | **System diagnostic**: checks SQLite primary, schemas, secrets, and MCP connections. |
| `uninstall` | `[agent] [--purge] [--dry-run]` | **Clean uninstaller**: unwires MCP configs (and optionally purges `.memory/`). |
| `init` | `[path] [--legacy] [--global]` | Initialize `.memory/` directory and SQLite database. |
| `user` | `[get\|init\|set] [args] [--global]` | Manage `USER.md` persona & preferences across 5 clean archetypes. |
| `connect` | `[agent] [--all] [--force] [--dry-run]` | Auto-wire MCP into detected installed agents with zero permissions. |
| `agents` | *(none)* | Scan workstation for 80+ coding agents (Cursor, Claude Code, Antigravity, etc.). |
| `detect` | *(none)* | Scan workstation and local workspace for 29 external memory systems. |
| `migrate` | `[--provider P] [--all] [--dry-run] [--overwrite]` | Migrate memories into Muse Memory preserving active/archived state. |
| `ui` | `[--port N] [--global]` | Launch 6-view Cognitive Studio dashboard (default port: `2222`). |
| `context` | `[query] [--token-budget N] [--limit N]` | Retrieve Top-$K$ ranked active context for prompt injection. |
| `search` | `<query> [--limit N] [--token-budget N] [--type T]` | Ranked multi-factor token search with score breakdown. |
| `search-transcript` | `<query> [file.jsonl] [--window N]` | Full-text search past transcripts with dialogue context windows. |
| `harvest` | `<text\|file> --project P [--confirmed]` | Distill conversation turns into structured fix/decision memory units. |
| `import-transcript` | `<file.jsonl> [--project P] [--confirmed]` | Ingest raw `.jsonl` session transcripts from coding agents. |
| `capture` / `propose` | `<text> --project P [--title T] [--type T]` | Propose a memory entry with inline Vibeguard secret inspection. |
| `recall` | `<query> [--limit N] [--token-budget N]` | Rich recall displaying verification levels and related graph links. |
| `confirm` | `<id> [--global]` | Promote `candidate`, `disputed`, or `stale` entry to `confirmed`. |
| `supersede` | `<old_id> --with <new_id>` | Mark old entry superseded by new confirmed replacement. |
| `mark-stale` | `<id> [--reason <text>]` | Mark an entry stale with deprecation rationale. |
| `reject` | `<id> [--global]` | Mark an entry rejected. |
| `delete` | `<id> [--reason <text>]` | Permanently delete a memory entry and record audit event. |
| `audit` | `[--operation OP] [--entry-id ID] [--limit N]` | Query append-only operational audit trail (`.memory/audit.jsonl`). |
| `link` | `<id> --related <id1,id2>` | Synchronize bidirectional relation links between entries. |
| `export` / `import` | `[--out <file.json>]` / `<file.json>` | Export and import portable JSON memory snapshots. |
| `list` / `ls` | `[--status S] [--type T] [--project P]` | List memory entries with multi-field status and type filtering. |
| `stats` | `[--global]` | Breakdown statistics of total memories, status, and type metrics. |
| `briefing` | `[--limit N] [--global]` | Active summary of recent entries, status counts, and due items. |
| `nudge` | `[--global]` | Proactive attention list: overdue entries, stale policies, open loops. |
| `routine` | `run <name>` / `install [name]` | Execute `.memory/routines.yaml` steps or print crontab lines. |
| `wiki` | `compile\|list\|show <slug>` | Compile and browse Obsidian-compatible Markdown wiki pages. |
| `entities` | `list\|show <id>\|related <id>` | Inspect extracted knowledge graph entities and co-occurrence weights. |
| `settings` | `get\|set\|reset\|export\|import` | Manage unified settings across retrieval, wiki, PageIndex, and UI. |
| `current` | `get` / `set <text> --project P` | Read or append hard constraints in `.memory/CURRENT.md`. |
| `graph` | `status` | Query active CodeGraph provider status. |
| `mcp` | *(none)* | Start stdio MCP server (Protocol 2024-11-05). |

</details>

<details>
<summary><b>👤 5 Zero-Fingerprint Role Archetypes (`USER.md`)</b> — <i>Click to expand</i></summary>

Muse Memory maintains a persistent user profile (`~/.memory/USER.md` globally, or `.memory/USER.md` locally) to ground AI agents in your working style:

1. **`developer`** (Default): Code-first, direct, concise, runnable diffs, strict types, fail-fast mechanics.
2. **`designer`**: Visual hierarchy, CSS/Tailwind systems, GSAP animations, WCAG accessibility, Figma/tokens design tokens.
3. **`marketer`**: Conversion-rate optimization (CRO), punchy benefit-driven copy, SEO clustering, audience hooks.
4. **`casual`**: Plain English, jargon-free explanations, step-by-step guidance.
5. **`custom`**: Clean blank template ready for personalized instructions.

```bash
# View active profile
memory user get

# Initialize with a specific archetype
memory user init developer
memory user init designer --global

# Update user profile
memory user set "- Prefers TypeScript, Bun, and ultra terse responses"
```

</details>

<details>
<summary><b>🔮 SOW & Roadmap Issue Tracker</b> — <i>Click to expand</i></summary>

Every Scope-of-Work item is tracked as a GitHub issue and delivered via pull request. Live status: [issue tracker](https://github.com/harshsinghmp/musememory/issues).

| Status | Item | Tracker |
| :--- | :--- | :--- |
| ✅ | Dynamic Prompt Token Budgeter (`--token-budget N`) — knapsack packing under hard token ceilings | shipped v1.1.0 |
| ✅ | Scene-Based Hierarchical Consolidation (`memory consolidate`) | [#1](https://github.com/harshsinghmp/musememory/issues/1) |
| ✅ | Autonomous Verification Oracle (`memory verify <id>`) | [#2](https://github.com/harshsinghmp/musememory/issues/2) |
| ✅ | Multi-Hop Causality Graph Tracer (`memory trace <id>`) | [#3](https://github.com/harshsinghmp/musememory/issues/3) |
| ✅ | In-Place Core Memory Partitioning (`memory core`) | [#4](https://github.com/harshsinghmp/musememory/issues/4) |
| ✅ | Automated Post-Turn Transcript Harvester Hook | [#5](https://github.com/harshsinghmp/musememory/issues/5) |
| ✅ | Real-Time Agency WebSocket Hub (`memory daemon`) | [#6](https://github.com/harshsinghmp/musememory/issues/6) |
| ✅ | Local Offline Hybrid Vector Engine | [#7](https://github.com/harshsinghmp/musememory/issues/7) |
| ✅ | Delete Deprecated `MemoryStore` Shim *(shipped v1.5.0)* | [#8](https://github.com/harshsinghmp/musememory/issues/8) |
| ✅ | Self-Evolving Skill Distillation | [#9](https://github.com/harshsinghmp/musememory/issues/9) |
| ✅ | 3-Layer Progressive Disclosure | [#10](https://github.com/harshsinghmp/musememory/issues/10) |
| ✅ | Bi-Temporal Reinforcement Feedback | [#11](https://github.com/harshsinghmp/musememory/issues/11) |
| ✅ | Ambient Open-Loop Tracker | [#12](https://github.com/harshsinghmp/musememory/issues/12) |
| ✅ | Knowledge Graph UI v2 | [#13](https://github.com/harshsinghmp/musememory/issues/13) |
| ✅ | Proactive Nudges & Check-ins (`memory nudge`) — SOW-101 | [#28](https://github.com/harshsinghmp/musememory/issues/28) |
| ✅ | Daily Briefing & Routines Scheduler (cron-invoked, no daemon) — SOW-102 | [#29](https://github.com/harshsinghmp/musememory/issues/29) |
| ✅ | Open-Loop / Task Extraction from Transcripts — SOW-103 | [#30](https://github.com/harshsinghmp/musememory/issues/30) |
| ✅ | Calendar / Time-Aware Follow-ups (`due_at` / `expires_at`) — SOW-104 | [#31](https://github.com/harshsinghmp/musememory/issues/31) |
| ✅ | muse-agents ↔ musememory Integration Contract (`--for-agent`) — SOW-106 | [#33](https://github.com/harshsinghmp/musememory/issues/33) |
| ✅ | AST Symbol Graph Integration (CodeGraph / Graphify provider) — SOW-107 | [#35](https://github.com/harshsinghmp/musememory/issues/35) |

</details>

---

## 🧪 Testing & Verification

```bash
bun install
bun test          # 297 passed across 53 test files (1163 assertions)
bun run typecheck # 0 static type errors
bun run build     # Clean bundled distribution build (dist/index.js)
```

---

## 📜 License

MIT License. Built for the AI Developer Ecosystem.