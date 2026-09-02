# 📍 Current Shipped State & Active Invariants

> **Version**: `v1.11.0`  
> **Status**: Production / Published to npm (`musememory`)

---

## 🚀 Shipped Capabilities

1. **Dual-Scope Cognitive Engine**: Project-local `.memory/` and global `~/.memory/`.
2. **Deterministic Lifecycle Machine**: Propose → Candidate → Confirm → Supersede → Stale → Delete.
3. **Model Context Protocol (MCP)**: Native stdio server implementing MCP 2024-11-05.
4. **Universal Agent Detection**: Auto-detects and connects 80+ coding agent platforms.
5. **Universal Migrator**: Imports memories from 24+ external formats (AgentMemory, Mem0, Letta, etc.).
6. **Vibeguard Secret Defense**: Built-in regex scanner preventing credential commits to memory.
7. **Compounding & Rollups**: Temporal rollups and token-bag centroid clustering.

---

## 🔒 Active System Invariants

- **Zero External Daemons**: All operations must execute in-process via SQLite (`memory.db`) or flat files. Never depend on background servers.
- **Fail Fast**: Throw loudly on secret detection, invalid schema shapes, or unconfirmed supersessions.
- **Verification Gate**: Before declaring changes complete, `bun test`, `bun run build`, and `tsc --noEmit` must pass.
