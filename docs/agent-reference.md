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
`2024-11-05`, `2025-06-18`.

`claims.json` records the live totals; read them rather than trusting prose:

| Claim | Source of truth |
| --- | --- |
| Registered tools | `docs/mcp-tool-matrix.json` |
| Profiles | `src/orchestrator/profiles.ts` |
| Agent platforms auto-wired | `src/agents/registry.ts` |
| Import formats | `src/migrator/detect.ts` |
| Credential rule families | `src/secrets.ts` |

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
  tamper-evident hash chain.

## 10. Verifying the installation

```bash
memory doctor            # storage, schemas, secrets, agent wiring
memory health            # 5-pillar health gate, letter grade
memory stats             # counts by status and type
memory context --query "how does auth work" --budget 2000
```

A healthy install reports: SQLite reachable, schema version current, no
secrets in the store, and the expected agents wired.
