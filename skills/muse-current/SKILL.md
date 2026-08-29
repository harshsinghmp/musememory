---
name: muse-current
description: Active working constraints and interruption-proof session handoff manager. Synchronizes hard invariants, open loops, and in-flight checkpoints directly into CURRENT.md.
---

# 📐 Muse Current (`muse-current`)

> **When to use**: Execute when the user establishes a hard project invariant, when starting a multi-step task, or before context compaction/task switching to record in-flight handoffs.

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

### Step 2: Record Interruption-Proof Session Handoffs
When completing a subtask, hitting context limits, or preparing for the next agent:
Append a structured handoff block to `CURRENT.md`:

```markdown
## Active Handoff & Session Checkpoint
- **Goal**: Migrate SQLite WAL connection pool to asynchronous microtask flushes.
- **Completed**:
  - Implemented async query worker in `src/sqlite/worker.ts`.
  - Added unit test suite `test/sqlite_worker.test.ts`.
- **In-Flight / Next Steps**:
  - Wire worker into `src/store.ts` save transaction.
  - Run full suite: `bun test`.
```

### Step 3: Clear Resolved Invariants
When a temporary constraint or migration phase is complete, update `CURRENT.md` to prune obsolete rules so future context windows stay lightweight.

---

## 🛡️ Invariant Rules for Agents

- **High Locality**: `CURRENT.md` must contain only active, high-priority invariants and current handoffs—not historical archives.
- **Zero Hallucination**: Do not contradict constraints recorded in `CURRENT.md`.

---

## 💻 CLI Equivalents (Zero-MCP Fallback)

```bash
# Read active working constraints
memory current get

# Append a new active constraint
memory current set "- Hard constraint description" --project my-project
```
