# Brand & Naming: **aimm**

> Canonical source for the product name. When copy, code comments, a README, a
> slide or a release note disagree with this page, this page wins.
>
> `musememory` is the project/package. **aimm** is the product.

---

## 1. The name

| | |
| :--- | :--- |
| **Name** | **aimm** |
| **Expansion** | **AI Memory** |
| **Pronunciation** | Say it like **"aim"** — the doubled `m` is silent and stands for the *memory*. Never "A-I-M-M", never "ay-em-em". |
| **Capitalization** | Always lowercase: `aimm`. Never `Aimm`, `AIMM`, `Aimm.`, `aimm™`. At the start of a sentence it is still `aimm`. |
| **Punctuation** | None. No period, no hyphen, no middle dot, no version suffix in the name. |
| **Descriptor** | "aimm — local-first memory for AI coding agents." |

`aimm` is a product name, not an acronym to be spelled out inline. Expand it once,
on first use in a long document, then use the name: `aimm (AI Memory)`.

---

## 2. The one-line description

> **aimm — local-first memory for AI coding agents.**

Longer forms, when a page needs a second sentence:

- "aimm saves what your agent learns to plain files on your machine, then hands
  the right notes back next session."
- "aimm is local-first memory for AI coding agents: `.memory/` on your disk, an
  in-process SQLite + FTS5 engine, and an MCP server your agent already knows
  how to call."

---

## 3. Voice

The subject of a sentence is **aimm**, and it *saves*, *recalls*, *refuses*,
*verifies* — it does things for the person reading.

- ✅ "aimm saves what your agent learns, then hands it back next session."
- ✅ "aimm refuses a credential at the door."
- ❌ "Muse saves what your agent learns…"
- ❌ "Muse Memory is a persistent cognitive memory system…"
- ❌ "The Muse will remember this for you."

Second person for the reader ("your agent", "your machine"), third person for the
product. No "we at aimm". No exclamation marks in product copy. Terminal output
follows the same rule as the website: the banner says `aimm`, not `MUSE MEMORY`.

---

## 4. What does **not** change

The rename is a *label* change. Everything a client, a script, a config file or a
stored memory touches keeps its old name, so upgrading is free.

| Surface | Stays exactly as-is |
| :--- | :--- |
| npm package, repository, `npx` invocation | `musememory` — `npx musememory`, `github.com/harshsinghmp/musememory` |
| Binaries | `memory`, `musememory` |
| On-disk store & every file path | `.memory/`, `.memory/**`, `CURRENT.md`, `USER.md`, `CORE.md` |
| MCP tool names | `muse_context`, `muse_health`, `muse_why`, `muse_sync_*`, `muse_attestation_*` — **never renamed**; breaking a tool name breaks every client |
| Environment variables | `MUSE_*` (e.g. `MUSE_MCP_ALLOW_EXTERNAL_DIR`) |
| Schema keys, JSON fields, CLI commands & flags | unchanged |
| Code identifiers | `MuseContextInput`, `MuseHookEvent`, `resolveMuseContext`, `MUSE_MEMORY_DIRECTIVE`, … |
| Package's historical identifier | `MuseMemory` may appear only where it names the package itself, never in new copy |

MCP tool names may gain `aimm_*` **aliases** in 4.0 (ADR-012). Until then the
`muse_*` spelling is the only spelling that exists, and it is correct.

The one deliberate addition is the MCP `serverInfo.title`: `name` stays
`musememory` (the protocol identifier a client stores in its config), and the
human-readable `title`/`description` now say `aimm`.

---

## 5. Do / Don't

| Do | Don't |
| :--- | :--- |
| `aimm` | `Aimm`, `AIMM`, `aimm.`, `aimm-` |
| "aimm saves…" | "Muse saves…" |
| "aimm — local-first memory for AI coding agents." | "Muse Memory — autonomous persistent cognitive memory system" |
| `npx musememory` | `npx aimm` |
| `.memory/` | `.aimm/` |
| `muse_context`, `MUSE_MCP_ALLOW_EXTERNAL_DIR` | `aimm_context`, `AIMM_MCP_ALLOW_EXTERNAL_DIR` |
| "the aimm MCP server" | "the aimm-mcp-server" |
| `aimm (AI Memory)` on first use in a long doc | expanding it every time |

Rules of thumb:

1. If it is in a shell, a config, a schema or a stored file — it is `musememory`
   or `muse_*`, and it does not change.
2. If a human reads it as the product's name — it is `aimm`.
3. If it is a dated record (a released CHANGELOG section, a launch report, an
   archived plan, an audit under `docs/research/`) — leave the old name alone and
   add a rename note instead. Rewriting history makes a record untrustworthy.

---

## 6. Why: the Meta Muse collision

The product was called **Muse Memory**. Meta shipped **Muse**, its consumer
memory bot, and the collision is not cosmetic:

- Search results for "Muse memory" now return Meta's assistant, so the product is
  undiscoverable by its own name.
- A user reading "Muse" cannot tell whether the sentence is about a local-first
  MCP server or about a hosted Meta bot — the single most damaging kind of brand
  confusion for a tool whose whole argument is "your memory stays on your disk".
- The ambiguity reaches the agent-facing surface too: an assistant told "use
  Muse" has two plausible referents.
- Trademark risk in the assistant/memory category sits with the larger, earlier
  claimant.

**aimm** resolves it: a name that is not in use in this category, that
pronounces as "aim" (the goal) while the doubled `m` keeps the memory, and that
reads as `AI Memory` the moment it is expanded.

The rename keeps the architecture. Only the wordmark, the prose and the human
label changed — see §4 for the list of things that deliberately did not.

---

## 7. Where the rename landed

- `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `DESIGN.md`, `AGENTS.md`
- `.agents/context/**` (current-state docs) and `.agents/standards/**`
- `docs/**` current guides, plus this page
- `apps/website/**` — copy, meta/OG tags, FAQ, figure captions, `Logo.astro` wordmark
- `src/**` user-facing strings — CLI help and banners, MCP `serverInfo` display
  name and tool descriptions (names untouched), error messages that name the product
- `package.json` `description` only (the `name` stays `musememory`)

The M mark is unchanged: it is the memory glyph. Only the wordmark beside it
changed, from `Muse|Memory` to `aim|m`.
