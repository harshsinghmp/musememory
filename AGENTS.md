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
8. **Agent Containment & Archive**: All agent artifacts live in `./.agents/*`. Retired plans/scratchpads move to `./.agents/archive/[title]-[timestamp].md`.
9. **Session Memory & Closeout DOX Pass**: Update `./.memory`, `./.agents/context/current.md`, and this `AGENTS.md` before completing tasks.

---

## 📚 Standards & Detailed Protocols (Progressive Disclosure)

Load these relative modules on-demand when relevant to your active task:

### 🌐 Universal Core Standards (All Frameworks)
- ⚙️ [Execution & Cognitive Kernel](./.agents/standards/execution-kernel.md) — 6 Judgment laws, Fowler Refactoring, McConnell Code Complete, and byte-capping.
- 🛡️ [Security & Vibeguard Protocol](./.agents/standards/security-vibeguard.md) — Secret isolation, Destructive Command Gate, Untrusted Tool Output defense.
- 📐 [System, Domain & Resilience Design](./.agents/standards/system-design.md) — Evans DDD, Nygard Release It! stability, migration rehearsal, and schemas.
- 🔄 [Development Workflows & Gates](./.agents/standards/workflows.md) — Scaled tiers (tiny-fix, quick-win, feature, architecture-change) & 5-phase pipeline.
- 📜 [Git Branching, Commits & SemVer](./.agents/standards/git-workflow.md) — Branch lifecycle (`master`/`dev`/`feature`/`release`/`hotfix`), commit standards, and SemVer.
- 📑 [DOX Hierarchy & Subtree Contracts](./.agents/standards/dox-hierarchy.md) — Reading order, child doc shape, closeout checklist, and pruning loop.
- 🎭 [Council Roles & Routing](./.agents/standards/council-roles.md) — Division responsibilities (Muse, Sol, Jasper, Crew, Nexus) and subagent dispatch policies.
- 🧠 [Context, Memory & Identity](./.agents/standards/memory-context.md) — Context hygiene, `./.memory` store lifecycle, Creed durable proposals, LifeOS sources.

### 🎨 Brand Identity, UI & Accessibility System
- 🎨 [Design System & UI Standards](./.agents/brand/design.md) — Token architecture, 7 required UI component states, fluid typography.
- 📐 [Semantic BEM CSS Conventions](./.agents/brand/bem-conventions.md) — Block-Element-Modifier class architecture and shallow depth rules.
- ♿ [Accessibility (A11y) Baseline](./.agents/brand/a11y.md) — WCAG 2.2 AA non-negotiable mandates, contrast ratios, hit targets, and axe-core zero-tolerance.
- 📸 [Reference Screenshots & Mocks](./.agents/brand/screenshots/README.md) — Directory for UI screenshots, wireframes, and design snapshots.

### 📖 Durable Muse Memory Context
- 📖 [Durable Context Map](./.agents/context/index.md) — Central navigation index for Muse Memory durable truth.
- 📦 [Product Scope & Capabilities](./.agents/context/product.md) — CLI commands, binary aliases, and MCP tool matrix.
- 🏗️ [Architecture & Storage Layout](./.agents/context/architecture.md) — Dual-scope engine, SQLite DB, retrieval scoring, and repo layout.
- 📍 [Current Shipped State](./.agents/context/current.md) — v1.11.0 status, active test suites, and system invariants.
- 🏛️ [Locked Architectural Decisions](./.agents/context/decisions.md) — ADRs (zero-daemon, dual persistence, MCP stdio).
- 🗺️ [Roadmap & Backlog](./.agents/context/roadmap.md) — Active roadmap and planned milestones.
