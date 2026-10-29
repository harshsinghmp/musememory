---
name: muse-current
description: Active working constraints and interruption-proof session handoff manager. Synchronizes hard invariants, open loops, and in-flight checkpoints directly into CURRENT.md.
---

# 📐 Muse Current (`muse-current`)

> **When to use**: Execute when the user establishes a hard project invariant, when starting a multi-step task, before context compaction/task switching, or when running multiple concurrent agents to record in-flight workstreams and prevent collisions.

---

## 🏛️ Operational Guidelines: Humans vs AI Agents

| Persona | Purpose & Guidelines |
| :--- | :--- |
| **For Humans (Founders & Architects)** | Single-pane-of-glass executive dashboard of active project invariants, active handoffs, and active concurrent agent workstreams. **Strictly zero verbose logs, raw terminal dumps, or transcript noise.** |
| **For AI Agents (Agency Council & Subagents)** | Mandatory grounding contract. Every agent must check `CURRENT.md` at session start (`get_context`) to respect active constraints, register its active task, and check what other parallel agents are modifying to avoid merge conflicts and race conditions. |

---

## 🤖 Concurrent Multi-Agent Coordination Protocol

When multiple agents run simultaneously across different IDE windows or chat sessions, each agent registers its active scope in `CURRENT.md`:

```markdown
## 🤖 Active Concurrent Agent Workstreams
| Agent / Session ID | Status | Active Task | Target Scope / Files | Last Active |
| :--- | :--- | :--- | :--- | :--- |
| `Agent-Sol` | [IN-PROGRESS] | Next.js API Rate Limiter | `src/api/rate-limit.ts` | 2026-09-03T08:50:00.000Z |
| `Agent-Nexus` | [IN-PROGRESS] | SQLite WAL Hardening | `src/sqlite.ts` | 2026-09-03T08:51:00.000Z |
```

### Protocol Rules for Concurrent Agents:
1. **Pre-flight Scope Audit**: Before editing files, inspect `## 🤖 Active Concurrent Agent Workstreams`. If another agent is actively modifying your target files, coordinate or isolate your work to avoid overwriting changes.
2. **Workstream Registration**: On starting a multi-turn task, register your agent name, task title, and target file scope.
3. **Automatic Handoff Sync**: When updating session progress via `checkpointSession` or `updateSessionHandoff`, your workstream row is automatically updated with your latest checkpoint timestamp.
4. **Task Completion**: Upon finishing the task, mark your workstream `COMPLETED`. Completed entries are automatically pruned after 48 hours.

---

## 🚀 Execution Workflow

### Step 1: Record Hard Constraints
When a non-negotiable rule or invariant is declared:
Call `memory_current` or `memory_capture(type="constraint")`:

```json
{
  "action": "append",
  "text": "- Invariant: Never allow cross-origin POST mutations without Origin header check (CSRF defense)."
}
```

This immediately updates `.memory/CURRENT.md` and dual-persists a constraint memory in SQLite.

### Step 2: Register & Checkpoint In-Flight Workstreams
When starting a task or checkpointing progress:
```json
{
  "action": "checkpoint",
  "agent": "Sol",
  "task": "Build OAuth2 Callback Handler",
  "targetScope": "src/auth/*",
  "progress": ["Added callback route", "Verified state nonce validation"]
}
```

### Step 3: Clear Resolved Invariants & Prune Obsolete Rules
When a temporary constraint or migration phase is complete, update `CURRENT.md` to prune obsolete rules so future context windows stay lightweight.

---

## 🛡️ Invariant Rules for Agents

- **High Locality**: `CURRENT.md` must contain only active, high-priority invariants, concurrent workstreams, and current handoffs—never historical terminal transcripts.
- **Zero Hallucination**: Do not contradict constraints recorded in `CURRENT.md`.
- **Zero File Collisions**: Always consult the active workstreams table before modifying shared codebase modules.

---

## 💻 CLI Equivalents (Zero-MCP Fallback)

```bash
# Read active working constraints & concurrent workstreams
memory current get

# Append a new active constraint
memory current set "- Hard constraint description" --project my-project

# Run storage optimization (prunes test noise, junk fragments & defragments SQLite)
memory optimize
```
