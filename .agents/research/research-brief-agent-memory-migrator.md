# Research Brief: Autonomous Multi-Provider Agent Memory Migrator & State Preservation Architecture

**Depth**: deep  
**Date**: 2026-08-22  
**Target Repository**: `harshsinghmp/musememory`  
**Primary Deliverable**: Interactive Dashboard at [`musemeory-comparison.html`](file:///home/harsh/Projects/musememory/musemeory-comparison.html) & Autonomous First-Install Migrator

---

## 1. Executive Summary

Autonomous AI coding agents (Claude Code, Cursor, Antigravity, Windsurf, Codex, Gemini CLI) frequently experience fragmented context across sessions. While over 24 different memory engines, graph RAG platforms, and agent harnesses have emerged, they suffer from four critical architectural liabilities:
1. **Infrastructure Bloat**: Heavy dependencies on external vector databases (Milvus, Qdrant, Chroma, Neo4j, LanceDB) or background daemon processes (Rust, Python).
2. **Zero-Leakage Security Vulnerabilities**: Lack of inline secret/credential interception before disk or cloud persistence.
3. **Context Window Flooding**: Retrieval based on unbounded Top-$K$ dumps rather than exact prompt token knapsack budgeting.
4. **Scope Contamination**: Shared global state without clean per-repository workspace isolation (`.memory/`).

**Muse Memory** solves these issues with a zero-dependency, pure TypeScript, dual-scoped (`.memory/` vs `~/.memory/`), atomic YAML/JSONL architecture with inline **Vibeguard** credential interception and exact **Token Budgeting**.

This research brief defines the **Autonomous First-Install Migrator** (`memory migrate` / `memory init --auto-import`) capable of auto-detecting and ingesting memories across all 24 popular providers while strictly preserving active vs. archived/superseded state hierarchies and workspace isolation.

---

## 2. Comprehensive 24-Provider Landscape & Feature Comparison

| # | Provider / System | Storage Backend | Scoping Model | Active vs. Archive Mapping | Secret Protection | Token Budgeting | Permission-Free Auto-Wiring | Offline / Air-Gapped |
|---|---|---|---|---|---|---|---|---|
| **★** | **🧠 Muse Memory** | Atomic YAML + JSONL Ledger | Dual (`.memory/` + `~/.memory/`) | `confirmed` / `superseded` / `CURRENT.md` | ✅ **Vibeguard Inline** | ✅ **Exact Knapsack** | ✅ **1-Click Auto-Approve** | ✅ **100% Standalone** |
| 1 | **Supermemory** | Temporal Vector-Graph (SQLite / Cloudflare KV) | Global Spaces + Tags | `is_archived: false` ➔ `confirmed`, `true` ➔ `superseded` | ⚠️ Basic | ❌ Unbounded Top-K | ⚠️ Manual API | ⚠️ Hybrid Cloud |
| 2 | **Cognee** | Graph RAG (LanceDB / Kuzu / Neo4j / SQLite) | Global Dataset Namespaces | Pruned/Deprecated Edges ➔ `superseded` | ❌ None | ⚠️ Chunk Limits | ⚠️ Python Lib | ✅ Self-Hostable |
| 3 | **Beads** | Git JSON Issue Beads (`.beads/`) | Local Workspace Only | `open/in_progress` ➔ `CURRENT.md`, `closed` ➔ `superseded` | ❌ None | ❌ Full Bead Dump | ⚠️ CLI Init | ✅ 100% Local |
| 4 | **Memori** | SQLite / Postgres Episodic Graph | Global with Session IDs | `active` ➔ `confirmed`, `decayed` ➔ `stale/superseded` | ❌ None | ⚠️ Top-K Items | ⚠️ Middleware | ✅ Local SQLite |
| 5 | **memU** | Hierarchical 3-Layer FS (Item/Category) | Global Categories + Local | `working_memory` ➔ `CURRENT.md`, `archival` ➔ `superseded` | ⚠️ Basic | ⚠️ Category Limit | ⚠️ Manual | ✅ Local Files |
| 6 | **EverOS** | Markdown Files + LanceDB / SQLite | Dual (`.everos/` + `~/.everos/`) | `active` ➔ `confirmed`, `archived` ➔ `superseded` | ⚠️ Basic | ⚠️ BM25 + Top-K | ⚠️ Manual Config | ✅ 100% Local |
| 7 | **Semantica** | Graph Triples & Reasoning Ledger | Global Graph + Project Tags | `valid_until: null` ➔ `confirmed`, `invalid` ➔ `superseded` | ❌ None | ⚠️ Graph Depth | ⚠️ Manual API | ✅ Self-Hosted |
| 8 | **Honcho** | Dialectic Metamodels (Postgres/SQLite) | Global User/Agent Dialectics | `current_representation` ➔ `confirmed`, `history` ➔ `superseded` | ❌ None | ✅ Reasoned Compression | ⚠️ MCP/SDK | ✅ Local Server |
| 9 | **Kungfu** | Local Checkpoint Ledger (`.kungfu/`) | Local Workspace | `current_task` ➔ `CURRENT.md`, `completed` ➔ `confirmed` | ❌ None | ❌ Full Checkpoint Dump | ⚠️ CLI Init | ✅ 100% Local |
| 10 | **Letta Code** | Core Memory + Archival SQLite | Global Agent Identity | `core_memory` ➔ `CURRENT.md`, `archival` ➔ `confirmed/superseded` | ❌ None | ⚠️ Fixed Char Blocks | ⚠️ Agent Server | ✅ Local Docker/Server |
| 11 | **MemSearch** | 3-Tier Markdown + Milvus Vector Store | Global Vector Index | `tier: summary` ➔ `confirmed`, `transcript` ➔ `session` | ❌ None | ⚠️ Layer Selection | ⚠️ Python API | ⚠️ Requires Milvus |
| 12 | **ACE (Kayba)** | AST Token Compression & Playbooks | Workspace Playbooks | `active_strategy` ➔ `confirmed`, `refuted` ➔ `rejected` | ❌ None | ✅ AST Token Budget | ⚠️ MCP Bridge | ✅ Local Engine |
| 13 | **Actx0** | Cloud API Session History & Cache | Cloud API Tenant | `active_session` ➔ `confirmed`, `expired` ➔ `stale` | ⚠️ Cloud Managed | ✅ Dynamic Prompt Cache | ⚠️ API Key | ❌ Cloud Only |
| 14 | **ByteRover** | Markdown Context Tree (Domain/Topic) | Local Workspace | `live` ➔ `confirmed`, `archived` ➔ `superseded` | ❌ None | ⚠️ Subtree Pruning | ⚠️ CLI Init | ✅ 100% Local |
| 15 | **Clawdi** | Cloud VM Shared State & Persistent Files | Cloud Agent Fleet | `pinned_rules` ➔ `CURRENT.md`, `history` ➔ `confirmed` | ℹ️ TEE Encrypted | ❌ Unbounded Dump | ⚠️ Cloud Auth | ❌ Cloud Only |
| 16 | **Pensieve** | Enterprise Knowledge Graph | Global Enterprise Vault | `active` ➔ `confirmed`, `obsolete` ➔ `superseded` | ⚠️ RBAC | ⚠️ Subgraph Limit | ⚠️ Enterprise | ⚠️ Hybrid |
| 17 | **Liminary** | AI-Native Semantic Document Layer | Corpus Workspaces | `active_cluster` ➔ `confirmed`, `archived` ➔ `superseded` | ⚠️ Cloud Encrypted | ⚠️ Chunk Top-K | ⚠️ API Key | ❌ Cloud Only |
| 18 | **Dvina** | Cross-App Dynamic Vector Sync | Multi-App Global | `focus_context` ➔ `CURRENT.md`, `history` ➔ `confirmed/superseded`| ⚠️ OAuth | ⚠️ App Scoped | ⚠️ OAuth Setup | ❌ Cloud SaaS |
| 19 | **Mem0** | Scoped Vector + Graph Store (Qdrant) | Global with `user_id`/`agent_id` | `is_active: true` ➔ `confirmed`, `deleted` ➔ `superseded` | ❌ None | ❌ Unbounded Top-K | ⚠️ Python/MCP | ✅ Local SQLite Mode |
| 20 | **Second Brain** | Cloudflare Workers + D1 + Obsidian | Global Obsidian Vault | `tags: [active]` ➔ `confirmed`, `tags: [archive]` ➔ `superseded` | ❌ None | ⚠️ Vector Top-K | ⚠️ Worker Setup | ⚠️ Cloudflare Edge |
| 21 | **Rory Plans** | Agentic Work Execution & Task Plans | Workspace Plans | `in_progress` ➔ `CURRENT.md`, `completed` ➔ `confirmed` | ⚠️ Workspace ACL | ❌ Full Plan Dump | ⚠️ Web Portal | ❌ Cloud Only |
| 22 | **Minimi** | Ambient Desktop Context & Open Loops | Desktop User-Wide | `open_loops` ➔ `CURRENT.md`, `resolved` ➔ `confirmed` | ⚠️ Sandbox | ⚠️ Active Loop Limit | ⚠️ Mac Helper | ✅ 100% Local (macOS) |
| 23 | **Mem.ai** | AI-First Associative Note Graph | Global User Notes | `is_archived: false` ➔ `confirmed`, `true` ➔ `superseded` | ⚠️ SOC2 / Cloud | ❌ Cloud Search Dump | ⚠️ OAuth Sync | ❌ Cloud SaaS |
| 24 | **AgentMemory** | Rust `iii-engine` + SQLite State Store | Global (`~/.local/share/agentmemory`)| `crystal/lesson` ➔ `confirmed`, `superseded` ➔ `superseded` | ❌ None (Raw SQL) | ❌ Unbounded SQL | ⚠️ Daemon Required | ✅ Local Binary |

---

## 3. Structural Preservation & State Transition Rules

When migrating memories from external providers into Muse Memory, the migrator executes strict deterministic state preservation:

```
┌────────────────────────────────────────────────────────┐
│               Source Provider Memory State             │
└──────────────────────────┬─────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
   [Live / Active]    [Deprecated]     [Active Loops]
   [Confirmed / Open] [Archived]       [Human / Core]
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────────┐┌─────────────────┐┌─────────────────┐
│ status: confirmed││status: superseded││ CURRENT.md      │
│ (or active)     ││ (or stale)      ││ (Hard Pin)      │
└─────────────────┘└─────────────────┘└─────────────────┘
```

1. **Active / Valid Knowledge**:
   - Mapped to `status: confirmed` (or `status: active`).
   - If tagged with verification metadata, mapped to `verification: { level: "independently-verified", verified_by: "migrator" }`.
2. **Archived / Deprecated / Superseded Knowledge**:
   - Mapped to `status: superseded` (or `status: stale`).
   - Retains historical links and deprecation reason (e.g. `reason: "Imported as archived from <provider>"`).
3. **Core Persona / Open Loops / In-Progress Tasks**:
   - Appended directly to `.memory/CURRENT.md` (or `~/.memory/CURRENT.md`) as active working constraints.
4. **Scope Isolation**:
   - Workspace-specific providers (Beads, Kungfu, ByteRover, local `.everos/`) ➔ Imported to `.memory/` in the active repository.
   - User-wide providers (Mem0, Letta, Supermemory, AgentMemory) ➔ Imported to `~/.memory/` globally.
5. **Zero-Leakage Interception**:
   - All extracted memory texts pass through `scanSecrets(text)` before write. If credentials are detected, the payload is either redacted or blocked with an audit warning.

---

## 4. Autonomous Migrator Architecture & Engine Design

### Pipeline Modules

```
musememory/
├── src/
│   ├── migrator/
│   │   ├── types.ts          # Migrator interfaces & provider signatures
│   │   ├── detect.ts         # Fast scanner detecting active providers
│   │   ├── engine.ts         # Ingestion pipeline & Vibeguard sanitizer
│   │   └── adapters/
│   │       ├── sqlite.ts     # Generic SQLite reader (AgentMemory, Mem0, Memori)
│   │       ├── markdown.ts   # Markdown parser (ByteRover, EverOS, Beads, SecondBrain)
│   │       ├── json.ts       # Structured JSON parser (Letta, Kungfu, ACE, Minimi)
│   │       └── logs.ts       # Log & session transcript extractor (Supermemory)
```

### Detection Heuristics Table

```typescript
export const PROVIDER_DETECTORS = [
  {
    id: "agentmemory",
    name: "AgentMemory",
    paths: [
      "~/.local/share/agentmemory/state_store.db",
      "~/.agentmemory/standalone.json"
    ],
    adapter: "agentmemory"
  },
  {
    id: "supermemory",
    name: "Supermemory",
    paths: [
      "~/.supermemory",
      "~/.opencode-supermemory.log"
    ],
    adapter: "supermemory"
  },
  {
    id: "beads",
    name: "Beads",
    paths: [
      ".beads/beads.json",
      ".beads"
    ],
    adapter: "beads",
    scope: "local"
  },
  {
    id: "mem0",
    name: "Mem0",
    paths: [
      "~/.mem0/mem0.db",
      ".mem0/mem0.json"
    ],
    adapter: "mem0"
  },
  {
    id: "letta",
    name: "Letta Code / MemGPT",
    paths: [
      "~/.letta",
      "~/.memgpt",
      ".letta"
    ],
    adapter: "letta"
  },
  {
    id: "everos",
    name: "EverOS",
    paths: [
      ".everos/memories",
      "~/.everos"
    ],
    adapter: "everos"
  },
  {
    id: "byterover",
    name: "ByteRover",
    paths: [
      ".byterover",
      "~/.byterover"
    ],
    adapter: "byterover",
    scope: "local"
  },
  {
    id: "kungfu",
    name: "Kungfu",
    paths: [
      ".kungfu/checkpoints",
      "~/.kungfu"
    ],
    adapter: "kungfu",
    scope: "local"
  },
  {
    id: "minimi",
    name: "Project Minimi",
    paths: [
      "~/Library/Application Support/Minimi",
      "~/.minimi"
    ],
    adapter: "minimi"
  }
];
```

---

## 5. Implementation Phases & Roadmap

- **Phase 2.1: Migrator Detection & Adapter Engine**:
  - Implement `src/migrator/detect.ts` to scan local workspace and home directories.
  - Implement adapters for SQLite, Markdown trees, JSON dumps, and JSONL transcripts.
- **Phase 2.2: First-Install Auto-Detection Hook**:
  - In `src/cli.ts` (`memory init` & `memory connect`), detect existing providers and offer 1-command migration (`memory migrate --all`).
- **Phase 2.3: State Preservation & Audit Integration**:
  - Map active, archived, and working constraints accurately.
  - Log audit events in `.memory/audit.jsonl` with `operation: "import"` / `operation: "migration"`.
- **Phase 2.4: Verification & Automated Test Suites**:
  - End-to-end tests for multi-provider import and secret redaction.

---

## 6. Sources & References

1. Supermemory: `https://github.com/supermemoryai/supermemory`
2. Cognee: `https://github.com/topoteretes/cognee`
3. Beads: `https://github.com/gastownhall/beads`
4. Memori: `https://github.com/MemoriLabs/Memori`
5. memU: `https://github.com/NevaMind-AI/memU`
6. EverOS: `https://github.com/EverMind-AI/EverOS`
7. Semantica: `https://github.com/semantica-agi/semantica`
8. Honcho: `https://github.com/plastic-labs/honcho`
9. Kungfu: `https://github.com/kungfu-systems/kungfu`
10. Letta Code: `https://github.com/letta-ai/letta-code`
11. MemSearch: `https://github.com/zilliztech/memsearch`
12. ACE: `https://github.com/kayba-ai/agentic-context-engine`
13. Actx0: `https://actx0.com/`
14. ByteRover: `https://www.byterover.dev/`
15. Clawdi: `https://www.clawdi.ai/`
16. Pensieve: `https://pensieve.uk/`
17. Liminary: `https://liminary.io/`
18. Dvina: `https://dvina.ai/`
19. Mem0: `https://mem0.ai/`
20. Second Brain Cloudflare: `https://github.com/rahilp/second-brain-cloudflare`
21. Rory Plans: `https://www.roryplans.ai/`
22. Project Minimi: `https://www.projectminimi.com/`
23. Mem.ai: `https://get.mem.ai/`
24. AgentMemory: `https://github.com/rohitg00/agentmemory`
