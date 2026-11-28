# 🎨 Brand, Persona & Voice Guidelines

---

## 1. Product Identity & Voice
- **Name**: **musememory** — always lowercase, one word, no space, no CamelCase, no periods. Say it as the two words run together; the cyan tail of the wordmark is the *memory*. Descriptor when an expansion helps: **musememory (AI Memory)**.
- **Project/Package/Product**: one word. `musememory` is the package, the repo and the product, so there is no second name to reconcile in a doc, an install line or an issue title.
- **Former names**: *Muse Memory* (before 3.5.0) and a brief interim label shipped in 3.5.0 and retired after review — history only, recorded in [`docs/brand.md`](../../docs/brand.md). New copy never uses `Muse` or `Muse Memory` alone, because Meta ships a bot called Muse.
- **Descriptor**: "musememory — local-first memory for AI coding agents."
- **Canonical naming source**: [`docs/brand.md`](../../docs/brand.md) — name, capitalization, do/don't, the keep-list (package, binaries, `.memory/`, `muse_*` tools, `MUSE_*` env vars, code identifiers) and the Meta-Muse rationale.
- **Voice**: the product is the subject — "musememory saves what your agent learns…", never "Muse saves…". `Muse` survives only as the assistant persona (see `AGENTS.md` "Operating Identity").
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
