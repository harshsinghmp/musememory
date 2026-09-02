# 📦 Muse Memory Product Scope & Capabilities

> **Binary Names**: `memory` (primary), `musememory` (alias), `npx musememory` (zero-install)  
> **MCP Protocol**: MCP 2024-11-05 (stdio transport)  
> **Runtime**: Bun / TypeScript (Node-compatible bundle)

---

## 🎯 Executive Overview

Muse Memory is a zero-daemon, file-backed cognitive memory engine designed to give AI agents (Claude Code, Cursor, Antigravity, Windsurf, Codex, Gemini CLI, Hermes, OpenCode, OpenClaw, etc.) persistent, self-organizing memory across sessions without external database daemons or cloud servers.

---

## 🔌 Comprehensive MCP Tool Matrix

### 🎯 Flagship Orchestration & Intelligence Tools
| MCP Tool | Execution Phase | Agent Purpose |
| :--- | :--- | :--- |
| `muse_context` | **Flagship Orchestration** | Unified context fusion: single-call query combining search, active file, symbol, error messages, and task intent under strict knapsack token budgets. |
| `muse_health` | **Quality Gate** | 5-Pillar Project Health Gate: single-call audit of store integrity, code anchors, doc/code alignment, anti-pattern sentry, and technical debt with A-F grading and PASS/WARN/FAIL status. |
| `muse_why` | **Cognition / "Why" Reasoner** | Traces code evolution backwards through past bug fixes, ADRs, trade-offs, and invariants to explain *why* code is designed the way it is before refactoring. |
| `muse_bug_clusters` | **Fragility Hotspots** | Clusters recurring bugs into 5 root-cause categories with subsystem fragility scoring. |
| `muse_tech_debt` | **Technical Debt Registry** | Scans code and memory for TODO/FIXME markers, unsafe `as any` casts, and drifted anchors with remediation advice. |
| `muse_memory_for_code`| **Code-to-Memory** | Queries all memories, ADRs, constraints, and bugs associated with a code file and symbol. |
| `muse_code_for_memory`| **Memory-to-Code** | Resolves all native code anchors and affected source files for a given memory entry. |
| `memory_adr_record` | **Architecture Decisions**| Records first-class ADRs with drivers, decision, consequences, options considered, and native code anchors. |
| `memory_adr_list` | **ADR Discovery** | Lists architecture decision records filtered by status (`proposed`, `accepted`, `superseded`, `rejected`). |
| `memory_drift_audit` | **Drift Detection** | Bi-directional documentation $\longleftrightarrow$ code drift engine across 6 alignment states. |
| `memory_capture_negative` | **Negative Sentry** | Records failed approaches, anti-patterns, and reproduction commands to prevent repeating mistakes. |
| `memory_promote_scope` | **Scoped Promotion** | Promotes memory along 3-tier ladder (`local` $\rightarrow$ `project` $\rightarrow$ `global`) with 5× repeated success policy and universal generalization. |
| `memory_archive` / `rehydrate` | **Archival Lifecycle** | Evaluates and manages `active` $\rightarrow$ `cold` $\rightarrow$ `dormant` $\rightarrow$ `archived` lifecycle with query rehydration. |
| `anchor_create` / `verify` / `audit` | **Code Identity** | Creates, verifies, and audits line-independent structural code anchors. |

### 🛠️ Core Memory & Lifecycle Tools
| MCP Tool | Execution Phase | Agent Purpose |
| :--- | :--- | :--- |
| `get_context` | **Session Start / Init** | Fast token-budgeted prompt context injection: retrieves `USER.md`, active `CURRENT.md` constraints, and top-$K$ scored memories. |
| `memory_capture` | **Learning / Task End** | Capture new durable facts, verified architectural decisions, operational rules, or bug resolutions directly into memory. |
| `memory_propose` | **Speculative Learning** | Propose a candidate memory requiring confirmation before permanent indexing. |
| `memory_confirm` | **Validation Phase** | Promote a `candidate` or `disputed` memory to `confirmed` status. |
| `memory_supersede` | **Refactoring / Updates** | Formally link an obsolete memory to a newer confirmed memory so agents never hallucinate deprecated patterns. |
| `memory_search` | **Targeted Lookups** | Query the SQLite store and YAML mirrors using multi-factor similarity matching and tags. |
| `memory_conflicts` | **Conflict Audit** | Lists conflicting memories detected by the semantic contradiction engine. |
| `memory_resolve_conflict` | **Conflict Resolution**| Resolves contradictions via `supersede`, `historical`, `reject`, or `keep_both`. |
| `memory_roi` | **Utility & ROI** | Computes memory reuse metrics, application success rates, and regression penalties. |
| `memory_search_transcripts` | **Historical Archaeology** | Full-text dialogue search across past JSONL conversation transcripts with conversation bookends. |
| `memory_audit` | **Compliance Check** | Inspect the append-only operational ledger (`.memory/audit.jsonl`). |
| `profile_list` / `switch` | **Tool Management** | Lists and activates task-focused MCP profiles to eliminate agent tool bloat. |

---

## ⚙️ Task-Focused MCP Profiles

Muse Memory prevents agent context bloat by providing 6 pre-configured tool profiles:

- **`core`** (Minimal): `get_context`, `memory_search`, `memory_capture`, `memory_current`, `profile_list`, `profile_switch`.
- **`coding`**: Core tools + `muse_context`, `muse_why`, `muse_code_for_memory`, `muse_memory_for_code`, `anchor_*`.
- **`debugging`**: Core tools + `muse_why`, `muse_bug_clusters`, `memory_capture_negative`, `memory_verify`.
- **`review`**: Core tools + `muse_health`, `muse_tech_debt`, `memory_drift_audit`, `anchor_audit`.
- **`architecture`**: Core tools + `muse_context`, `muse_health`, `memory_adr_*`, `memory_drift_audit`, `muse_why`.
- **`maintenance`**: Core tools + `muse_health`, `memory_promote_scope`, `memory_archive`, `memory_archive_sweep`, `memory_lifecycle_stats`.
- **`full`**: Unrestricted exposure of all 61 MCP tools.

---

## 💻 CLI Command Surface

```bash
# Health & Observability (5-Pillar Quality Gate)
memory health [--json] [--global]

# Retrieval & Context
memory context [--query "..."] [--budget 2000] [--tier 0|1|2]
memory search "<query>" [--tags arch,auth]
memory recall "<id>"

# Knowledge Lifecycle
memory capture --title "..." --type architecture --content "..."
memory propose --title "..." --content "..."
memory confirm <id>
memory supersede <old-id> <new-id>
memory stale <id>
memory audit [--limit 20]

# Personas & Constraints
memory persona [developer|designer|marketer|casual]
memory current --add "Must use Bun v1.2"

# Diagnostics & Server
memory doctor
memory validate --dry-run
memory mcp [--profile coding|review|architecture|core|full]
```
