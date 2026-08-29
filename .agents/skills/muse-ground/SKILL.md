---
name: muse-ground
description: Pre-flight context and invariant grounding for AI coding agents. Retrieves Top-K relevant memories, active USER.md persona, and CURRENT.md working constraints at the start of any session or major task.
---

# 🎯 Muse Ground (`muse-ground`)

> **When to use**: Execute at the start of every session, task initiation, or context switch before proposing code changes, creating plans, or executing refactors.

---

## 🚀 Execution Workflow

### Step 1: Query Context & Constraints
Call the `get_context` MCP tool (or run `memory context "<query>"`) using your current task objective or keyword domain:

```json
{
  "query": "authentication JWT expiration and database pool configuration",
  "project": "my-project",
  "token_budget": 2000
}
```

### Step 2: Ingest Three-Tier Grounding Hierarchy
The grounding response deterministically packages 3 critical layers in strict priority order:

1. **`### User Profile & Preferences (USER.md)`**:
   - Understand the user's role (`developer`, `designer`, `marketer`, `casual`, `custom`).
   - Ground in explicit communication rules (e.g. terse output, runnable diffs, fail-fast mechanics).

2. **`### Active Working Constraints (CURRENT.md)`**:
   - Inspect immutable hard invariants (e.g. "Never commit secrets", "Preserve v1 backward compatibility").
   - Review active session handoffs and in-flight checkpoints from previous agents.

3. **`### Relevant Memories & Learned Patterns (Top-K)`**:
   - Review past architectural decisions (`type: architecture`).
   - Review previously solved edge-case bug fixes (`type: fix`).
   - Avoid re-introducing known antipatterns or rejected hypotheses (`type: failure` / `status: rejected`).

---

## 🛡️ Invariant Rules for Agents

- **Read Before Mutating**: Never edit code without first checking `CURRENT.md` and active constraints.
- **Fail Fast on Missing Context**: If `get_context` reveals a conflicting historical decision, escalate or verify rather than blindly overriding.
- **Tone Alignment**: Strictly mirror the persona defined in `USER.md`.

---

## 💻 CLI Equivalents (Zero-MCP Fallback)

```bash
# Retrieve top-ranked prompt context
memory context "query terms" --token-budget 2000

# Inspect active working constraints directly
memory current get

# Inspect active user persona profile
memory user get
```
