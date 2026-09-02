# 📦 Muse Memory Product Scope & Capabilities

> **Binary Names**: `memory` (primary), `musememory` (alias), `npx musememory` (zero-install)  
> **MCP Protocol**: MCP 2024-11-05 (stdio transport)  
> **Runtime**: Bun / TypeScript (Node-compatible bundle)

---

## 🎯 Executive Overview

Muse Memory is a zero-daemon, file-backed cognitive memory engine designed to give AI agents (Claude Code, Cursor, Antigravity, Windsurf, Codex, Gemini CLI, Hermes, OpenCode, OpenClaw, etc.) persistent, self-organizing memory across sessions without external database daemons or cloud servers.

---

## 🔌 Comprehensive MCP Tool Matrix

| MCP Tool | Execution Phase | Agent Purpose |
| :--- | :--- | :--- |
| `get_context` | **Session Start / Init** | Fast token-budgeted prompt context injection: retrieves `USER.md`, active `CURRENT.md` constraints, and top-$K$ scored memories. |
| `memory_capture` | **Learning / Task End** | Capture new durable facts, verified architectural decisions, operational rules, or bug resolutions directly into memory. |
| `memory_propose` | **Speculative Learning** | Propose a candidate memory requiring confirmation before permanent indexing. |
| `memory_confirm` | **Validation Phase** | Promote a `candidate` or `disputed` memory to `confirmed` status. |
| `memory_supersede` | **Refactoring / Updates** | Formally link an obsolete memory to a newer confirmed memory so agents never hallucinate deprecated patterns. |
| `memory_search` | **Targeted Lookups** | Query the SQLite store and YAML mirrors using multi-factor similarity matching and tags. |
| `memory_search_transcripts` | **Historical Archaeology** | Full-text dialogue search across past JSONL conversation transcripts with conversation bookends. |
| `memory_audit` | **Compliance Check** | Inspect the append-only operational ledger (`.memory/audit.jsonl`). |

---

## 💻 CLI Command Surface

```bash
# Retrieval & Context
memory context [--query "..."] [--budget 2000]
memory search "<query>" [--tags arch,auth]
memory recall "<id>"

# Knowledge Lifecycle
memory capture --title "..." --type architecture --content "..."
memory propose --title "..." --content "..."
memory confirm <id>
memory supersede <old-id> <new-id>
memory stale <id>

# Personas & Constraints
memory persona [developer|designer|marketer|casual]
memory current --add "Must use Bun v1.2"

# Diagnostics & Server
memory doctor
memory validate --dry-run
memory mcp
```
