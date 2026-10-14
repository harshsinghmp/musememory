# 📖 Muse Memory Context Index

> **Reading Directive**: Durable project truth for Muse Memory lives in `./.agents/context/`. Start at this index, then load **only** the specific context file your active task requires.

---

## Context Navigation Map

| File | Scope & Contents | When to Read |
| :--- | :--- | :--- |
| [`product.md`](./product.md) | Product scope, CLI tools (`memory`, `musememory`), and MCP tool matrix | Understanding user commands, capabilities, and MCP protocols |
| [`architecture.md`](./architecture.md) | Dual-Scope storage (`.memory/`), SQLite DB, retrieval scoring formula, and file layout | System design, file locations, state machine, and data flow |
| [`brand.md`](./brand.md) | Persona profiles (`USER.md` archetypes), voice, and presentation rules | Writing prompts, terminal output copy, and user documentation |
| [`current.md`](./current.md) | Current shipped state (v2.0.0), test coverage, and active constraints | Before starting work on bugs, features, or refactors |
| [`decisions.md`](./decisions.md) | Locked architectural decisions (zero-daemon, file-backed SQLite, atomic I/O) | Evaluating technical choices or refactors |
| [`roadmap.md`](./roadmap.md) | Planned improvements, ecosystem expansions, and backlog | Scoping new capabilities |
| [`deep-research-agentic-memory-evolution.md`](./deep-research-agentic-memory-evolution.md) | Deep research brief & architectural plan for agentic cognitive OS evolution | Designing R17-R22 milestones and feature implementations |
| [`deep-research-memory-mechanisms-2026-09.md`](./deep-research-memory-mechanisms-2026-09.md) | 86-system memory feature matrix with per-system mechanisms and measured claims | Competitive research, capability scoping, mechanism adaptation |
| [`deep-research-memory-adaptation-2026-10.md`](./deep-research-memory-adaptation-2026-10.md) | Scored adaptation shortlist (impact × feasibility) against the 86-system study, with the top-3 ranked adaptations and their acceptance tests | Choosing what to build next from competitor mechanisms |
| [`deep-research-memory-improvement-2026-10.md`](./deep-research-memory-improvement-2026-10.md) | Deep research brief: 9 new memory systems (Memoir, ai-memory, GAM, Engram, etc.), updated gap scorecard (4 new versioned-memory gaps), scored adaptation shortlist (A15–A22), and R23–R26 production-readiness roadmap | Designing R23–R26 milestones, versioned memory features, and monetization positioning |
| [`../artifacts/bench-graph-baseline.md`](../artifacts/bench-graph-baseline.md) | Measured graph/dashboard baseline at 100/1k/10k memories, hypothesis verdicts, and the fix order for the instant-graph workstream | Before changing `src/ui.ts`, `src/graph.ts`, or the dashboard render path |
