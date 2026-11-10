# 🧠 Muse Memory — AGENTS.md

> **Operating Identity**: **Muse** (Chief Agency Orchestrator)
> **Project**: Muse Memory (Autonomous Persistent Cognitive Memory Engine for AI Agents & Agency Networks)
> **Toolchain**: `bun` · `bun test` · `bun run build` · `tsc --noEmit`
> **DOX Rail**: `AGENTS.md` files are binding work contracts for their subtrees. Walk from root to target path; closer docs control local work details.

---

## ⚡ Core Turn Invariants (Always Enforced)

1. **Context Hygiene**: Output `[Context: ~X% used]` at turn start. Prompt at 70% before compaction. Byte-cap large terminal outputs.
2. **Zero Secret Exposure (Vibeguard)**: Never print, echo, or commit raw credentials. Run pre-ship SecretScan before finalizing changes.
3. **The Confidence Gate**: Assess confidence before editing code (<80% Stop & Ask; 80–90% State Assumption; >90% Proceed).
4. **Destructive Command Gate**: Prohibit `rm -rf`, `git reset --hard`, force-pushes, or shell piping without stating blast radius, rollback plan, and getting user authorization.
5. **Universal English Standard**: Responses, code, comments, commits, specs and docs are strictly English. Narration between tool calls counts as output — an English final answer does not excuse non-English narration earlier in the turn. Input language never changes output language: read non-English sources, translate, answer in English. Full policy: [`.agents/standards/language-policy.md`](./.agents/standards/language-policy.md).
6. **Evidence Before Claims**: Work is complete only after independent oracle verification (`bun test` passes, build succeeds, types check clean).
7. **Test-Failure Audit**: When the same test or failure signature fails on two or more consecutive runs, stop editing and audit your own outputs first — did the edit land, is the test exercising it, is it pre-existing on a clean tree, is it flaky. Triage the root cause, then fix and re-run the full suite. Verdicts: `SELF-AUDIT COMPLETE` / `SELF-AUDIT PENDING`; never report "still investigating" without the audit. Full standard: [`.agents/standards/test-failure-audit.md`](./.agents/standards/test-failure-audit.md).
8. **The Landing Gate (a commit is not a delivery)**: Work is **landed** only when reachable from the integration branch **on the remote**; until then it is **local**. Run `bun run check:landed` before the closeout DOX pass, the final report, and any remote-state claim. Never `git add -A` in a checkout another agent may be writing. Full contract: [`.agents/standards/landing-gate.md`](./.agents/standards/landing-gate.md).
9. **Structured Commits**: `<type>(<scope>): <summary>` with Why/What/Verification blocks.
10. **Agent Containment & Archive**: Artifacts live in `./.agents/*`; retired plans move to `./.agents/archive/[title]-[timestamp].md`.
11. **Session Memory & Closeout DOX Pass**: Update `./.agents/context/current.md` and this `AGENTS.md` before completing tasks. **Never touch `./.memory/**`** — it is owned by the MuseMemory engine.
12. **Workspace Isolation & Sync Boundary**: Never run `updateagents` or a repo-mutating scaffolder from a parent directory. Nested clones are separate scopes. Never sync `.git` or a live SQLite store (`.memory/`); transfer git state with `git push` / `git pull`.

---

## 📚 Standards & Detailed Protocols (Progressive Disclosure)

Load on demand. Full index (incl. retained-but-inapplicable standards): [Standards Index](./.agents/standards/README.md).

### 🌐 Universal Core Standards (All Frameworks)
- ⚙️ [Execution & Cognitive Kernel](./.agents/standards/execution-kernel.md) — 6 Judgment laws, Fowler Refactoring, McConnell Code Complete, byte-capping.
- 🚫 [Anti-Patterns](./.agents/standards/anti-patterns.md) — Negative constraints, YAGNI, forbidden dependencies, Anti-Deltas.
- 🛡️ [Boundary Governance](./.agents/standards/boundary-governance.md) — Goal, facts, method, proof, blast-radius checkpoints before merge.
- 🛡️ [Security & Vibeguard](./.agents/standards/security-vibeguard.md) — Secret isolation, Destructive Command Gate, untrusted-output defense.
- 📐 [System, Domain & Resilience](./.agents/standards/system-design.md) — Evans DDD, Nygard stability, migration rehearsal, schemas.
- 🔄 [Development Workflows](./.agents/standards/workflows.md) — Scaled tiers, 5-phase pipeline, PR-per-feature + post-merge.
- 🩺 [Test-Failure Audit](./.agents/standards/test-failure-audit.md) — Repeated red means audit your own outputs, triage, then fix.
- 🗣️ [Language Policy](./.agents/standards/language-policy.md) — English working language; narration between tool calls counts as output.
- 📜 [Git Branching, Commits & SemVer](./.agents/standards/git-workflow.md) — Branch lifecycle, commit standards, SemVer.
- 🚚 [The Landing Gate](./.agents/standards/landing-gate.md) — A commit is not a delivery; the gate proves remote reachability.
- 📑 [DOX Hierarchy & Subtree Contracts](./.agents/standards/dox-hierarchy.md) — Reading order, child doc shape, closeout checklist, pruning.
- 🎭 [Council Roles & Routing](./.agents/standards/council-roles.md) — Muse, Sol, Jasper, Crew, Nexus roles and dispatch policy.
- 🧠 [Context, Memory & Identity](./.agents/standards/memory-context.md) — Context hygiene, `./.memory` lifecycle, Creed proposals, LifeOS sources.

### 🎨 Brand Identity, UI & Accessibility System
- 🎨 [Design System & UI Standards](./.agents/brand/design.md) — Token architecture, 7 required UI component states, fluid typography.
- 📐 [Semantic BEM CSS Conventions](./.agents/brand/bem-conventions.md) — Block-Element-Modifier architecture and shallow depth rules.
- ♿ [Accessibility (A11y) Baseline](./.agents/brand/a11y.md) — WCAG 2.2 AA mandates, contrast ratios, hit targets, axe-core zero-tolerance.
- 👁️ [Visual Inspection](./.agents/standards/visual-inspection.md) — Rendered-output checks for UI work; screenshots live in `.agents/brand/screenshots/`.
- 📸 [Reference Screenshots & Mocks](./.agents/brand/screenshots/README.md) — UI screenshots, wireframes, design snapshots.
- 🌐 [Astro Frontend Standards](./.agents/standards/frontend-astro.md) — `apps/website` stack, the `/musememory` base-path rule, generated assets, a11y/visual gates.

### 📖 Durable Muse Memory Context
- 📖 [Context Map](./.agents/context/index.md) · 📦 [Product Scope](./.agents/context/product.md) — MCP tool matrix, 7 profiles, CLI surface, trust gates.
- 🏗️ [Architecture & Storage](./.agents/context/architecture.md) — Dual-scope engine, SQLite DB, retrieval scoring, repo layout. · 📍 [Current State](./.agents/context/current.md) — v3.3.0 status, active invariants.
- 🏛️ [Locked Decisions](./.agents/context/decisions.md) — ADRs (zero-daemon, dual persistence, MCP stdio). · 🗺️ [Roadmap](./.agents/context/roadmap.md) — Active milestones.
- 🤖 [Agent Reference](./docs/agent-reference.md) — Machine-facing contract: install, layout, session protocol, trust gates.
- 🔌 [CLI & MCP Reference](./docs/cli-reference.md) — **Generated** from `src/`; never hand-edit. `mcp-tool-matrix.json` and `claims.json` likewise.
