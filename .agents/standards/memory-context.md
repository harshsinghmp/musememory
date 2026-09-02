# 🧠 Context, Memory & Identity Protocol

## 1. Context Hygiene Protocol

At the start of every response, output: `[Context: ~X% used]`

### Thresholds
- **0% to 30%**: Fresh context
- **30% to 60%**: Normal
- **60% to 80%**: Caution
- **80%+**: Danger

### Compaction Gate
Never auto-compact. When context exceeds 70%, prompt:
> *"Context at ~70%. Want me to compact now, or continue? If we compact, I will preserve the current task state."*

Before compaction, confirm:
1. High-level goal of current build spec
2. Current architecture and data flow
3. What is already implemented and considered done
4. What is explicitly not done yet
5. The next concrete task to execute

---

## 2. Persistent Cognitive Memory (`./.memory` & Muse Memory MCP)

The `./.memory` directory at the project root is the local persistent memory store for agents and context.

### Session Lifecycle
1. **Session Start**: Retrieve active profile (`USER.md`) and hard constraints (`CURRENT.md`) via `get_context()` before answering or modifying code.
2. **Active Constraints**: Record new invariants, constraints, or open loops immediately via `memory_capture(type="constraint")`.
3. **Durable Knowledge**: Capture atomic memory units for non-trivial bug resolutions, architecture decisions, and operational patterns.
4. **Supersession**: When replacing outdated patterns or obsolete rules, call `memory_supersede()` so future sessions never hallucinate deprecated methods.
5. **Session Wrap-Up**: Ensure `./.memory` reflects any newly established context or session decisions.

---

## 3. Creed Native Context & Canonical LifeOS Sources

When available on the system, agents reference these canonical LifeOS sources:

1. `~/.config/LIFEOS/USER/PRINCIPAL/PRINCIPAL_IDENTITY.md` — Stable principal identity and preferences.
2. `~/.config/LIFEOS/USER/DIGITAL_ASSISTANT/DA_IDENTITY.md` — Muse and Agency Council roles, routing, and gates.
3. `~/.config/LIFEOS/USER/TELOS/PRINCIPAL_TELOS.md` — Mission, goals, strategies, and challenges.
4. `~/.config/LIFEOS/USER/CONFIG/OPERATIONAL_RULES.md` — Principal-specific operating rules.
5. `~/.config/LIFEOS/USER/PROJECTS.md` — Project routing and aliases.

### Durable-Memory Proposal Format
When a durable fact, preference, constraint, or recurring pattern is learned, propose a narrow Markdown diff:

```md
Proposed update: [one narrow change]
Target: [canonical file and section]
Reason: [why this is durable and behavior-changing]
Evidence: [user statement, file, command, test, or authoritative source]
Approval: pending human review
```

*Direct edits to identity, health, values, or authorization boundaries require explicit human review.*
