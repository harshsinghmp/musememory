# 📦 Muse Memory Product Scope & Capabilities

> **Binary Names**: `memory` (primary), `musememory` (alias), `npx musememory` (zero-install)
> **MCP Protocol**: MCP `2024-11-05`, `2025-06-18` (stdio transport)
> **Runtime**: Bun / TypeScript (Node-compatible bundle)
> **Authoritative counts**: [`claims.json`](../../claims.json) — generated from `src/` by `scripts/generate-claims.ts`.
> **Authoritative tool list**: [`docs/mcp-tool-matrix.json`](../../docs/mcp-tool-matrix.json) — generated, never hand-typed.
> **Full tool + flag reference**: [`docs/cli-reference.md`](../../docs/cli-reference.md) — generated.
> **Agent contract**: [`docs/agent-reference.md`](../../docs/agent-reference.md).

> ⚠️ **Do not hand-type tool or command names in this file.** Every tool name
> below is asserted against the live registry by
> `test/marketing_claims.test.ts`; a name that does not exist fails the build.

---

## 🎯 Executive Overview

Muse Memory is a zero-daemon, file-backed cognitive memory engine that gives AI agents
(Claude Code, Cursor, Antigravity, Windsurf, Codex, Gemini CLI, Hermes, OpenCode,
OpenClaw, and the rest of the detected registry) persistent, self-organizing memory
across sessions — without an external database daemon, an account, or a cloud service.

- **MCP tools registered**: `claims.json → mcpTools`
- **Task profiles**: `claims.json → mcpProfiles` (`core`, `coding`, `debugging`, `review`, `architecture`, `maintenance`, `full`)
- **Coding agents auto-wired**: `claims.json → agentPlatforms`
- **External memory formats importable**: `claims.json → migratorProviders`
- **Credential rule families**: `claims.json → credentialRuleFamilies`
- **Background daemons**: `claims.json → backgroundDaemons`

---

## 🔌 Flagship Orchestration & Intelligence Tools

| MCP Tool | Execution Phase | Agent Purpose |
| :--- | :--- | :--- |
| `muse_context` | **Flagship Orchestration** | Unified context fusion: single-call query combining search, active file, symbol, error messages and task intent under strict knapsack token budgets. |
| `muse_health` | **Quality Gate** | 5-Pillar Project Health Gate: store integrity, code anchors, doc/code alignment, anti-pattern sentry and technical debt, with A-F grading and PASS/WARN/FAIL status. |
| `muse_why` | **Cognition / "Why" Reasoner** | Traces code evolution backwards through past bug fixes, ADRs, trade-offs and invariants before a refactor. |
| `muse_bug_clusters` | **Fragility Hotspots** | Clusters recurring bugs into root-cause categories with subsystem fragility scoring. |
| `muse_tech_debt` | **Technical Debt Registry** | Scans code and memory for TODO/FIXME markers, unsafe `as any` casts and drifted anchors. |
| `muse_code_impact` | **Blast Radius** | Synthesises code callers, governing ADRs, negative warnings and a risk score for a file. |
| `muse_pr_context` | **Change Context** | Generates a memory-grounded PR description from a git diff. |
| `muse_memory_for_code` | **Code-to-Memory** | Queries all memories, ADRs, constraints and bugs associated with a code file and symbol. |
| `muse_code_for_memory` | **Memory-to-Code** | Resolves all native code anchors and affected source files for a given memory entry. |
| `muse_reconcile_anchors` | **Anchor Repair** | Prunes dead references and refreshes structural hashes across the store. |
| `muse_profile_list` | **Tool Management** | Lists the task-focused profiles and the tools each one exposes. |
| `memory_adr_record` / `memory_adr_list` | **Architecture Decisions** | Records and lists living ADRs with drivers, consequences, options considered and native code anchors. |
| `memory_drift_audit` | **Drift Detection** | Bi-directional documentation ↔ code drift engine across 6 alignment states. |
| `memory_negative_capture` | **Negative Sentry** | Records failed approaches, anti-patterns and reproduction commands so they are not repeated. |
| `memory_promote` | **Scoped Promotion** | Promotes memory along the `local` → `project` → `global` ladder with a 5× repeated-success policy. |
| `memory_archive` / `memory_rehydrate` | **Archival Lifecycle** | Manages `active` → `cold` → `dormant` → `archived` with query rehydration. |
| `memory_anchor_create` / `memory_anchor_verify` / `memory_anchor_audit` | **Code Identity** | Creates, verifies and audits line-independent structural code anchors. |
| `muse_sync_broadcast` / `muse_sync_ingest` | **P2P Gossip Mesh** | Broadcasts and ingests sealed `SyncPacket`s with deduplication and contradiction flagging. |
| `muse_sync_status` / `muse_sync_pool` | **Sync Coordination** | Tracks peer vector clocks and synchronises memories through the shared drop-directory pool. |
| `muse_mesh_status` | **Monorepo Topology** | Discovers monorepo workspaces and multi-repo sibling groups. |
| `muse_mesh_query` | **Cross-Project Query** | Queries memories across the workspace mesh with origin-package provenance tags. |
| `muse_mesh_audit` | **Contract Verification** | Audits cross-package dependency contracts, entrypoint exports and cross-repo anchors. |
| `muse_mesh_link` | **Mesh Linking** | Links or unlinks external repository paths in the workspace mesh registry. |

## 🛠️ Core Memory & Lifecycle Tools

| MCP Tool | Execution Phase | Agent Purpose |
| :--- | :--- | :--- |
| `get_context` | **Session Start / Init** | Token-budgeted prompt context injection: `USER.md`, active `CURRENT.md` constraints and top-$K$ scored memories. **Call this on the first turn of every session.** |
| `muse_context` | **Task Start** | Task-shaped fused context (constraints + ranked memories + negative lessons + code anchors). |
| `memory_capture` | **Learning / Task End** | Persist a durable fact, decision, rule or fix. Secret-scanned and citation-verified. |
| `memory_confirm` | **Validation Phase** | Promote a `candidate` or `disputed` memory to `confirmed`. |
| `memory_supersede` | **Refactoring / Updates** | Link an obsolete memory to a newer confirmed one so deprecated patterns are never served. |
| `search` | **Targeted Lookups** | Ranked search over the store with a score breakdown and filters. |
| `memory_recall` | **Targeted Lookups** | Recall active and confirmed memories with verification levels and related graph links. |
| `memory_current` / `memory_get_constraints` / `memory_set_constraints` | **Constraints** | Read, append and manage the active working constraints in `CURRENT.md`. |
| `memory_resolve_conflict` | **Conflict Resolution** | Resolves contradictions via `supersede`, `historical`, `reject` or `keep_both`. |
| `memory_roi` | **Utility & ROI** | Computes reuse metrics, application success rates and regression penalties. |
| `memory_search_transcripts` | **Historical Archaeology** | Full-text dialogue search across past JSONL transcripts with conversation bookends. |
| `memory_audit` | **Compliance Check** | Inspects the append-only operational ledger (`.memory/audit.jsonl`). |
| `memory_verify` / `memory_verify_strict` | **Integrity Gate** | Runs an entry's template-gated verification command, or the full strict integrity gate. |

---

## ⚙️ Task-Focused MCP Profiles

Seven profiles keep the tool surface small. The authoritative mapping is
`PROFILE_TOOL_DEFINITIONS` in `src/orchestrator/profiles.ts`; call
`muse_profile_list` for the live list. Select a profile with the
`MUSE_MCP_PROFILE` environment variable.

| Profile | Purpose |
| :--- | :--- |
| `core` | Minimal footprint: context injection and rapid capture. |
| `coding` | Active development, code anchors, contextual fusion. |
| `debugging` | Bug diagnosis, error resolution, observations, negative lessons. |
| `review` | Code review, architectural audit, conflict verification. |
| `architecture` | System design, promotions, entity wiki, tree indexing, mesh. |
| `maintenance` | Repository health, deduplication, archival lifecycle, mesh. |
| `full` | The complete registry — every registered tool. |

---

## 💻 CLI Command Surface

Only the commands an agent actually calls. The full matrix — every command,
every flag, generated from `src/cli.ts` — is in
[`docs/cli-reference.md`](../../docs/cli-reference.md).

```bash
# Session start
memory context [query] --token-budget 2000   # fused context for the prompt
memory search "<query>" --limit 10            # ranked search with score breakdown

# Capture and lifecycle
memory capture "<text>" --project <name>      # persist a memory
memory confirm <id>                           # candidate -> confirmed
memory supersede <old_id> --with <new_id>     # replace, keeping lineage
memory current get                            # read active constraints
memory current set "<text>" --project <name>  # append a constraint
memory link <id> --related <id1,id2>          # bidirectional relation

# Governance
memory audit [--operation OP] [--limit N]     # query the audit ledger
memory validate [--dry-run]                   # schema + referential integrity
memory verify <id> --strict                   # integrity gate
memory doctor                                 # ecosystem health diagnostic
memory health [--json]                        # 5-pillar health gate
```

### Commands that do **not** exist

These appear in older notes and are wrong — calling them fails:

| Wrong | Correct |
| :--- | :--- |
| `memory persona <archetype>` | `memory user init <archetype>` |
| `memory current --add "..."` | `memory current set "..."` |
| `memory recall "<id>"` | `memory recall "<query>"` — ID lookup is `memory checkout <id>` |
| `memory stale <id>` | `memory stale [--days N]` — it **lists** stale entries |
| `memory mcp --profile coding` | Set `MUSE_MCP_PROFILE=coding` in the environment |
| `memory health --global` | `memory health --json` only — no `--global` flag |

---

## 🔒 Trust Gates (behaviour an agent must assume)

| Gate | When | Behaviour |
| :--- | :--- | :--- |
| Secret scan (Vibeguard) | every write | The write is **refused**; the rule name is reported, never the value. |
| Citation verification | every write with an anchor | **Refused** under the default `fail_fast` policy when the cited file/symbol does not exist; drift is flagged and stamped. |
| Freshness gate | every recall | Memories whose anchors drifted are **withheld** and reported (`withheld_memories` + `freshness_notice`), never silently served. `include_drifted: true` returns them with a `⚠ FRESHNESS` warning. |
| Ingest sanitisation | import / harvest | Injected `<memory-context>` blocks and base64 payloads are stripped before the text is stored — including into `CURRENT.md`. |
| Template-gated execution | `memory verify` | Only `bun test <relative test file>`, `bunx tsc --noEmit` and `node --check <relative path>` may run. There is no shell-execution tool. |

---

## 📁 Storage Layout

| Path | Scope | Contents |
| :--- | :--- | :--- |
| `.memory/memory.db` | project | SQLite (WAL + FTS5): memories, anchors, graph edges, FTS index. |
| `.memory/memories/*.yaml` | project | One human-readable YAML file per memory — the secondary mirror. |
| `.memory/CURRENT.md` | project | Active working constraints and session handoffs. |
| `.memory/USER.md` | project | Persona and working preferences. |
| `.memory/observations.jsonl` | project | Append-only event log the harvester mines. |
| `.memory/audit.jsonl` | project | Tamper-evident write ledger. |
| `.memory/sync_pool/` | project | Zero-daemon shared gossip pool. |
| `~/.memory/` | global | The same layout; project scope wins on conflict. |

Everything is a plain file. There is no server, no port and no service to keep alive.
