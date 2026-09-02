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
