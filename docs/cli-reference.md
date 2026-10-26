# CLI & MCP Reference

> **Generated file** — produced by `scripts/generate-cli-reference.ts` from `src/cli.ts` and `src/mcp.ts`. Do not hand-edit: regenerate it after any CLI or MCP change (`bun run scripts/generate-cli-reference.ts`).

This is the complete machine-facing surface. For narrative guidance see [`agent-reference.md`](./agent-reference.md); for the human walkthrough see [`user-guide.md`](./user-guide.md).

## Command line

```bash
memory <command> [arguments] [options]   # alias: musememory
```

```
Muse Memory (memory / musememory) -- Autonomous Persistent Memory for AI Agents & Agency Networks

Usage:
  memory <command> [arguments] [options]

Core Memory Lifecycle Commands:
  install [dir]                 Run interactive onboarding wizard & auto-wire installed agents
  upgrade / update [--check]    Auto-fetch latest release, self-heal, and sync agent platforms
  doctor [dir]                  Run comprehensive ecosystem health diagnostic
  uninstall [agent] [--purge]   Disconnect agents and optionally purge .memory data
  init [dir]                    Initialize .memory/ in workspace or current dir
  capture <text> --project P    Capture new memory unit with Vibeguard secret inspection
  propose <text> --project P    Propose a candidate memory entry
  confirm <id>                  Promote candidate or stale memory to confirmed status
  supersede <old_id> --with <new_id> Replace outdated knowledge with confirmed target
  link <id> --related <id,...>  Link related memories bidirectionally
  mark-stale <id> [--reason R]  Deprecate decaying knowledge
  reject <id>                   Reject candidate entry
  delete <id> [--reason R]      Tombstone entry (soft delete), log audit, restorable
  restore <id> [--replay [--apply]]  Restore a tombstoned entry; --replay rebuilds content from audit.jsonl
  list / ls [--status S] [--type T] [--project P] List memory entries with multi-field filtering
  stats                         Display total memory counts and status/type distribution
  stale [--days N]              List entries exceeding staleness policy
  consolidate [--project P] [--dry-run]  Cluster confirmed memories into scene rollups
  optimize [--dry-run] [--project P] [--force] Prune test noise, junk, duplicates & vacuum SQLite DB
  trace <id> [--depth N]        Walk causal graph pathways from an entry (default depth 5)
  loops                         Prioritized open-loop report: git state, stale candidates, constraints
  nudge                         Proactive attention list: overdue/due-soon entries, stale-by-policy, open loops
  routine run <name>            Execute a routine's steps from .memory/routines.yaml
  routine install [name]        Print crontab line(s) for routines (user installs; no system mutation)
  distill [--min-count N] [--dry-run]  Distill recurring fix patterns into .agents/skills/ folders
  verify <id> [--timeout S] [--strict] Execute test_command or run full strict integrity gate
  briefing [--limit N]          Executive summary of active and stale memories

Evidence, Provenance & Cognitive Governance:
  source [add|list|show]        Manage external documentation and URLs in provenance Source Ledger
  claim [record|list|show]      Record verifiable claims with confidence tags ([RAW], [FETCH], [SEARCH], [INFER])
  freeze --task <task> [--run-id R] Capture immutable execution snapshot with file inventory & sha-256 hashes
  prompt [list|show|run <name>] Manage and run structured prompt templates with live context injection
  rollup --period week|month|quarter Multi-scale temporal compounding & HOT.md working cache generation
  loop [record|status|clear]    Gauntlet iteration ledger & plateau/regression detector

Context & Retrieval Commands:
  context [query] [--limit N] [--token-budget N] [--depth L1|L2|L3] [--tier 0|1|2] Top-ranked prompt context
  search <query> [--limit N] [--token-budget N] [--hybrid] [--tree] Scored token retrieval (hybrid: vector+BM25, tree: hierarchical reasoning)
  reindex                       Rebuild the local vector index (.memory/index.json) for hybrid search
  embed [status|build|reindex]  Manage semantic embeddings (llama.cpp / OpenAI-compatible endpoint; opt-in)
  recall [query]                Search active/confirmed memories with filters
  search-transcript <query> [file.jsonl] [--window N] Full-text transcript search with bookends

Wiki & Entity Knowledge Compounding:
  wiki [compile|list|show]      Compile memories into structured Obsidian-compatible markdown wiki pages
  extract-entities [--dry-run]  Extract named entities (persons, products, orgs, files, concepts) from memories
  entities [list|show|related]  Inspect extracted knowledge graph entities and co-occurrences

Persona, Settings & Constraints Commands:
  settings [get|set|reset|export|import] Manage unified global and project configuration
  user [get|init|set] [--global] Manage USER.md persona & working preferences
  current [get|set]             Manage CURRENT.md active project constraints
  core [tier] [--set T|--remove|--show] Manage CORE.md permanent partitions (identity|directives|conventions|context)

Ecosystem, Migration & Connectivity:
  connect [agent|all] [--force] [--with-hooks] [--harness H]
                                 Auto-wire MCP into detected coding agents; --with-hooks also installs
                                 the lifecycle hook pack (SessionStart/PostToolUse/Stop) into .agents/hooks.json;
                                 --harness claude is the explicit opt-in for harness-specific paths like ~/.claude
  agents / detect-agents        Scan workstation for detected coding agent platforms
  detect                        Scan machine for external memory formats to migrate
  migrate [--from P] [--all]    Ingest external memories with state preservation & secret scrubbing
  learn / sync-chats [--confirm] Auto-discover and harvest memories from all agent chats across machine
  harvest <file|text> --project P Distill conversation transcripts into structured memory units
  harvest-auto [--from <glob>] [--project P] Harvest inbox transcripts as candidates and archive them
  hook install --git            Install the harvester as a git pre-commit hook (never clobbers)
  import-transcript <file.jsonl> Universal JSONL transcript ingestion with session binding
  export [--out file.json]      Export portable JSON memory snapshot
  import <file.json>            Import portable JSON memory snapshot
  validate [--dry-run]          Validate YAML schemas and referential integrity
  graph [status|index]          Inspect or index CodeGraph/Graphify AST provider symbols
  ui / dashboard [--port 2222]  Launch embedded visual knowledge graph UI
  daemon [--port N]             Real-time agency hub (SSE event stream + publish API, default port 7878)
  sync [status|broadcast|ingest|pool] Cross-agent knowledge sync & P2P gossip mesh
  mesh [query|check|link|unlink|propagate] Multi-repo & monorepo cross-project mesh
  health [--project P]         Run unified 5-pillar architectural health evaluation; --project scopes it to one memory project
  conflicts [--dry-run]        Inspect recorded contradictions; --dry-run previews what would be flagged
  reconcile [--prune] [--stale] Reconcile orphaned & drifted code anchors across memories
  benchmark [--iterations N]    Run microsecond speed, quality & token economy benchmark suite
  scan-secrets [dir] [--json]   Native Vibeguard secret scanner (zero external dependencies)
  terrain [--out file.md]       Collect machine hardware, toolchain & agent ecosystem map
  code-impact <file> [--symbol] Synthesize code callers, ADRs, negative warnings & risk score
  pr-context [--base B] [--out] Generate memory-verified PR description from git diff
  mcp                           Run stdio MCP server for agent platforms

Version Control (R23):
  branch <id> --path <path> [--label L] Tag a memory with semantic dotted-path addressing
  checkout <path|id>              Retrieve memory by mem_path or entry id
  blame <id>                      Show access history & staleness metadata for a memory
  ls-branches [--project P]       List all branch references
```

## MCP tools

**115 tools** are registered, exposed through **7 task-focused profiles** (`core`, `coding`, `debugging`, `review`, `architecture`, `maintenance`, `full`). The authoritative machine-readable list is [`mcp-tool-matrix.json`](./mcp-tool-matrix.json).

Select a profile with the `MUSE_MCP_PROFILE` environment variable. Call `muse_profile_list` for the live mapping.

### Context & recall

| Tool | Required parameters | Description |
| --- | --- | --- |
| `memory_read` | `id` | Read a full memory entry by id |
| `get_context` | `query` | MANDATORY ON SESSION START: Fetch Top-K relevant memories, active user profile (USER.md), and active hard constraints (CURRENT.md) for prompt injection. MUST be called on the first turn of any task or session. |
| `search` | `query` | Ranked search over memory entries |
| `memory_recall` | `query` | Recall active and confirmed memories for a query, with verification levels and related graph links |
| `memory_get_user_profile` | `content` | Read the active user profile and preferences (USER.md) |
| `memory_search_transcripts` | `query`, `transcript` | Full-text search over conversation transcripts (.jsonl or text) with conversation bookends (start/end) and context window |
| `memory_tree_search` | `query` | Hierarchical tree-indexed reasoning search across partitioned memory shards |
| `memory_wiki_get` | `slug` | Read a compiled wiki page (concept, entity, index, or log) |
| `memory_wiki_search` | `id` | List compiled wiki pages with optional filtering |
| `memory_entities_get` | `id` | Get detailed information about an extracted entity and its relationships |
| `memory_entities_search` | `content`, `project` | List extracted entities by type or project |
| `memory_code_intel_status` | `query` | Inspect registered code intelligence providers and their workspace availability status |
| `memory_code_intel_symbols` | `query` | Resolve symbols (functions, classes, types) across active code intelligence providers with fallback |
| `memory_code_intel_blast_radius` | `target` | Calculate ripple effect and blast radius of modifying a symbol or file |
| `memory_ranked_retrieval` | `query` | Multi-factor ranked retrieval fusing symbol matching, BM25, graph overlap, blast radius, recency, utility ROI, and negative warnings |
| `muse_context` | `memory_id` | FLAGSHIP UNIFIED CONTEXT ORCHESTRATOR: Single-call fusion of active constraints, ranked memories, code anchors, and negative lessons under a strict token budget with actionable next steps. |
| `muse_code_for_memory` | `memory_id` | Bidirectional lookup: Given a memory ID, return all anchored code references, files, and symbols |
| `muse_memory_for_code` | `file_path` | Bidirectional lookup: Given a file path or symbol, return all associated memories, architectural decisions, bug fixes, constraints, and negative lessons |

### Capture & lifecycle

| Tool | Required parameters | Description |
| --- | --- | --- |
| `memory_capture` | `content` | Create a new memory entry with inline secret scan (refuses probable secrets). When type='constraint', automatically appends to CURRENT.md. |
| `memory_current` | `action` | Read or append active working constraints and hard invariants in CURRENT.md for the active project |
| `memory_get_constraints` | `query` | Read the active working constraints and hard invariants recorded in CURRENT.md for the active project |
| `memory_set_constraints` | `query` | Append a working constraint or hard invariant to CURRENT.md for the active project |
| `memory_harvest` | `id` | Distill conversation/text into structured outcome, fix, decision, and failure memories |
| `memory_confirm` | `id` | Promote a candidate, disputed, or stale entry to confirmed |
| `memory_supersede` | `id` | Mark old memory entry superseded by new confirmed memory entry |
| `memory_lifecycle` | `verb`, `id` | T-084: Five-verb canonical memory lifecycle mutation (change, end, correct, revert, forget) |
| `memory_link` | `id`, `related` | Two-way link related memory entries |
| `memory_mark_stale` | `id` | Mark a memory entry stale |
| `memory_reject` | `id` | Reject a memory entry |
| `memory_delete` | `id` | Soft-delete a memory entry by single point ID (tombstone, reversible via memory_restore). Dry-run by default unless confirm: true or dry_run: false. |
| `memory_restore` | `id` | Restore a tombstoned memory entry by ID. Fails on an unknown or never-deleted entry. Set replay=true to rebuild the content from the audit ledger when the row is gone, and apply=true to write it back |
| `memory_audit` | `transcript` | Query the append-only audit trail of memory operations |
| `memory_import_transcript` | `transcript` | Ingest a JSONL transcript or raw log into structured outcome and fix memories |
| `memory_export` | `entries` | Export memory snapshot for agency team synchronization |
| `memory_import` | `entries` | Import memory snapshot entries into the store |
| `confirm_fix` | `id` | Confirm a disputed entry as fixed (disputed -> confirmed) |
| `record_session` | `project` | Record a session start entry |
| `memory_checkpoint` | `content` | Record a real-time progress checkpoint or task handoff to CURRENT.md to prevent loss on interruption |
| `memory_validate` | `content` | Validate the memory store for schema violations, secrets, broken links, and integrity |
| `memory_set_user_profile` | `content` | Update the user profile and preferences (USER.md) with inline secret scanning |
| `memory_core` | `id` | Read or edit permanent core memory partitions (CORE.md) with tiers: identity, directives, conventions, context |
| `memory_consolidate` | `id` | Cluster confirmed memories into scene rollup entries (architecture summaries linked to members); idempotent |
| `memory_trace` | `id` | Walk causal pathways (supersedes/superseded_by + related links) from a memory entry as a cycle-safe tree |
| `memory_loops` | `id` | Read-only prioritized open-loop report: uncommitted git changes, unmerged branches, stale candidates, disputed entries, and CURRENT.md constraints |
| `memory_distill` | `id` | Distill recurring confirmed fix patterns into .agents/skills/<slug>/SKILL.md folders (never overwrites existing skills) |
| `memory_distill_route` | `id` | Multi-channel knowledge distillation router: triages memories across system (rules/fixes), content (architecture concepts), and health (contradictions/staleness) lanes with deduplication |
| `memory_verify` | `id` | Verification oracle: execute a fix entry's test_command; exit 0 promotes candidates to confirmed and stamps independently-verified |
| `memory_settings_get` | `settings` | Read unified global or project configuration settings |
| `memory_settings_set` | `settings` | Update unified global or project configuration settings |
| `memory_compress` | `text` | Compress formatted prompt context losslessly, stripping header whitespace and boilerplate while preserving all architectural facts. |
| `memory_source_add` | `url`, `title` | Record external documentation, research paper, RFC, or URL into the provenance Source Ledger |
| `memory_source_list` | `claim` | List recorded external sources in the Source Ledger |
| `memory_claim_record` | `claim` | Record an evidence-backed claim into the Claim Ledger connected to sources and confidence tags ([RAW], [FETCH], [SEARCH], [INFER]) |
| `memory_claim_list` | `task` | List recorded claims in the Claim Ledger |
| `memory_freeze_run` | `task` | Capture an immutable execution snapshot (active task, file inventory, git SHA, CURRENT constraints, memory SHA-256 hashes) in .memory/runs/<run-id>/ |
| `memory_freeze_list` | `name` | List recorded frozen execution snapshots in .memory/runs/ |
| `memory_prompt_list` | `name` | List available structured prompt templates in .memory/prompts/ |
| `memory_prompt_get` | `name` | Get prompt template by name |
| `memory_prompt_run` | `name` | Render prompt template with variable substitution and live memory context injection |
| `memory_rollup` | `period` | Multi-scale temporal compounding: aggregate atomic memories into weekly, monthly, or quarterly synthesis wiki pages and update HOT.md cache |
| `memory_loop_record` | `iteration_index`, `critic_verdict`, `largest_fix_identified`, `test_results` | Record an iteration round in the multi-agent Gauntlet Iteration Ledger (.memory/iterations.jsonl) |
| `memory_loop_status` | `memory_id`, `success` | Inspect multi-round iteration status, plateau warnings, and regression signals |
| `memory_verify_strict` | `memory_id`, `success` | Execute Strict Integrity & Health Gate: audits zero secrets, referential link integrity, wikilinks, orphaned candidates, and claim sources |
| `memory_feedback` | `memory_id`, `success` | Record application outcome for a memory (success, failure, or regression) to train utility and calculate memory ROI |
| `memory_resolve_conflict` | `winning_id`, `losing_id`, `strategy`, `reason` | Resolve a contradiction between two memories using a deterministic strategy (supersede, historical, reject, or keep_both) |
| `memory_roi` | `raw`, `source`, `project` | Calculate memory utility, reuse success rates, and return-on-investment across the store |
| `memory_observe` | `raw`, `source`, `project` | Ingest an ephemeral raw observation (tool output, test error, build log, review feedback) to .memory/observations.jsonl |
| `memory_distill_observations` | `project` | Distill unprocessed raw observations into structured candidate memories and negative lessons |
| `memory_negative_capture` | `title`, `failed_approach`, `failure_reason`, `project` | Record a first-class negative memory (DO_NOT_USE, FAILED_APPROACH, BUG_PRONE_PATTERN) to prevent recurring mistakes |
| `memory_enrich` | `id` | Enrich an existing memory entry with code intelligence symbol evidence |
| `memory_compaction_check` | `used_tokens` | Evaluate context usage against the 70% threshold and prompt if compaction is needed |
| `memory_compact_handoff` | `high_level_goal`, `current_architecture`, `completed_tasks`, `open_tasks`, `next_concrete_task` | Lock the 5 mandatory invariants and write an interruption-proof session handoff to CURRENT.md before context reset |
| `memory_harvest_turn` | `text`, `project` | Continuous conversational harvester: automatically extract architectural decisions, fixes, and negative lessons from turn text |
| `memory_evaluate_promotion` | `id` | Evaluate a memory entry for promotion along the ladder: LOCAL -> PROJECT -> GLOBAL (5x success rule, zero regressions, zero conflicts, generalization) |
| `memory_promote` | `id` | Execute promotion of a memory entry (LOCAL -> PROJECT or PROJECT -> GLOBAL) with generalization and audit logging. Can optionally stage in pending tier for session-end flush. |
| `memory_flush_pending` | `id` | Two-tier promotion protocol (T-107): Flushes staged pending promotions at session close or manual trigger, executing promotion for qualifying entries. |
| `memory_curate` | `id` | Curator protocol (T-106): appends empirical evidence or application outcomes to an existing memory. Deterministic promotion rules evaluate eligibility and trigger promotion when criteria are satisfied. |
| `memory_generalize` | `content` | Test and preview generalization of memory content: scrubs project-specific paths and extracts universal principles |
| `memory_archive` | `id`, `tier`, `reason` | Transition a memory entry to cold, dormant, or archived tier with reason |
| `memory_rehydrate` | `id` | Restore an archived, dormant, or cold memory back to active/confirmed status upon relevance |
| `memory_lifecycle_status` | `memory_id`, `file_path` | Inspect store-wide memory lifecycle metrics: counts across active, cold, dormant, archived, scopes, and promotion readiness |

### Code anchors, drift & decisions

| Tool | Required parameters | Description |
| --- | --- | --- |
| `memory_pageindex_index` | `content`, `project` | Build a PageIndex-style hierarchical tree index from document/text for reasoning-based retrieval |
| `memory_pageindex_search` | `query` | Search a PageIndex tree index with reasoning-based retrieval |
| `memory_pageindex_import` | `query`, `project` | Import PageIndex search results/insights as memory entries |
| `memory_disconnect_pageindex` | `settings` | Disconnect PageIndex MCP tools and remove associated indexes |
| `memory_drift` | `text` | Scan the local Git workspace for modified or deleted code files and AST symbols referenced by memories. Flags drifted memories for re-verification or supersession. |
| `memory_anchor_create` | `memory_id`, `file_path` | Create and attach a line-independent structural code anchor to a memory entry (repository, file, module, symbol, route, test) |
| `memory_anchor_verify` | `memory_id` | Verify all code anchors attached to a memory entry against the live codebase to detect drift or orphaned references |
| `memory_anchor_audit` | `memory_id` | Run repository-wide audit of all code anchors across all memories: reports integrity score, valid, drifted, and orphaned counts |
| `memory_adr_record` | `title`, `context_and_drivers`, `decision`, `consequences` | Record a first-class Architecture Decision Record (ADR) as an active, queryable memory with drivers, decision, consequences, options, and code anchors |
| `memory_adr_list` | `target` | List all Architecture Decision Records (ADRs) recorded in the memory store, optionally filtered by status |
| `memory_drift_audit` | `target` | Run bidirectional documentation <-> code drift audit: verifies if documented decisions are implemented in code and flags missing/stale/conflicting code or docs |
| `muse_why` | `target` | Autonomous Engineering Cognition: Explain WHY code was designed or modified the way it is by tracing historical bug fixes, ADRs, trade-offs, and invariants |
| `muse_bug_clusters` | `packet` | Analyze and cluster recurring bug fixes, negative lessons, and failures into architectural fragility hotspots with root-cause hypotheses |
| `muse_tech_debt` | `packet` | Scan repository and memory store for technical debt indicators (TODO/FIXME/HACK, unsafe 'as any' casts, drifted code anchors) and generate refactoring priorities |
| `muse_health` | `packet` | Unified 5-Pillar Project Health Gate: audit memory store integrity, code anchor validity, documentation drift, anti-pattern sentry, and technical debt with overall grade (A-F) and pass/fail gate status |
| `muse_code_impact` | `file_path` | Evaluates comprehensive code and memory impact before editing: callers, test suites, ADRs, negative warnings, active constraints, and composite risk level |
| `muse_pr_context` | — | Generates rich GitHub PR descriptions from git diff linking touched code anchors, respected ADRs, tested invariants, and composite risk assessment |
| `muse_reconcile_anchors` | — | Interactively audits, prunes, or updates drifted and orphaned code anchors across memories when code is refactored or deleted |

### Knowledge compounding

| Tool | Required parameters | Description |
| --- | --- | --- |
| `memory_wiki_compile` | `id` | Compile confirmed memories into structured wiki markdown pages |

### Sync, mesh & team

| Tool | Required parameters | Description |
| --- | --- | --- |
| `muse_sync_broadcast` | `packet` | Exports a portable, signed SyncPacket containing confirmed memories, active constraints, and supersessions for P2P gossip sync across peer agents |
| `muse_sync_ingest` | `packet` | Ingests a peer agent's SyncPacket with Vibeguard secret inspection, deduplication, and contradiction resolution |
| `muse_sync_status` | `path` | Inspects peer synchronization status, known peer agents, vector clocks, and pending outgoing knowledge |
| `muse_sync_pool` | `path` | Performs two-way P2P gossip synchronization with an in-process filesystem shared pool folder |
| `muse_mesh_status` | `path` | Inspects multi-repo and monorepo cross-project mesh topology, workspace type, and discovered package stores |
| `muse_mesh_query` | `path` | Queries memories across the entire monorepo or multi-repo cross-project mesh with origin package provenance |
| `muse_mesh_audit` | `path` | Audits monorepo cross-package dependency contracts, entrypoint exports, and cross-repo code anchors |
| `muse_mesh_link` | `path` | Explicitly links or unlinks an external repository or package directory path into the project mesh |

### Onboarding & environment

| Tool | Required parameters | Description |
| --- | --- | --- |
| `memory_detect_providers` | `entries` | Scan the machine and local workspace for existing external memory systems (24+ providers) |
| `memory_detect_agents` | `entries` | Scan the machine for installed coding agents (Claude Code, Cursor, Hermes, OpenCode, OpenClaw, Codex, etc.) |
| `memory_connect` | `entries` | Auto-wire Muse Memory MCP into installed coding agents or a specified agent |
| `memory_migrate` | `entries` | Auto-detect and migrate memories from external providers preserving active/superseded state |
| `graph_status` | `query` | Check the status of the project graph provider (e.g. codegraph) |
| `graph_index` | `query` | Index AST symbols from the project's CodeGraph/Graphify provider and cache in .memory/ |
| `muse_profile_list` | `title`, `context_and_drivers`, `decision`, `consequences` | List all available task-focused MCP profiles (core, coding, debugging, review, architecture, maintenance, full) and their exposed tools |

---

Counts in this file are generated from the same source as [`claims.json`](../claims.json): 115 tools, 7 profiles, 30 import formats, 8 credential rule families.
