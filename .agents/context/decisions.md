# 🏛️ Locked Architectural Decisions (ADRs)

> **Directive**: These decisions are binding. Do not casually reopen or refactor away from these foundations.

---

### ADR-001: Zero-Daemon, File-Backed Engine
- **Decision**: All storage and indexing run in-process using embedded SQLite (`bun:sqlite` / SQLite3) and flat Markdown/JSON files.
- **Rationale**: Developers and AI agents must not be blocked by disconnected Docker containers or background server crashes.

### ADR-002: Dual-Persistence (SQLite + YAML Mirror)
- **Decision**: Memory entries are stored in indexed SQLite for sub-millisecond retrieval and simultaneously mirrored to `.memory/memories/*.yaml`.
- **Rationale**: Enables lightning-fast programmatic queries while preserving 100% human and Git diff readability.

### ADR-003: MCP Stdio Protocol
- **Decision**: Implement Model Context Protocol via standard I/O (`stdio`).
- **Rationale**: Cleanest, lowest-overhead integration across all AI agent harnesses (Claude Code, Cursor, Antigravity, OpenCode).

### ADR-004: In-Flight Secret Interception (Vibeguard)
- **Decision**: Secrets are scanned in-memory before file writes and rejected immediately.
- **Rationale**: Once a secret enters a local database or git repository, rotating and purging it causes severe disruption.

### ADR-005: Bun-First Runtime & Toolchain
- **Decision**: Use Bun as the primary test runner, bundler, and local runtime, compiling to portable Node.js binaries for npm distribution.
- **Rationale**: Instant test iteration (`bun test`) and seamless zero-dependency distribution.

### ADR-006: Harness-Independent Hook Installation (Global Standard First)
- **Decision**: `memory hooks install` resolves its target as explicit `settingsPath` → explicit `--harness` opt-in → global standard (project `.agents/hooks.json` when a `.agents/` directory exists, otherwise `~/.agents/hooks.json`). A harness path (e.g. `~/.claude/settings.json`) is never auto-selected, and `connectAgent` skips harness-specific agents without an explicit `--harness` opt-in.
- **Rationale** (principal ruling, 2026-10-15): the runtime is vendor-neutral — hooks must not couple memory to one harness or create a harness directory unprompted. A pre-existing harness settings file does not imply consent; only `--harness claude` does.
