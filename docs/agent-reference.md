# Agent Reference

> **Audience**: AI coding agents. Human-readable narrative lives in
> [`user-guide.md`](./user-guide.md) and the [README](../README.md); this file
> is the exact contract — commands, flags, file layout, lifecycle states and
> failure semantics — with no prose padding.
>
> **Machine-readable companions**:
> - [`mcp-tool-matrix.json`](./mcp-tool-matrix.json) — the full list of registered MCP tools.
> - [`../claims.json`](../claims.json) — every countable claim, generated from `src/`.
> - `https://harshsinghmp.github.io/musememory/llms.txt` — the site, for agents.
> - `https://harshsinghmp.github.io/musememory/llms-full.txt` — the site as plain text.

---

## 1. Install

```bash
npx musememory connect        # wire every detected coding agent over MCP
```

Requirements: Node.js >= 18 or Bun >= 1.2. No account, no API key, no
configuration file, no background daemon. The package installs a single
executable, `memory` (alias `musememory`).

Equivalent explicit install:

```bash
npm install -g musememory     # or: bun add -g musememory
```

## 2. Where state lives

| Path | Scope | Contents |
| --- | --- | --- |
| `.memory/` | project | `memory.db` (SQLite, WAL + FTS5), `memories/*.yaml`, `CURRENT.md`, `USER.md`, `observations.jsonl`, `audit.jsonl`, `sources.json`, `claims.json`, `sync_pool/`, `mesh_links.json` |
| `~/.memory/` | global | Same layout. Project scope wins on conflict. |

Both are plain files. There is no server, no port, and no service to keep
alive. Delete the directory to delete the memory.

The per-entry `memories/*.yaml` mirror is the export/rollback copy of SQLite. It
is written eagerly by default; set `MUSE_YAML_MIRROR=0` (or pass
`yamlMirror: false` to `openStore`) to skip it when the store is only read
through this engine. SQLite stays authoritative either way. The WAL is bounded
to a 2 MiB autocheckpoint interval and a 64 MiB journal size limit, and
`memory io` reports the current footprint.

## 3. Mandatory session protocol

An agent integrating Muse must follow this order.

1. **First turn of any session** — call `get_context`. It returns the `USER.md`
   persona profile, the `CURRENT.md` active constraints, and the top-K ranked
   memories relevant to the task, under one token budget.
2. **Before editing** — if a hard constraint, invariant or open loop is
   established or changed, record it with `memory_capture --type constraint` or
   `memory_current set`.
3. **After a fix or a decision** — call `memory_capture`. Capture is the
   mechanism that makes the next session cheaper than this one.
4. **When knowledge is replaced** — call `memory_supersede`, never `delete`.
   Superseding keeps lineage; deleting loses the audit trail.

`muse_context` is the higher-fidelity variant of `get_context`: it fuses
constraints, ranked memories, negative lessons and code anchors, and is what
task-shaped profiles (`coding`, `debugging`, `review`, `architecture`) expose.

### The delivery contract

**A commit is not a delivery.** Work is *landed* only when it is reachable from
the integration branch **on the remote**. Until then it is *local* — and it
must be described as local, in every artifact and every report.

Before describing work as landed, shipped, merged or released, run the gate:

```bash
bun run check:landed
```

It exits non-zero when the work cannot be proven delivered, and prints the
exact commands and SHAs to quote. The words *landed / shipped / merged /
released / "verified on `dev`"* are only earned after it exits 0.

The same contract applies to this repository's own agent standards — see
[`.agents/standards/landing-gate.md`](../.agents/standards/landing-gate.md).

## 4. CLI

```
memory <command> [arguments] [options]
```

Full matrix: [`cli-reference.md`](./cli-reference.md).

### Commands an agent uses most

| Command | Purpose |
| --- | --- |
| `memory context [query] --token-budget N` | Top-ranked context for prompt injection. |
| `memory search <query> --limit N` | Ranked multi-factor search with a score breakdown. |
| `memory capture "<text>" --project P` | Persist a memory. Vibeguard-scanned and citation-verified. |
| `memory propose "<text>" --project P` | Propose a candidate (does not auto-confirm). |
| `memory confirm <id>` | Promote a candidate to confirmed. |
| `memory supersede <old_id> --with <new_id>` | Replace outdated knowledge, preserving lineage. |
| `memory current get` / `memory current set "<text>" --project P` | Read/write active constraints. |
| `memory link <id> --related <id1,id2>` | Bidirectional relation between entries. |
| `memory audit [--operation OP] [--entry-id ID]` | Query the append-only audit ledger. |
| `memory conflicts [--dry-run]` | List recorded contradictions; `--dry-run` previews what would be flagged. |
| `memory doctor` | Full ecosystem health diagnostic. |
| `memory harvest "<text>" --project P` | Distil a turn into a fix/decision unit. |
| `memory user [get|init|set]` | Manage `USER.md` persona archetypes & working style preferences. |
| `memory scan-secrets [dir]` | Native Vibeguard secret scanner (zero external dependencies). |
| `memory terrain [--out file.md]` | Collect host hardware, toolchain & agent ecosystem terrain map. |
| `memory verify <id> --strict` | Run an entry's verification command, or the full integrity gate. |

### Global flags that change behaviour

| Flag | Effect |
| --- | --- |
| `--project <name>` | Scopes a write to a project. Required by `capture`, `propose`, `harvest`. |
| `--token-budget <n>` | Hard ceiling on returned tokens. The engine never exceeds it. |
| `--limit <n>` | Maximum candidates. Clamped by the engine, not by the caller. |
| `--global` | Operates on `~/.memory/` instead of `.memory/`. |
| `--dry-run` | Required default for destructive operations; nothing is written. |
| `--harness <name>` | Opt-in for harness-specific config paths (e.g. `claude` → `~/.claude*`). Without it, those paths are reported as skipped and nothing is written. |

## 5. MCP

The server speaks MCP over stdio. Protocol versions accepted:
`2025-11-25` (current), `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07`.

The server advertises the versions its installed SDK supports. The
`2026-07-28` revision is not implemented: `@modelcontextprotocol/sdk@1.32.2`
does not know it.

### Tool annotations (safety hints)

Every entry in `tools/list` carries the four MCP safety hints — `readOnlyHint`,
`destructiveHint`, `idempotentHint` and `openWorldHint` — from
`src/mcp/annotations.ts`, attached once at module load, so the catalog's names,
order, descriptions and input schemas are served unchanged. `readOnlyHint: true`
marks the calls that only read (every search, context, list, get, report, scan
and health tool); a host may use it to **auto-approve** retrieval instead of
prompting on every call. `destructiveHint: true` marks the six calls that can
delete, forget, overwrite or prune stored state (`memory_delete`,
`memory_lifecycle`, `memory_restore`, `memory_import`,
`memory_disconnect_pageindex`, `muse_reconcile_anchors`), so a host can warn
before one, and no tool is ever both read-only and destructive. `idempotentHint:
true` marks the writes that converge — status transitions, `set`-style updates
and builders that regenerate a derived artefact — so a retry after a timeout is
safe, while appends and run-type tools (`memory_capture`, `memory_observe`,
`memory_freeze_run`, `memory_verify`, …) are not idempotent.
`openWorldHint` is `false` on all 126 tools: nothing dereferences a URL or
fetches remote content — `memory_source_add` records a URL without retrieving
it, and the sync tools exchange packets through a local directory. These are
**hints**, not guarantees (the SDK says a client must not trust them from an
untrusted server); a tool name that is not in the map is still served with the
conservative default — not read-only, destructive, not idempotent — so nothing
ships unannotated.

A read tool whose payload is already a stable object also publishes an
`outputSchema` (`src/mcp/output-schemas.ts`) and returns that object as
`structuredContent` beside the untouched text block — `search`, `memory_recall`,
`get_context`, `muse_health`, `memory_read`, `graph_status`, `memory_audit`,
`memory_lifecycle_status` and `memory_roi` today — so a host can render and
validate a result without re-parsing JSON out of a string, while a client that
ignores `structuredContent` still sees byte-identical `content`. The envelope is
closed (`additionalProperties: false`) everywhere the server builds one; a
memory entry keeps its open `schema.json` shape with a required core of `id`,
`title`, `content`, `project`, `status`, `created_at` and `updated_at`, including
at the root of `memory_read`, whose payload is the entry itself.
`memory_settings_get` stays text-only on purpose: its payload is a user-authored
`settings.json` shallow-merged over the defaults, so a section can be partial and
an unknown key survives the merge — a closed schema would reject a real settings
file, and an open one would describe nothing.

### Request directories and the workspace root

Every tool accepts an optional `dir` (`workspace`, `project_dir` and `cwd` are
aliases) naming the project the call applies to. That value is **confined**: it
is resolved, then it must be the server's workspace root or live beneath it. The
workspace root is the one the server resolved at startup — the `mcp` argument,
else `MUSE_MEMORY_PROJECT_DIR`, else `PROJECT_ROOT`, else the working directory.
A directory outside it is refused with a tool error that names the root, and the
refusal happens **before** any `.memory/` is created, so a rejected call leaves
the filesystem untouched. Containment is resolved through `realpath`, so a
symlink inside the root cannot point the store outside it.

The multi-project workflow — one server, several checkouts — is an **operator**
decision, not a model one. Start the server with `MUSE_MCP_ALLOW_EXTERNAL_DIR=1`
to lift the confinement for that process; unset (the default) is the confined
behaviour.

The store is private by construction: memory directories are created `0700` and
`CURRENT.md`, `USER.md`, `CORE.md`, the audit trail and its salt file are
`0600` (the modes are re-applied on write, so a store created by an older
version is tightened on first use).

### Prompt and resource output is data

`prompts/get` text and the markdown resources (`memory://current`,
`memory://user`, `memory://core`, `memory://handoff`) are served inside
`<muse-memory data-not-instructions="true"> … </muse-memory>`. The fence tokens
are stripped from the content first, so a memory cannot close the wrapper early,
and `</muse-memory>`, `<muse-memory …>`, `<system>`, `<instructions>` and
`<system-message>` never reach the client as tags. `memory://entry/<id>` stays
valid JSON and is **not** wrapped; the same fence tokens are stripped from its
string fields instead.

### Browser origins on the HTTP transport

`muse mcp --http` binds loopback and stays usable without a token, but it now
decides browser access from the `Origin` header. A request that carries one is
accepted **only** if the operator listed that exact origin with
`--allowed-origins` (comma-separated) — the default is deny for every browser
origin, loopback included — and the same rule runs for the `OPTIONS` preflight
and for every real request, before authentication and before dispatch. A refused
request gets `403` and no `access-control-allow-origin`, and that header is only
ever set to an allowlisted origin (never `*`, never a reflection). Native MCP
clients send no `Origin` header, so stdio bridges, the SDK, `curl` and
loopback-without-a-token keep working; an allowlisted origin still has to pass
`--token` / `--tokens` when those are configured, and the `Host` allowlist behind
DNS-rebinding protection is unchanged.

`claims.json` records the live totals; read them rather than trusting prose:

| Claim | Source of truth |
| --- | --- |
| Registered tools | `docs/mcp-tool-matrix.json` |
| Profiles | `src/orchestrator/profiles.ts` |
| Agent platforms auto-wired | `src/agents/registry.ts` |
| Import formats | `src/migrator/detect.ts` |
| Credential rule families | `src/secrets.ts` |

### Sync attestations and crypto agility

Sync packets are attested with a signature over `SHA-256(canonicalJson(packet))`.
Verification is **registry-dispatched**: `sig_scheme` (optional — absent means
`"ed25519"`) selects a verifier in `src/sync/attestation.ts`, so an identifier
this build does not know comes back as `unsupported_algorithm` — distinct from a
bad signature — and a new scheme can be added without changing any caller.
Nothing about the v2 envelope changed: existing packets and chains still verify
byte for byte.

`muse_attestation_verify` takes an inline `public_key` only (never a path), and
its optional `max_age_days` rejects a record whose signed `created_at` is older
than the bound — the practical way to stop trusting a compromised key without a
release. `memory attest verify … --max-age-days N` is the same knob on the CLI.
The per-use inventory, the NIST IR 8547 dates (deprecated **2030-12-31**,
disallowed **2035-12-31**, risk acceptance from **2031-01-01**), the owner and
the ML-DSA migration plan live in the
[crypto inventory](crypto-inventory.md).

### Profiles

Tools are exposed through task-focused profiles so an agent is never handed
the whole surface. Select with `MUSE_MCP_PROFILE` or the server's `profile`
argument.

| Profile | Use it for |
| --- | --- |
| `core` | Minimal footprint: context injection and rapid capture. |
| `coding` | Active development, code anchors, contextual fusion. |
| `debugging` | Bug diagnosis, error resolution, observations, negative lessons. |
| `review` | Code review, architectural audit, conflict verification. |
| `architecture` | System design, promotions, entity wiki, tree indexing. |
| `maintenance` | Repository health, deduplication, archival sweeps. |
| `full` | Everything. |

`muse_profile_list` returns the live profile→tool mapping.

### Tools that are mandatory, optional, and forbidden

| Kind | Tools |
| --- | --- |
| Must call on session start | `get_context` |
| Use when state changes | `memory_capture`, `memory_current`, `memory_supersede`, `memory_confirm` |
| Use for investigation | `search`, `memory_tree_search`, `muse_why`, `muse_code_impact` |
| Use for governance | `memory_audit`, `memory_verify_strict`, `memory_drift_audit` |
| Never available to a model | Anything that writes outside the store. There is no shell-execution tool. `memory verify` runs a **template-gated** command: only `bun test <relative test file>`, `bunx tsc --noEmit`, and `node --check <relative path>` are permitted, and nothing is executed outside those shapes. Refusals are audit-logged as `verify_refused`. |

## 6. Memory lifecycle

```
propose → candidate → confirmed → superseded
                ↘ stale → archived
                ↘ rejected
                ↘ conflicted (kept-both, resolved by supersede/historical/reject)
                ↘ deleted (tombstone; restorable with `memory restore`)
```

- `confirmed` is the only state served by default.
- `stale` entries decay; per-type half-lives are trust-tiered.
- `deleted` is a tombstone (`deleted_at`, `deleted_by`), excluded from every
  read path, restorable, and replayable from `audit.jsonl`.
- `conflicted` keeps both sides. Resolution verbs: `supersede`, `historical`,
  `reject`, `keep_both`.

## 7. Trust gates

| Gate | When | Behaviour on violation |
| --- | --- | --- |
| Secret scan (Vibeguard) | every write | The write is **refused** and the rule name is reported. Nothing is stored. |
| Citation verification | every write with a code anchor | The write is **refused** under the default `fail_fast` policy if the cited file/symbol does not exist. Drift is flagged and stamped. |
| Freshness gate | every recall | Memories whose anchors drifted are **withheld** and reported via `withheld_memories` + `freshness_notice`. They are never silently served. `include_drifted: true` returns them with a `⚠ FRESHNESS` provenance warning. |
| Ingest sanitisation | import / harvest | Injected `<memory-context>` blocks and base64 payloads are stripped before the text is considered. |

**Instruction-bearing writes.** OWASP LLM Top 10 2026 (LLM01) names memory
persistence as a first-class injection path and Agentic ASI06 calls the same
failure memory & context poisoning, so `propose` classifies every write's
title+content before it lands. A write that carries instructions, role
assignments or policy overrides — "ignore previous instructions", "disregard the
above rules", "from now on", "you are now", "act as", "system prompt", "developer
mode", "you must always", or "always use" at the start of a sentence — is stamped
`contains_instructions: true` and persists as `candidate` only; `confirmed: true`
is the approval step and is never downgraded. Candidates are excluded from
`CURRENT.md` (`syncConstraints` takes only `active`/`confirmed`), so an injected
instruction cannot be promoted into the constraint block every later prompt
reads. The classifier is conservative on purpose: two weak signals (a
sentence-start imperative, a tool name, a URL, "remember to") must co-occur before
it fires, and fenced code is not scanned — demoting a legitimate memory costs
more than missing one. Every write also carries `provenance: { channel, agent,
prompt_hash?, captured_at }`: `captured_at` is always stamped, `channel` names
`mcp`, `cli`, `sync` or `harvest`, and `prompt_hash` stays absent unless the
caller supplied one.

**Reporting a security issue.** The threat model, supported versions, scope and
response targets are in [**SECURITY.md**](../SECURITY.md). Report through the
repository's **Security** tab → "Report a vulnerability" (GitHub private
vulnerability reporting); there is no security email address, and a suspected
vulnerability never goes in a public issue or pull request. The
"Hardening already in place" list there is the shortest index of the gates above.

## 8. Failure semantics

| Condition | Result |
| --- | --- |
| Secret detected | Write refused. Non-zero exit. Rule name only — never the value. |
| Citation does not resolve | Write refused (`fail_fast`) or stamped as drifted (`warn` policy). |
| `memory.db` schema version ahead of the binary | The read is refused; run `memory upgrade`. |
| SQLite lock held longer than the busy timeout | The operation fails loudly. It does not silently skip the write. |
| Store circuit breaker open (5 consecutive failures) | Degraded mode: reads fall back, writes are refused, and the state is reported. `memory doctor` shows it. |
| Unknown MCP tool name | Tool-not-found error. Tool names are exact. |

## 9. Constraints on the agent

- **No shell execution from memory.** A stored memory can never cause an
  arbitrary command to run. `memory verify` is template-gated.
- **Paths are contained.** Wiki, PageIndex, pool and mesh paths are resolved
  with `resolveWithin` (strict containment). `resolveExternal` is an explicit
  opt-out for intentionally external directories.
- **No network by default.** Semantic embeddings are opt-in and require an
  explicitly configured endpoint. Everything else runs in-process.
- **Writes are auditable.** Every write appends to `audit.jsonl` and the
  tamper-evident hash chain. At 5 MiB the active file rolls into
  `audit-archive/`; the chain continues across segments, and pruning records an
  anchor hash so `verifyAuditChain` still validates the retained window.

## 10. Verifying the installation

```bash
memory doctor            # storage, schemas, secrets, agent wiring
memory health            # 5-pillar health gate, letter grade
memory health --project P  # ...scoped to one memory project
memory stats             # counts by status and type
memory context --query "how does auth work" --budget 2000
```

A healthy install reports: SQLite reachable, schema version current, no
secrets in the store, and the expected agents wired.

The health report states its own scope in `scope`: `filter` (the requested
project, or `null` for the whole store), `projects` (every project whose
memories were considered) and `entry_count`. Read it before comparing two
numbers — an unscoped report covers every project in the store.

The same `project` filter is available on every audit surface: the
`muse_health`, `muse_tech_debt`, `muse_bug_clusters`, `memory_anchor_audit` and
`memory_drift_audit` MCP tools, and the studio's `/api/health`, `/api/drift`,
`/api/cognition/clusters` and `/api/cognition/debt` endpoints
(`?project=P`). Code-side metrics stay workspace-wide by design — source code
is shared between projects — so `scope.code_scope` always reads `workspace`.

### The Studio dashboard is a loopback surface

`memory ui` binds `127.0.0.1` only and has no remote-bind option, so the
dashboard is reachable from the machine that started it and nowhere else. Every
API call must be same-origin: a request to `/api/*` carrying an `Origin` header
is served only when that origin's host equals the `Host` the request was
addressed to (`http://localhost:2222` for a page on `localhost:2222`; another
loopback port, `127.0.0.1` versus `localhost`, or any other site is refused with
`403` and no CORS headers). Requests with no `Origin` — curl, scripts, native
clients — are still allowed. Because the dashboard renders stored memory content
into a browser, every response also carries a content-security policy scoped to
`'self'` (no CDN, no webfonts, no inline scripts), plus `X-Content-Type-Options:
nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and
`Cache-Control: no-store` on `/api/*`. Do not proxy or port-forward the Studio
to a network interface; a browser on that network would satisfy the bind while
still being a third party.
