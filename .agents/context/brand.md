# 🎨 Brand, Persona & Voice Guidelines

---

## 1. Product Identity & Voice
- **Name**: **aimm** (short for **AI Memory**) — always lowercase, no periods, pronounced like "aim"; the doubled `m` is the memory.
- **Project/Package**: `musememory` — the project is `musememory`, the product is **aimm**.
- **Descriptor**: "aimm — local-first memory for AI coding agents."
- **Canonical naming source**: [`docs/brand.md`](../../docs/brand.md) — name, capitalization, do/don't, the keep-list (package, binaries, `.memory/`, `muse_*` tools, `MUSE_*` env vars, code identifiers) and the Meta-Muse rationale.
- **Voice**: the product is the subject — "aimm saves what your agent learns…", never "Muse saves…". `Muse` survives only as the assistant persona (see `AGENTS.md` "Operating Identity").
- **Tone**: Technical, authoritative, razor-sharp, zero-fluff.
- **Audience**: Elite software engineers, agency founders, and autonomous AI agents.

---

## 2. Terminal UI & CLI Output Conventions
- Format CLI tables cleanly with ASCII borders.
- Prepend informative CLI banners with appropriate emojis:
  - 🧠 Memory operations
  - 🛡️ Security / Vibeguard alerts
  - ⚡ High-speed actions
  - 📍 Active working state
- Strip ANSI codes when output is piped to files or non-interactive terminals.
