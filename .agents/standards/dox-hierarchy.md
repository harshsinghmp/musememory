# 📑 DOX Hierarchy & Subtree Work Contracts

> **Core Contract**: Every `AGENTS.md` file is a binding work contract for its subtree. Work products, instructions, assets, and durable docs must remain understandable from the nearest applicable `AGENTS.md` plus every parent `AGENTS.md` above it.

---

## 1. Read Before Editing (The DOX Chain Walk)

Before modifying any file:
1. Read the root `AGENTS.md`.
2. Identify every file or folder you expect to touch.
3. Walk from the repository root to each target path.
4. Read every `AGENTS.md` found along each route.
5. If a parent `AGENTS.md` lists a child `AGENTS.md` whose scope contains the path, read that child and continue from there.
6. Use the nearest `AGENTS.md` as the local contract and parent docs for repo-wide rules.
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken parent DOX invariants.

*Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.*

---

## 2. Update After Editing (The Closeout DOX Pass)

Every meaningful change requires a DOX pass before the task is marked done.

Update the closest owning `AGENTS.md` when a change affects:
- Purpose, scope, ownership, or responsibilities.
- Durable structure, contracts, workflows, or operating rules.
- Required inputs, outputs, permissions, constraints, side effects, or artifacts.
- User preferences about behavior, communication, process, or quality.
- `AGENTS.md` creation, deletion, move, rename, or index contents.

### Closeout Checklist
1. Re-check changed paths against the DOX chain.
2. Update nearest owning docs and any affected parents or children.
3. Refresh every affected Child DOX Index.
4. Remove stale or contradictory text immediately.
5. Run existing verification when relevant.
6. Report any docs intentionally left unchanged and why.

---

## 3. Hierarchy & Child Doc Shape

Create a child `AGENTS.md` when a folder becomes a durable boundary with its own purpose, rules, responsibilities, or workflow.

### Default Child `AGENTS.md` Section Order
```markdown
# [Module/Subproject Name] AGENTS.md

## Purpose
[1-2 sentences on what this folder/module owns and solves]

## Ownership
[Owning Council division, team, or maintainer]

## Local Contracts
[Specific invariants, input/output schemas, or boundary rules]

## Work Guidance
[Current standards, conventions, patterns, and framework rules]

## Verification
[Concrete test commands, lint/typecheck steps, and proof expectations]

## Child DOX Index
[Links to any nested child AGENTS.md files within this subtree]
```

---

## 4. Self-Improvement & Pruning Loop

This documentation system is living. Keep it concise, operational, and honest.

After every session where an agent makes a mistake:
1. **Ask**: Was the mistake because docs lacked a rule, or because the agent ignored a rule?
2. **If lacking**: Add the rule under the owning `AGENTS.md`, written concretely (`"Always use X for Y"` not `"be careful with Y"`).
3. **If ignored**: Tighten the rule, eliminate passive phrasing, or move it higher up the DOX chain.
4. **Pruning**: Regularly delete stale notes, speculative warnings, and verbose boilerplate. Keep root `AGENTS.md` under 100 lines and child docs under 200 lines.
