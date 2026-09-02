# <h1> 🧠 Muse Memory</h1>

<div align="center">

![GitHub Release](https://img.shields.io/github/v/release/harshsinghmp/musememory?style=for-the-badge&logo=github&color=2563EB)
![NPM Version](https://img.shields.io/npm/v/musememory?style=for-the-badge&logo=npm&color=CB3837)
![Bun](https://img.shields.io/badge/Bun-v1.4.0_(Latest)-black?style=for-the-badge&logo=bun)
![Node.js](https://img.shields.io/badge/Node.js-≥18.0.0-339933?style=for-the-badge&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=for-the-badge&logo=typescript&logoColor=white)

![MCP Protocol](https://img.shields.io/badge/MCP-2024--11--05-green?style=for-the-badge&logo=anthropic)
![SQLite Engine](https://img.shields.io/badge/SQLite-Primary_DB-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![AST Graph](https://img.shields.io/badge/AST-CodeGraph_%26_Graphify-orange?style=for-the-badge&logo=diagram-project&logoColor=white)
![Architecture](https://img.shields.io/badge/Storage-Zero--Daemon_%2F_Local--First-0D9488?style=for-the-badge)

![CI Tests](https://img.shields.io/badge/Tests-480%20Passed-brightgreen?style=for-the-badge&logo=checkmarx)
![Security](https://img.shields.io/badge/Security-Vibeguard_Zero--Leak-DC2626?style=for-the-badge&logo=shield)
![Agent Coverage](https://img.shields.io/badge/Agents-80+_Supported-4F46E5?style=for-the-badge&logo=openai)
![License](https://img.shields.io/badge/License-MIT-9333EA?style=for-the-badge)

**Autonomous, Self-Organizing Cognitive Memory System for AI Agents & Agency Networks**

</div>

---

## 🚀 What's New in v2.0.0 (Autonomous Cognitive Engine Major Overhaul)

- **🏥 Unified 5-Pillar Project Health Gate (`memory health` / `muse_health`)**: Comprehensive single-call architectural and memory health audit scoring Store Integrity, Code Anchor Validity, Doc $\leftrightarrow$ Code Alignment, Negative Sentry, and Technical Debt with letter grades (A-F), PASS/WARN/FAIL status, and automated remediation checklists.
- **🧠 Autonomous Engineering Cognition & "Why" Reasoner (`muse_why`)**: Traces code evolution backwards through past bug fixes, ADRs, accepted trade-offs, and invariants to explain *why* code was built the way it is before refactoring.
- **🏛️ First-Class Architecture Decision Records (`memory_adr_record` / `memory_adr_list`)**: ADRs as queryable, scored, living memory units with options considered, consequences, native code anchors, and supersession lineage.
- **🔄 Bidirectional Documentation $\leftrightarrow$ Code Drift Engine (`memory_drift_audit`)**: Continuously verifies that documented architectural invariants match live implementation and flags missing, stale, or conflicting code.
- **🎯 Flagship Unified Context Orchestrator (`muse_context`)**: Single-call fused entry point combining search, active file, symbol, error messages, and task intent under strict knapsack token budgets.
- **⚙️ Task-Focused MCP Profiles**: Solves agent tool bloat with role-tailored tool filtering profiles (`core`, `coding`, `debugging`, `review`, `architecture`, `maintenance`).
- **⚓ Native Structural Code Anchors (`src/anchors/`)**: Line-independent structural hashing invariant to comment/spacing edits while strictly sensitive to AST/logic modifications.
- **🪜 Scoped Promotion & Extended Archival Lifecycle (`src/promotion/`)**: 3-tier promotion ladder (`local` $\rightarrow$ `project` $\rightarrow$ `global`), 5× repeated success policy, universal generalization, and `active` $\rightarrow$ `cold` $\rightarrow$ `dormant` $\rightarrow$ `archived` lifecycle with dynamic query rehydration.
- **⚡ Hot Query Cache & Multi-Factor Retrieval**: Microsecond caching, SQLite WAL optimization, and 11-dimension retrieval scoring.

---

## 📑 Table of Contents

- [🚀 What's New in v2.0.0](#-whats-new-in-v200-autonomous-cognitive-engine-major-overhaul)
- [💡 What is Muse Memory? (TL;DR)](#-what-is-muse-memory-tldr)
- [✨ Key Feature Highlights](#-key-feature-highlights)
- [⚡ Quick Start & Installation](#-quick-start--installation)
- [🔄 Upgrading & Self-Healing Maintenance](#-upgrading--self-healing-maintenance)
- [🧠 Shipped Agent Skills (`.agents/skills/`)](#-shipped-agent-skills-agentsskills)
- [👤 5 Role Archetypes (`USER.md`)](#-5-zero-fingerprint-role-archetypes-usermd)
- [🔌 Full CLI Command Matrix](#-full-cli-command-matrix)
- [🛡️ Vibeguard Zero-Leakage Protocol](#️-vibeguard-zero-leakage-protocol)
- [🧪 Testing & Verification](#-testing--verification)
- [🔮 Sprint & Roadmap Board](#-sprint--roadmap-board)
- [📜 License](#-license)

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

---

## ✨ Key Feature Highlights

- 👤 **Persona & Style Grounding (`USER.md`)**: Configures your role (`developer`, `designer`, `marketer`, `casual`, `custom`) and communication preferences so AI models write code that matches your style.
- 📐 **Real-Time Active Constraints (`CURRENT.md`)**: Bi-temporal working constraints and invariant tracking synchronized on every mutation to eliminate amnesia during task handoffs.
- 💾 **SQLite Primary + Dual-Persisted YAML Mirror**: Sub-millisecond queries via SQLite with transparent human-readable `.yaml` files in `.memory/memories/` for seamless Git diffs.
- ⚖️ **Token Knapsack Retrieval**: Multi-factor scoring (applicability, verification bonus, AST graph overlap, time decay, due date urgency) tightly packed under prompt token ceilings.
- 🌐 **Pluggable AST CodeGraph & Symbol Indexing**: Native CodeGraph & Graphify integration that indexes codebase AST symbols, auto-tags memories, and awards graph overlap bonuses.
- 🌳 **Hierarchical Tree Retrieval & Progressive Disclosure**: Sharded tree partitions with 3-tier progressive disclosure (`L1` abstracts, `L2` summaries, `L3` full context) for massive knowledge bases.
- 📚 **Obsidian Markdown Wiki & Entity Graph Compiler**: Dual-persistence knowledge compounding compiling linked Markdown pages (`wiki/concepts/`, `wiki/entities/`) with bidirectional `[[wikilinks]]`.
- 🛡️ **Vibeguard Zero-Leakage Secret Scanner**: Regex-powered memory defense intercepting and rejecting API keys, AWS credentials, private keys, database URIs, and passwords before writes.
- 🔌 **Zero-Permission Auto-Wiring (80+ Agents)**: Automatically detects and wires Claude Code, Cursor, Antigravity, Windsurf, OpenCode, Codex, Gemini CLI, Hermes, etc.
- 🔄 **Universal Memory Migrator (29 Engines)**: One-click migration from Letta, Mem0, Supermemory, Cognee, Beads, Mnemosyne, GBrain, and more with state preservation.
- 🎨 **Cognitive Studio Visual Dashboard (`memory ui`)**: Embedded zero-dependency web interface featuring 3D force-directed knowledge graphs, live `CURRENT.md` monitor, wiki reader, and persona editor.
- ⏰ **Proactive Nudges & Routines Scheduler**: Cron-invoked daily briefings, staleness policy tracking, and ambient open-loop trackers with zero resident background daemons.

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
---

## 🔄 Upgrading & Self-Healing Maintenance

Keep Muse Memory and all your connected AI coding agents at peak cognitive performance with automated updates and self-healing environment repairs.

### ⚡ 1-Command Autonomous Upgrade (`memory upgrade`)

Run `memory upgrade` (or `npx musememory upgrade`) to trigger the **Gamified Level-Up Matrix**:

```bash
memory upgrade
# or with NPX zero-install:
npx musememory upgrade
```

```
┌──────────────────────────────────────────────────────────────────┐
│  🧠 MUSE MEMORY · SYSTEM LEVEL-UP & RECOVERY MATRIX              │
└──────────────────────────────────────────────────────────────────┘

  [████████████████████] 100% ✓ LEVEL 1: Vibeguard Security & Credential Audit [OK]
  [████████████████████] 100% ✓ LEVEL 2: Package Manager Sync (bun/npm) [OK]
  [████████████████████] 100% ✓ LEVEL 3: Synaptic Storage & Schema Alignment [OK]
  [████████████████████] 100% ✓ LEVEL 4: 80+ Agent Platforms & Skills Auto-Wiring [OK]
  [████████████████████] 100% ✓ LEVEL 5: Cognitive Ascendance Complete [OK]

🏆 [LEVEL-UP COMPLETE] Muse Memory is now fully armed and up to date!
```

#### What `memory upgrade` automatically handles:
1. **Package Manager Auto-Detection**: Detects whether your workstation runs `bun`, `npm`, `pnpm`, or `yarn` and pulls the latest published binary.
2. **Self-Healing Storage Repair**: Recovers missing `.memory/`, `CURRENT.md` constraints, or `USER.md` persona files if corrupted or deleted.
3. **80+ Agent Platform Re-Discovery**: Scans for newly installed coding agents (Cursor, Claude Code, Windsurf, OpenCode, Codex, Gemini CLI, Hermes, etc.) and auto-wires them with zero permissions.
4. **AST Symbol Graph Re-Indexing**: Re-synchronizes CodeGraph/Graphify symbol caches under `.memory/graph-symbols.json`.

---

### 📦 Manual Package Manager Upgrades

| Toolchain / Runtime | Upgrade Command | Verification |
| :--- | :--- | :--- |
| **Bun** (Ultra-Fast) | `bun add -g musememory@latest` | `memory doctor` |
| **NPM** (Standard Node) | `npm install -g musememory@latest` | `memory doctor` |
| **PNPM** | `pnpm add -g musememory@latest` | `memory doctor` |
| **Yarn** | `yarn global add musememory@latest` | `memory doctor` |
| **NPX** (Zero-Install) | `npx musememory@latest upgrade` | `npx musememory doctor` |

```bash
# Check if updates are available without applying
memory upgrade --check

# Force re-installation and complete platform re-wiring
memory upgrade --force
```

---

## 🔄 Complete Lifecycle (Install → Verify → Connect → Uninstall)

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

### 4️⃣ Clean Uninstallation & Removal

<details>
<summary><b>🗑️ Complete Uninstallation & System Removal Steps</b> — <i>Click to expand</i></summary>

Muse Memory can be cleanly and completely removed with zero trace left on your machine.

#### Step 1: Unwire Coding Agents (Zero-Trace MCP Cleanup)
Remove the memory MCP server configuration from all 80+ detected agent config files (`cursor`, `claude-code`, `antigravity`, `windsurf`, `opencode`, `codex`, etc.):

```bash
# Preview changes before modifying any configuration
npx musememory uninstall --dry-run

# Unwire all detected AI coding agents automatically
npx musememory uninstall

# Or unwire a single specific agent
npx musememory uninstall cursor
```

#### Step 2: Purge Memory Data & Stores (Optional)
By default, `uninstall` preserves your project `.memory/` data. To completely delete all memory files and databases:

```bash
# Unwire agents AND purge local project .memory/ directory
npx musememory uninstall --purge

# Remove global user profile and global memory store (~/.memory/)
npx musememory uninstall --global --purge

# Manual cleanup (equivalent):
rm -rf .memory/           # Local project store
rm -rf ~/.memory/          # Global user profile & store
```

#### Step 3: Remove Globally Installed Package
If you installed `musememory` globally via a package manager:

```bash
# If installed via npm:
npm uninstall -g musememory

# If installed via bun:
bun remove -g musememory

# If installed via yarn / pnpm:
pnpm remove -g musememory
yarn global remove musememory
```

#### Step 4: Clean Git Hooks & Directives (Optional)
If you installed the pre-commit transcript harvester hook or injected agent prompt directives:
- **Git Hook**: Delete `.git/hooks/pre-commit` (or restore your previous hook).
- **AGENTS.md**: Remove the `<!-- musememory:start --> ... <!-- musememory:end -->` block from your project's `AGENTS.md` file.

</details>

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
<summary><b>🔌 Complete MCP Tool Reference (61 Tools across 6 Profiles)</b> — <i>Click to expand</i></summary>

When registered as an MCP server, `musememory` exposes the following native tools (filtered dynamically into role-tailored profiles to eliminate tool bloat):

| MCP Tool | Execution Phase | Description |
| :--- | :--- | :--- |
| `muse_context` | **Flagship Fusion** | Single-call fused orchestrator combining search, active file, symbol, error messages, and task intent under strict knapsack token budgets. |
| `muse_health` | **Quality Gate** | 5-Pillar Project Health Gate: audits store integrity, code anchors, doc/code alignment, anti-pattern sentry, and technical debt with A-F grading and pass/fail status. |
| `muse_why` | **Cognition / "Why"** | Explains *why* code was designed the way it is by reconstructing past ADRs, bug fixes, trade-offs, and timeless rules. |
| `muse_bug_clusters` | **Fragility Hotspots** | Categorizes recurring bugs into 5 root causes with subsystem fragility scoring. |
| `muse_tech_debt` | **Technical Debt** | Scans code and memory for TODO/FIXME markers, unsafe `as any` casts, and drifted anchors. |
| `muse_memory_for_code`| **Code-to-Memory** | Queries all memories, ADRs, constraints, and bugs associated with a code file and symbol. |
| `muse_code_for_memory`| **Memory-to-Code** | Resolves all native code anchors and affected source files for a given memory entry. |
| `memory_adr_record` / `list` | **Architecture Decisions** | Records and queries first-class Architecture Decision Records with native code anchors and options considered. |
| `memory_drift_audit` | **Drift Engine** | Audits bi-directional documentation $\longleftrightarrow$ code drift across 6 alignment states (`DOCUMENTED`, `IMPLEMENTED`, `PARTIAL`, `CONFLICTING`, `STALE`, `MISSING`). |
| `memory_capture_negative` | **Negative Sentry** | Records failed approaches, anti-patterns, and reproduction commands to prevent repeating mistakes. |
| `memory_promote_scope` | **Scoped Promotion** | Promotes memory along 3-tier ladder (`local` $\rightarrow$ `project` $\rightarrow$ `global`) with 5× repeated success policy and universal generalization. |
| `memory_archive` / `rehydrate` | **Archival Lifecycle** | Evaluates and manages `active` $\rightarrow$ `cold` $\rightarrow$ `dormant` $\rightarrow$ `archived` lifecycle with query rehydration. |
| `memory_lifecycle_stats` / `sweep` | **Lifecycle Sweeper** | Reports store-wide lifecycle statistics and executes sweep transitions for aging memories. |
| `anchor_create` / `verify` / `audit` | **Code Identity** | Creates, verifies, and audits line-independent structural code anchors. |
| `profile_list` / `profile_switch` | **Tool Management** | Lists and switches task-focused MCP profiles (`core`, `coding`, `debugging`, `review`, `architecture`, `maintenance`). |
| `get_context` | **Session Start** | Fetches Top-$K$ ranked memories, `USER.md` profile, active `CURRENT.md` constraints, and supports `--tier 0|1|2`. |
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
| `memory_source_add` / `list` | **Provenance** | Records external docs/RFCs/URLs into `.memory/sources.json` and queries sources. |
| `memory_claim_record` / `list` | **Claim Ledger** | Records evidence-backed claims tagged with `[RAW]`, `[FETCH]`, `[SEARCH]`, `[INFER]`. |
| `memory_freeze_run` / `list` | **Execution Snapshots** | Freezes immutable task snapshots with file inventory and SHA-256 memory hashes. |
| `memory_prompt_list` / `get` / `run` | **Prompt Templates** | Manages and executes native structured prompt templates with live context injection. |
| `memory_rollup` | **Temporal Compounding** | Aggregates atomic memories into weekly, monthly, and quarterly rollups and updates `HOT.md`. |
| `memory_loop_record` / `status` | **Gauntlet Loops** | Multi-agent iteration ledger and plateau/regression detector (`.memory/iterations.jsonl`). |
| `memory_verify_strict` | **Integrity Gate** | Zero-tolerance audit verifying secrets, referential links, wikilinks, claims, and candidates. |
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
| `graph_status` | **AST Graph** | Inspects CodeGraph/Graphify symbol overlap provider status. |
| `graph_index` | **AST Graph** | Indexes AST symbol graph and caches in `.memory/graph-symbols.json`. |

</details>

<details>
<summary><b>💻 Full CLI Command Matrix (42 Commands)</b> — <i>Click to expand</i></summary>

```bash
memory <command> [arguments] [flags]  # alias: musememory
```

| Command | Arguments / Flags | Description |
| :--- | :--- | :--- |
| `health` | `[--json] [--global]` | **Unified 5-Pillar Project Health Gate**: audits Store Integrity, Code Anchors, Drift, Sentry, and Tech Debt with A-F grading and pass/fail gate. |
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
| `context` | `[query] [--token-budget N] [--limit N] [--tier 0\|1\|2]` | Retrieve Top-$K$ ranked active context for prompt injection. |
| `search` | `<query> [--limit N] [--token-budget N] [--type T]` | Ranked multi-factor token search with score breakdown. |
| `search-transcript` | `<query> [file.jsonl] [--window N]` | Full-text search past transcripts with dialogue context windows. |
| `learn` / `sync-chats` | `[--confirm] [--force] [--max N]` | **Universal auto-learner**: auto-discovers and distills memories from all agent chats across host machine. |
| `harvest` | `<text\|file> --project P [--confirmed]` | Distill conversation turns into structured fix/decision memory units. |
| `import-transcript` | `<file.jsonl> [--project P] [--confirmed]` | Ingest raw `.jsonl` session transcripts from coding agents. |
| `capture` / `propose` | `<text> --project P [--title T] [--type T]` | Propose a memory entry with inline Vibeguard secret inspection. |
| `recall` | `<query> [--limit N] [--token-budget N]` | Rich recall displaying verification levels and related graph links. |
| `confirm` | `<id> [--global]` | Promote `candidate`, `disputed`, or `stale` entry to `confirmed`. |
| `supersede` | `<old_id> --with <new_id>` | Mark old entry superseded by new confirmed replacement. |
| `mark-stale` | `<id> [--reason <text>]` | Mark an entry stale with deprecation rationale. |
| `reject` | `<id> [--global]` | Mark an entry rejected. |
| `delete` | `<id> [--reason <text>]` | Permanently delete a memory entry and record audit event. |
| `source` | `add\|list\|show <url> [--title T] [--type T]` | Manage external documentation and URLs in provenance Source Ledger (`.memory/sources.json`). |
| `claim` | `record\|list\|show <text> [--confidence RAW\|FETCH\|SEARCH\|INFER]` | Record and query verifiable claims connected to sources (`.memory/claims.json`). |
| `freeze` | `--task <task.md\|text> [--run-id R]` | Capture immutable execution snapshot with file inventory and SHA-256 memory hashes. |
| `prompt` | `list\|show\|run <name> [--args k=v,...]` | Manage and run structured prompt templates with live context injection. |
| `rollup` | `--period week\|month\|quarter [--date YYYY-MM-DD]` | Multi-scale temporal compounding and `.memory/HOT.md` working memory cache compiler. |
| `loop` | `record\|status\|clear` | Multi-agent Gauntlet iteration ledger and plateau/regression detector. |
| `verify` | `<id> [--timeout S] [--strict]` | Execute a fix entry's test command or run full strict integrity gate. |
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
| `graph` | `status` / `index` | Query active CodeGraph provider status or index AST symbol map. |
| `mcp` | *(none)* | Start stdio MCP server (Protocol 2024-11-05). |

</details>

<details>
<summary><b>🧠 Shipped Agent Skills (<code>.agents/skills/</code>)</b> — <i>Click to expand</i></summary>

Muse Memory ships with 6 turnkey Agent Skills designed for coding agents (Claude Code, Cursor, Antigravity, OpenCode, Codex, Gemini CLI, etc.) under `.agents/skills/`:

| Skill | Trigger Phase | Core Agent Responsibility |
| :--- | :--- | :--- |
| [`muse-ground`](.agents/skills/muse-ground/SKILL.md) | **Session Start** | Retrieves Top-$K$ relevant memories, active `USER.md` persona profile, and `CURRENT.md` constraints before writing code. |
| [`muse-capture`](.agents/skills/muse-capture/SKILL.md) | **During Fixes & Refactors** | Captures atomic fix/architecture memories, validates evidence, runs Vibeguard secret scan, and supersedes obsolete knowledge. |
| [`muse-current`](.agents/skills/muse-current/SKILL.md) | **Invariants & Handoffs** | Synchronizes hard constraints into `.memory/CURRENT.md` and persists structured handoffs across context resets. |
| [`muse-graph`](.agents/skills/muse-graph/SKILL.md) | **AST Code Investigation** | Indexes `.codegraph`/`.graphify` symbols and queries symbol-matching decisions with `+0.2` graph overlap bonus. |
| [`muse-wiki`](.agents/skills/muse-wiki/SKILL.md) | **Knowledge Compounding** | Compiles confirmed memories into Obsidian-compatible Markdown pages (`[[wikilinks]]`) and entity co-occurrence graphs. |
| [`muse-brief`](.agents/skills/muse-brief/SKILL.md) | **Daily Hygiene & Loops** | Generates morning briefings, tracks 90/180-day staleness decay, and surfaces unresolved transcript commitments. |

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

---

## 🧪 Testing & Verification

```bash
bun install
bun test          # 322 passed across 58 test files (1305 assertions)
bun run typecheck # 0 static type errors
bun run build     # Clean bundled distribution build (dist/index.js)
```

---

## 🔮 Sprint & Roadmap Board

<details>
<summary><b>🔮 Sprint & Roadmap Lifecycle (Requested ➔ Planned ➔ In Progress ➔ Done)</b> — <i>Click to expand</i></summary>

Muse Memory features are developed in structured sprints moving across 4 deterministic lifecycle phases following strict `vX.Y.Z` semantic versioning. Every sprint is delivered via PR from `dev` to `main` with associated GitHub milestones. Live tracking: [GitHub Issues & Milestones](https://github.com/harshsinghmp/musememory/issues).

```
[ 📋 Requested ] ──► [ 📅 Planned ] ──► [ ⚡ In Progress ] ──► [ ✅ Done ]
 (Issues / PRs)     (Sprint Backlog)    (Active PR / Milestone)  (Shipped to Main)
```

### 🏷️ Semantic Versioning Protocol (`vX.Y.Z`)
- **`X` (Major)**: Breaking architectural changes, core schema shifts, or protocol overhauls (`vX.0.0`).
- **`Y` (Feature)**: Substantive new agent capabilities, MCP tools, or CLI subcommands (`vX.Y.0`).
- **`Z` (Minor / Hotfix / Critical Fix)**: Bug remediations, security patches, performance, and urgent hotfixes (`vX.Y.Z`).

### 📋 Phase 1: Requested (Backlog)
*Incoming community proposals, agent adapters, and feature requests pending sprint triage:*
- [ ] Multi-Agent Consensus Verification Protocol (cross-agent memory agreement)
- [ ] Continuous Background Memory Compaction & Pruning Cron
- [ ] Export to Local Vector GGUF Embedding Index

### 📅 Phase 2: Planned
*Confirmed high-leverage features scheduled for upcoming sprints:*
- [ ] **Tiered Retrieval Engine**: Deterministic Tier 0 (manifest), Tier 1 (invariants), Tier 2 (bounded bodies) knapsack retrieval
- [ ] **Provenance & Claim Ledgers**: Direct memory citations with `[RAW]`, `[FETCH]`, `[SEARCH]`, and `[INFER]` confidence tagging
- [ ] **Frozen Context Snapshots**: Immutable SHA-256 state tracking for reproducible agent execution
- [ ] **Native Prompt Registry**: Declarative prompt library & runner (`.memory/prompts/*.md`, `memory prompt run`)
- [ ] **Temporal Compounding**: Multi-scale Day $\to$ Week $\to$ Quarter wiki rollups & `.memory/HOT.md` cache
- [ ] **Gauntlet Iteration Ledger**: Multi-turn improvement loop tracking and plateau detection
- [ ] **Strict Health Gate**: Comprehensive `memory verify --strict` referential, link, and secret validator

### ⚡ Phase 3: In Progress (Active Sprint / PR)
*Currently under active development on dedicated feature branches:*
- *(None — Sprint SOW-200 completed and shipped)*

### ✅ Phase 4: Done (Shipped to Production)
*All completed, tested, and released milestones:*
| Status | Milestone / Feature | Shipped Release / Tracker |
| :--- | :--- | :--- |
| ✅ | **SOW-201**: Live Runtime File & Symbol Verification Gate (`STRONG`/`WEAK`/`STALE`) | shipped v1.8.0 |
| ✅ | **SOW-202**: Deterministic Relevance Cutoff Gate (hard score threshold $\ge 0.45$) | shipped v1.8.0 |
| ✅ | **SOW-203**: Git Code-Drift Scanner CLI (`memory drift` / `memory check`) | shipped v1.8.0 |
| ✅ | **SOW-204**: Gradient-Free Hebbian Co-Activation Plasticity (synaptic link reinforcement) | shipped v1.8.0 |
| ✅ | **SOW-205**: Semantic Memory Prompt Compression (`memory compress` lossless prompt packer) | shipped v1.8.0 |
| ✅ | Turnkey Agent Skills Suite (`muse-ground`, `muse-capture`, etc.) | shipped v1.7.0 |
| ✅ | AST Symbol Graph Integration (CodeGraph / Graphify) | [#35](https://github.com/harshsinghmp/musememory/issues/35) / v1.7.0 |
| ✅ | Zero-Friction Installation Lifecycle Fix | shipped v1.7.1 |
| ✅ | Proactive Nudges & Check-ins (`memory nudge`) — SOW-101 | [#28](https://github.com/harshsinghmp/musememory/issues/28) |
| ✅ | Daily Briefing & Routines Scheduler (cron-invoked, no daemon) — SOW-102 | [#29](https://github.com/harshsinghmp/musememory/issues/29) |
| ✅ | Open-Loop / Task Extraction from Transcripts — SOW-103 | [#30](https://github.com/harshsinghmp/musememory/issues/30) |
| ✅ | Calendar / Time-Aware Follow-ups (`due_at` / `expires_at`) — SOW-104 | [#31](https://github.com/harshsinghmp/musememory/issues/31) |
| ✅ | muse-agents ↔ musememory Integration Contract (`--for-agent`) — SOW-106 | [#33](https://github.com/harshsinghmp/musememory/issues/33) |
| ✅ | Dynamic Prompt Token Budgeter (`--token-budget N`) | shipped v1.1.0 |
| ✅ | Scene-Based Hierarchical Consolidation (`memory consolidate`) | [#1](https://github.com/harshsinghmp/musememory/issues/1) |
| ✅ | Autonomous Verification Oracle (`memory verify <id>`) | [#2](https://github.com/harshsinghmp/musememory/issues/2) |
| ✅ | Multi-Hop Causality Graph Tracer (`memory trace <id>`) | [#3](https://github.com/harshsinghmp/musememory/issues/3) |
| ✅ | In-Place Core Memory Partitioning (`memory core`) | [#4](https://github.com/harshsinghmp/musememory/issues/4) |
| ✅ | Automated Post-Turn Transcript Harvester Hook | [#5](https://github.com/harshsinghmp/musememory/issues/5) |
| ✅ | Real-Time Agency WebSocket Hub (`memory daemon`) | [#6](https://github.com/harshsinghmp/musememory/issues/6) |
| ✅ | Local Offline Hybrid Vector Engine | [#7](https://github.com/harshsinghmp/musememory/issues/7) |
| ✅ | Delete Deprecated `MemoryStore` Shim | [#8](https://github.com/harshsinghmp/musememory/issues/8) / v1.5.0 |
| ✅ | Self-Evolving Skill Distillation | [#9](https://github.com/harshsinghmp/musememory/issues/9) |
| ✅ | 3-Layer Progressive Disclosure | [#10](https://github.com/harshsinghmp/musememory/issues/10) |
| ✅ | Bi-Temporal Reinforcement Feedback | [#11](https://github.com/harshsinghmp/musememory/issues/11) |
| ✅ | Ambient Open-Loop Tracker | [#12](https://github.com/harshsinghmp/musememory/issues/12) |
| ✅ | Knowledge Graph UI v2 | [#13](https://github.com/harshsinghmp/musememory/issues/13) |

</details>

---

## 📜 License

MIT License. Built for the AI Developer Ecosystem.