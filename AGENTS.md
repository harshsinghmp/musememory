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
5. **Universal English Standard**: All agent responses, code, comments, commits, specs, and docs MUST strictly be in English.
6. **Evidence Before Claims**: Work is complete only after independent oracle verification (`bun test` passes, build succeeds, types check clean).
7. **Structured Commits**: Commits must follow `<type>(<scope>): <summary>` with Why/What/Verification blocks.
8. **Agent Containment & Archive**: All agent artifacts live in `./.agents/*`. Retired plans move to `./.agents/archive/[title]-[timestamp].md`.
9. **Session Memory & Closeout DOX Pass**: Update `./.agents/context/current.md` and this `AGENTS.md` before completing tasks. **Never touch `./.memory/**`** — it is owned by the MuseMemory engine.

---

## 📚 Standards & Detailed Protocols (Progressive Disclosure)

Load on demand. Full index (incl. retained-but-inapplicable standards): [Standards Index](./.agents/standards/README.md).

### 🌐 Universal Core Standards (All Frameworks)
- ⚙️ [Execution & Cognitive Kernel](./.agents/standards/execution-kernel.md) — 6 Judgment laws, Fowler Refactoring, McConnell Code Complete, byte-capping.
- 🛡️ [Security & Vibeguard Protocol](./.agents/standards/security-vibeguard.md) — Secret isolation, Destructive Command Gate, Untrusted Tool Output defense.
- 📐 [System, Domain & Resilience Design](./.agents/standards/system-design.md) — Evans DDD, Nygard Release It! stability, migration rehearsal, schemas.
- 🔄 [Development Workflows & Gates](./.agents/standards/workflows.md) — Scaled tiers, 5-phase pipeline, PR-per-feature + post-merge pipeline.
- 📜 [Git Branching, Commits & SemVer](./.agents/standards/git-workflow.md) — Branch lifecycle, commit standards, SemVer.
- 📑 [DOX Hierarchy & Subtree Contracts](./.agents/standards/dox-hierarchy.md) — Reading order, child doc shape, closeout checklist, pruning loop.
- 🎭 [Council Roles & Routing](./.agents/standards/council-roles.md) — Muse, Sol, Jasper, Crew, Nexus responsibilities and subagent dispatch policy.
- 🧠 [Context, Memory & Identity](./.agents/standards/memory-context.md) — Context hygiene, `./.memory` store lifecycle, Creed proposals, LifeOS sources.

### 🎨 Brand Identity, UI & Accessibility System
- 🎨 [Design System & UI Standards](./.agents/brand/design.md) — Token architecture, 7 required UI component states, fluid typography.
- 📐 [Semantic BEM CSS Conventions](./.agents/brand/bem-conventions.md) — Block-Element-Modifier architecture and shallow depth rules.
- ♿ [Accessibility (A11y) Baseline](./.agents/brand/a11y.md) — WCAG 2.2 AA mandates, contrast ratios, hit targets, axe-core zero-tolerance.
- 📸 [Reference Screenshots & Mocks](./.agents/brand/screenshots/README.md) — UI screenshots, wireframes, design snapshots.
- 🌐 [Astro Frontend Standards](./.agents/standards/frontend-astro.md) — `apps/website` stack, the `/musememory` base-path rule, generated assets, a11y/visual gates.

### 📖 Durable Muse Memory Context
- 📖 [Context Map](./.agents/context/index.md) — Navigation index for durable truth. · 📦 [Product Scope](./.agents/context/product.md) — Live MCP tool matrix, 7 profiles, CLI surface, trust gates.
- 🏗️ [Architecture & Storage](./.agents/context/architecture.md) — Dual-scope engine, SQLite DB, retrieval scoring, repo layout. · 📍 [Current State](./.agents/context/current.md) — v3.0.0 status, active invariants.
- 🏛️ [Locked Decisions](./.agents/context/decisions.md) — ADRs (zero-daemon, dual persistence, MCP stdio). · 🗺️ [Roadmap](./.agents/context/roadmap.md) — Active roadmap and milestones.
- 🤖 [Agent Reference](./docs/agent-reference.md) — Machine-facing contract: install, layout, session protocol, trust gates, failure semantics.
- 🔌 [CLI & MCP Reference](./docs/cli-reference.md) — **Generated** from `src/`; never hand-edit. `mcp-tool-matrix.json` and `claims.json` likewise.
