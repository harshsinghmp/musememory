# Brand & Naming: **musememory**

> Canonical source for the product name. When copy, code comments, a README, a
> slide or a release note disagree with this page, this page wins.
>
> The product and the package are the same word: **musememory**.

---

## 1. The name

| | |
| :--- | :--- |
| **Name** | **musememory** |
| **Descriptor** | "musememory — local-first memory for AI coding agents." |
| **Expansion** | **musememory (AI Memory)**, when a reader needs the category spelled out |
| **Capitalization** | Always lowercase: `musememory`. Never `Musememory`, `MuseMemory`, `MUSEMEMORY`, `musememory™`. At the start of a sentence it is still `musememory`. |
| **Spacing** | One word. No space, no hyphen, no middle dot, no period, no version suffix. |
| **Former names** | *Muse Memory* (before 3.5.0) → *aimm* (3.5.0 only) → **musememory** (final) |

`musememory` is a product name, not an acronym. Expand it once, on first use in
a long document — `musememory (AI Memory)` — then use the name on its own.

---

## 2. The one-line description

> **musememory — local-first memory for AI coding agents.**

Longer forms, when a page needs a second sentence:

- "musememory saves what your agent learns to plain files on your machine, then
  hands the right notes back next session."
- "musememory is local-first memory for AI coding agents: `.memory/` on your
  disk, an in-process SQLite + FTS5 engine, and an MCP server your agent already
  knows how to call."

---

## 3. Voice

The subject of a sentence is **musememory**, and it *saves*, *recalls*,
*refuses*, *verifies* — it does things for the person reading.

- ✅ "musememory saves what your agent learns, then hands it back next session."
- ✅ "musememory refuses a credential at the door."
- ❌ "Muse saves what your agent learns…"
- ❌ "Muse Memory is a persistent cognitive memory system…"
- ❌ "The Muse will remember this for you."

Second person for the reader ("your agent", "your machine"), third person for the
product. No "we at musememory". No exclamation marks in product copy. Terminal
output follows the same rule as the website: the banner says `musememory`, not
`MUSE MEMORY`.

**Never `Muse` or `Muse Memory` alone in new copy.** Meta ships a consumer bot
called **Muse**; a bare "Muse" is ambiguous to a reader and to a search engine.
`musememory` is the safe full name, and it is the only one new copy uses.

---

## 4. What does **not** change

The rename was a *label* change. Everything a client, a script, a config file or
a stored memory touches kept its name, so upgrading costs nothing and every
existing install keeps working.

| Surface | Stays exactly as-is |
| :--- | :--- |
| npm package, repository, `npx` invocation | `musememory` — `npx musememory`, `github.com/harshsinghmp/musememory` |
| Binaries | `memory`, `musememory` |
| On-disk store & every file path | `.memory/`, `.memory/**`, `CURRENT.md`, `USER.md`, `CORE.md` |
| MCP tool names | `muse_context`, `muse_health`, `muse_why`, `muse_sync_*`, `muse_attestation_*` — **never renamed**; breaking a tool name breaks every client |
| Environment variables | `MUSE_*` (e.g. `MUSE_MCP_ALLOW_EXTERNAL_DIR`) |
| Schema keys, JSON fields, CLI commands & flags | unchanged |
| Code identifiers | `MuseContextInput`, `MuseHookEvent`, `resolveMuseContext`, `MUSE_MEMORY_DIRECTIVE`, … |
| Assistant persona | `AGENTS.md` "Operating Identity: Muse" — a persona name, not the product |
| Package's historical identifier | `MuseMemory` may appear only where it names the package itself, never in new copy |

The `muse_*` prefix in the tool names and the `MUSE_*` prefix in the env vars are
therefore *legacy prefixes*, not a second product name. They are the spelling
that exists, and using them is correct; deriving new names from them is not.
MCP tool names may gain `musememory_*` **aliases** in 4.0 (ADR-012). Until then
the `muse_*` spelling is the only spelling that exists.

The one deliberate addition of the 3.5.0 rename survives: the MCP
`serverInfo.title` and its one-line `description` are the human-readable product
label, while `serverInfo.name` stays the protocol identifier a client stores in
its config. Both now read `musememory`.

---

## 5. Do / Don't

| Do | Don't |
| :--- | :--- |
| `musememory` | `Musememory`, `MuseMemory`, `MUSEMEMORY`, `musememory.`, `musememory-` |
| `musememory (AI Memory)` on first use in a long doc | expanding it every time |
| "musememory saves…" | "Muse saves…", "Muse Memory saves…", "aimm saves…" |
| "musememory — local-first memory for AI coding agents." | "Muse Memory — autonomous persistent cognitive memory system" |
| `npx musememory` | `npx aimm`, `npx muse-memory` |
| `.memory/` | `.musememory/`, `.aimm/` |
| `muse_context`, `MUSE_MCP_ALLOW_EXTERNAL_DIR` | `musememory_context`, `MUSEMEMORY_MCP_ALLOW_EXTERNAL_DIR` |
| "the musememory MCP server" | "musememory-mcp-server" |

Rules of thumb:

1. If it is in a shell, a config, a schema or a stored file — it is `musememory`
   or `muse_*`, and it did not change in either rename.
2. If a human reads it as the product's name — it is `musememory`, lowercase,
   one word.
3. If it is a dated record (a released CHANGELOG section, a launch report, an
   archived plan, an audit under `docs/research/`) — leave the old name alone and
   add a rename note instead. Rewriting history makes a record untrustworthy.

---

## 6. Why: the Meta Muse collision, and why the final name is the package name

The product was called **Muse Memory**. Meta shipped **Muse**, its consumer
memory bot, and the collision was not cosmetic:

- Search results for "Muse memory" returned Meta's assistant, so the product was
  undiscoverable by its own name.
- A user reading "Muse" could not tell whether the sentence was about a
  local-first MCP server or about a hosted Meta bot — the single most damaging
  kind of brand confusion for a tool whose whole argument is "your memory stays
  on your disk".
- The ambiguity reached the agent-facing surface too: an assistant told "use
  Muse" had two plausible referents.
- Trademark risk in the assistant/memory category sits with the larger, earlier
  claimant.

3.5.0 answered with **aimm**, a coined word short for *AI Memory*. It solved the
collision, but it introduced a second problem: the product suddenly had a name
different from the thing a user actually typed. Every install, every `npx`, every
package listing and every issue title said `musememory` while the banner said
`aimm`, so documentation had to explain a mapping before it could explain the
product.

**musememory** keeps the thing that worked and drops the thing that did not: the
package name, the repo name, the binary name and the product name are one word
again. It is not in use in this category, it is unambiguous next to Meta's Muse,
and it is what the user already types. The cost is length; the benefit is that
there is nothing left to reconcile.

The rename kept the architecture. Only the wordmark, the prose and the human
label changed — see §4 for the list of things that deliberately did not.

---

## 7. Where each rename landed

**3.5.0 — Muse Memory → aimm** (retired after review; kept as history)

- `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `DESIGN.md`, `AGENTS.md`
- `.agents/context/**` (current-state docs) and `.agents/standards/**`
- `docs/**` current guides
- `apps/website/**` — copy, meta/OG tags, FAQ, figure captions, `Logo.astro`
  wordmark
- `src/**` user-facing strings — CLI help and banners, MCP `serverInfo` display
  name and tool descriptions (names untouched), error messages that name the
  product
- `package.json` `description` only (the `name` stays `musememory`)

**Final — aimm → musememory**

- Every surface above, once more, plus `docs/brand.md` (this page)
- `src/version.ts` `PRODUCT_NAME` / `PRODUCT_TAGLINE`, which is where the CLI,
  the MCP `serverInfo` title and the one-line description all read the label from
- `apps/website/scripts/build-brand-assets.ts`, the single source for the
  wordmark on every card — regenerated into the OG (1200×630), Twitter
  (1200×628), banner (1280×640 / 1500×500), README (1280×400), post (1080×1080)
  and story (1080×1920) assets
- `test/**` assertions that pinned the printed name

The M mark is unchanged. It is the memory glyph, and it was never a letterform
of the name. Only the wordmark beside it changed, from `Muse|Memory` to
`aim|m` to `muse|memory` — the head in the text colour, the tail in cyan.

Records that keep their old wording on purpose: `.agents/archive/**`,
`.agents/artifacts/**`, `.agents/plans/**`, `.agents/research/**`,
`.agents/context/ticket-plan.md`, `docs/launch/**`, `docs/research/**`, released
CHANGELOG sections (including the 3.5.0 `aimm` entry) and `.stversions/**`.
