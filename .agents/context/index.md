# 📖 Muse Memory Context Index

> **Reading Directive**: Durable project truth for Muse Memory lives in `./.agents/context/`. Start at this index, then load **only** the specific context file your active task requires.
>
> **Do not read or write `.memory/**`** — that directory is owned by the MuseMemory engine itself and is out of scope for agent context work.

---

## Context Navigation Map

| File | Scope & Contents | When to Read |
| :--- | :--- | :--- |
| [`product.md`](./product.md) | Product scope, the live MCP tool matrix, the 7 task profiles, the CLI surface, and the trust gates an agent must assume | Understanding user commands, capabilities, and MCP protocols |
| [`architecture.md`](./architecture.md) | Dual-Scope storage (`.memory/`), SQLite DB, retrieval scoring formula, and file layout | System design, file locations, state machine, and data flow |
| [`brand.md`](./brand.md) | Persona profiles (`USER.md` archetypes), voice, and presentation rules | Writing prompts, terminal output copy, and user documentation |
| [`current.md`](./current.md) | Current shipped state (**v3.0.1**), test coverage, and active constraints | Before starting work on bugs, features, or refactors |
| [`decisions.md`](./decisions.md) | Locked architectural decisions (zero-daemon, file-backed SQLite, atomic I/O) | Evaluating technical choices or refactors |
| [`roadmap.md`](./roadmap.md) | Planned improvements, ecosystem expansions, and backlog | Scoping new capabilities |
| [`ticket-plan.md`](./ticket-plan.md) | Detailed ticket plan for the next work waves | Planning a specific wave of work |
| [`deep-research-agentic-memory-evolution.md`](./deep-research-agentic-memory-evolution.md) | Deep research brief & architectural plan for agentic cognitive OS evolution | Designing R17-R22 milestones and feature implementations |
| [`deep-research-memory-mechanisms-2026-09.md`](./deep-research-memory-mechanisms-2026-09.md) | 86-system memory feature matrix with per-system mechanisms and measured claims | Competitive research, capability scoping, mechanism adaptation |
| [`deep-research-memory-adaptation-2026-10.md`](./deep-research-memory-adaptation-2026-10.md) | Scored adaptation shortlist (impact × feasibility) against the 86-system study, with the top-3 ranked adaptations and their acceptance tests | Choosing what to build next from competitor mechanisms |
| [`deep-research-memory-improvement-2026-10.md`](./deep-research-memory-improvement-2026-10.md) | Deep research brief: 9 new memory systems, updated gap scorecard, scored adaptation shortlist (A15–A22), and R23–R26 production-readiness roadmap | Designing R23–R26 milestones, versioned memory features, and monetization positioning |
| [`../artifacts/bench-graph-baseline.md`](../artifacts/bench-graph-baseline.md) | Measured graph/dashboard baseline at 100/1k/10k memories, hypothesis verdicts, and the fix order for the instant-graph workstream | Before changing `src/ui.ts`, `src/graph.ts`, or the dashboard render path |

---

## 📄 User-facing documentation (repository `docs/`)

| File | Audience | Purpose |
| :--- | :--- | :--- |
| [`docs/user-guide.md`](../../docs/user-guide.md) | Humans | The daily pair-programming loop: ground → constrain → capture. |
| [`docs/concepts.md`](../../docs/concepts.md) | Humans | Core concepts and the guarded 7-state lifecycle machine. |
| [`docs/team-getting-started.md`](../../docs/team-getting-started.md) | Humans | Team setup: server, auth, client recipes. |
| [`docs/roadmap.md`](../../docs/roadmap.md) | Humans | The sprint board (requested → planned → in progress → done). |
| [`docs/agent-reference.md`](../../docs/agent-reference.md) | **Agents** | The contract: install, file layout, mandatory session protocol, trust gates, failure semantics. |
| [`docs/cli-reference.md`](../../docs/cli-reference.md) | **Agents** | Every CLI command and every MCP tool — **generated** from `src/`. |
| [`docs/mcp-tool-matrix.json`](../../docs/mcp-tool-matrix.json) | **Agents** | The tool list as JSON — **generated** from `src/`. |
| [`claims.json`](../../claims.json) | **Agents** | Every countable claim — **generated** from `src/`. |

### Generated documentation is never hand-edited

`docs/cli-reference.md`, `docs/mcp-tool-matrix.json` and `claims.json` are
produced by `scripts/generate-claims.ts` and
`scripts/generate-cli-reference.ts`. Regenerate them after any CLI or MCP
change:

```bash
bun run scripts/generate-claims.ts
bun run scripts/generate-cli-reference.ts
```

`test/marketing_claims.test.ts` fails the build when the generated files and
the source disagree, when a published figure is stale, or when an agent-facing
document names a tool that does not exist.

### The website's agent-readable layer

`apps/website` publishes `llms.txt` (a curated map) and `llms-full.txt` (the
whole site as plain text). Both are generated from the built HTML by
`apps/website/scripts/build-llms-txt.ts`, so they cannot drift from the site.
