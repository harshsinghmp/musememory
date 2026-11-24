/**
 * The MCP tool catalog: every tool this server advertises on `tools/list`.
 *
 * Why this is its own module
 * --------------------------
 * It used to be a ~1,700-line array literal inlined at the top of the
 * `ListTools` handler inside `createServer()`, which made `src/mcp.ts` a
 * 4,000-line file where the protocol surface and the dispatch switch were
 * impossible to read apart. The literal is data, not logic: it belongs next
 * to the schema definitions, not inside a request handler.
 *
 * `src/mcp.ts` imports this array and serves it unchanged, so the wire
 * surface — tool names, order, descriptions and input schemas — is
 * byte-identical to what the inline literal produced. The dispatch `switch`
 * in `createServer()` is untouched.
 *
 * Typed as `Tool[]` (not `as const`) on purpose: the literal used to be
 * contextually typed by the SDK's `ListToolsResult`, and the SDK's `inputSchema`
 * requires `type: "object"` as a literal. A bare array literal would widen
 * `type` to `string` and stop satisfying the SDK type.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
// `memory_core` advertises the tier enum, so the catalog needs the
// canonical list rather than a copy that could drift from src/core.ts.
import { CORE_TIERS } from "../core.ts";

export const MCP_TOOL_CATALOG: Tool[] = [
  {
    name: "memory_read",
    description: "Read a full memory entry by id",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "get_context",
    description: "MANDATORY ON SESSION START: Fetch Top-K relevant memories, active user profile (USER.md), and active hard constraints (CURRENT.md) for prompt injection. MUST be called on the first turn of any task or session.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        project: { type: "string" },
        dir: { type: "string", description: "Optional project workspace directory path" },
        limit: { type: "number" },
        token_budget: { type: "number", description: "Maximum token budget to consume for retrieved context" },
        type: { type: "string" },
        status: { type: "string" },
        verified: { type: "boolean" },
        depth: { type: "string", enum: ["L1", "L2", "L3"], description: "Progressive disclosure tier: L1 = id+title lines, L2 = title+content+tags (default), L3 = full raw entry" },
        tier: { type: "number", description: "Deterministic retrieval tier: 0 (manifest index), 1 (routing set), 2 (bounded bodies, default)" },
        as_of: { type: "string", description: "Bi-temporal point-in-time timestamp (ISO string)" },
        min_veracity: { description: "Minimum provenance veracity class ('user', 'agent', 'external', 'system') or numerical threshold (1.0, 0.7, 0.5, 0.3)" },
      },
    },
  },
  {
    name: "search",
    description: "Ranked search over memory entries",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        project: { type: "string" },
        dir: { type: "string", description: "Optional project workspace directory path" },
        limit: { type: "number" },
        token_budget: { type: "number", description: "Maximum token budget to consume" },
        include_superseded: { type: "boolean" },
        include_conflicted: { type: "boolean", description: "Include memories flagged conflicted by the contradiction engine (excluded by default — known potential falsehoods)" },
        hybrid: { type: "boolean", description: "Use the offline vector+BM25 index (requires 'memory reindex'); falls back to live scoring when absent" },
        type: { type: "string" },
        status: { type: "string" },
        verified: { type: "boolean" },
        as_of: { type: "string", description: "Bi-temporal point-in-time timestamp (ISO string)" },
        at_time: { type: "string", description: "Temporal point-in-time timestamp (default-excludes superseded entries)" },
        min_veracity: { description: "Minimum provenance veracity class ('user', 'agent', 'external', 'system') or numerical threshold (1.0, 0.7, 0.5, 0.3)" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_capture",
    description: "Create a new memory entry with inline secret scan (refuses probable secrets). When type='constraint', automatically appends to CURRENT.md.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Memory content / body text" },
        project: { type: "string", description: "Project name (default: workspace root basename)" },
        dir: { type: "string", description: "Optional project workspace directory path" },
        title: { type: "string", description: "Optional short title (derived from content if omitted)" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization and search" },
        type: { type: "string", description: "Memory type (discovery, decision, constraint, pattern, etc.)" },
        confirmed: { type: "boolean", description: "Whether to mark entry as confirmed (default: false)" },
        source: { type: "string", description: "Origin URI, transcript path, or agent name" },
        evidence: {
          type: "array",
          description: "Supporting evidence items backing this memory",
          items: { type: "object" },
        },
        verification: {
          type: "object",
          description: "Verification metadata (level, method, verified_by, test_command)",
        },
        dedup: { type: "boolean", description: "Whether to run similarity deduplication before write" },
        valid_from: { type: "string", description: "Valid-time start ISO timestamp" },
        valid_to: { type: "string", description: "Valid-time end ISO timestamp" },
        valid_to_exact: { type: "boolean", description: "Whether valid_to is a known exact historical cessation boundary" },
        asserted_at: { type: "string", description: "Belief-time ISO timestamp (when the system recorded this assertion)" },
        src_ts: { type: "string", description: "Original ISO 8601 timestamp of underlying source document or evidence" },
        due_at: { type: "string", description: "Due date or reminder ISO timestamp" },
        expires_at: { type: "string", description: "Expiration ISO timestamp" },
        salience: { type: "number", description: "Initial importance score (0-1)" },
        test_command: { type: "string", description: "Command to verify this memory" },
        trust: {
          type: "string",
          enum: ["trusted", "candidate", "untrusted"],
          description: "Provenance trust tier",
        },
        mem_path: { type: "string", description: "Semantic dotted-path addressing (e.g. 'auth.session.jwt')" },
        idempotency_key: { type: "string", description: "Unique idempotency key to prevent duplicate writes during retries" },
        source_ids: { type: "array", items: { type: "string" }, description: "Referenced citation IDs in sources.json" },
        linked_memory_ids: { type: "array", items: { type: "string" }, description: "Explicit memory IDs to link to this memory entry" },
        session_id: { type: "string", description: "Origin session ID for provenance tracking and self-echo suppression" },
        agent: { type: "string", description: "Origin agent name or identifier" },
      },
      required: ["content"],
    },
  },
  {
    name: "memory_current",
    description: "Read or append active working constraints and hard invariants in CURRENT.md for the active project",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "append"],
          description: "Action: 'get' to read active constraints, 'append' to record a new constraint",
        },
        constraint: {
          type: "string",
          description: "The constraint text to append when action is 'append'",
        },
        project: {
          type: "string",
          description: "Project scope name (defaults to active project)",
        },
        dir: {
          type: "string",
          description: "Optional project workspace directory path",
        },
      },
      required: ["action"],
    },
  },
  {
    // The three tools below were callable through the CallTool switch but
    // absent from the ListTools registry, so a client could never
    // discover them by listing tools. A tool that is not discoverable is
    // a tool that does not exist for every agent that reads the list.
    name: "memory_get_constraints",
    description: "Read the active working constraints and hard invariants recorded in CURRENT.md for the active project",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project scope name (defaults to active project)" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
    },
  },
  {
    name: "memory_set_constraints",
    description: "Append a working constraint or hard invariant to CURRENT.md for the active project",
    inputSchema: {
      type: "object",
      properties: {
        constraint: { type: "string", description: "The constraint text to append" },
        project: { type: "string", description: "Project scope name (defaults to active project)" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
    },
  },
  {
    name: "memory_recall",
    description: "Recall active and confirmed memories for a query, with verification levels and related graph links",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        project: { type: "string" },
        dir: { type: "string", description: "Optional project workspace directory path" },
        limit: { type: "number" },
        token_budget: { type: "number", description: "Maximum token budget to consume" },
        include_superseded: { type: "boolean" },
        include_conflicted: { type: "boolean", description: "Include memories flagged conflicted by the contradiction engine (excluded by default — known potential falsehoods)" },
        type: { type: "string" },
        status: { type: "string" },
        verified: { type: "boolean" },
        min_veracity: { description: "Minimum provenance veracity class ('user', 'agent', 'external', 'system') or numerical threshold (1.0, 0.7, 0.5, 0.3)" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_harvest",
    description: "Distill conversation/text into structured outcome, fix, decision, and failure memories",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Raw text or conversation block to harvest memories from" },
        project: { type: "string", description: "Project name (default: 'default')" },
        confirmed: { type: "boolean", description: "Whether to mark harvested entries as confirmed" },
        all: { type: "boolean", description: "Harvest all detected agent transcripts across workspace" },
        auto: { type: "boolean", description: "Auto-detect and harvest recent transcripts across workspace" },
      },
    },
  },
  {
    name: "memory_confirm",
    description: "Promote a candidate, disputed, or stale entry to confirmed",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_supersede",
    description: "Mark old memory entry superseded by new confirmed memory entry",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The old memory ID to supersede" },
        with: { type: "string", description: "The new confirmed memory ID" },
        new_id: { type: "string", description: "Alias for with" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_lifecycle",
    description: "T-084: Five-verb canonical memory lifecycle mutation (change, end, correct, revert, forget)",
    inputSchema: {
      type: "object",
      properties: {
        verb: {
          type: "string",
          enum: ["change", "end", "correct", "revert", "forget"],
          description: "Lifecycle action to perform",
        },
        id: { type: "string", description: "Target memory ID" },
        replacement: {
          type: "object",
          description: "New memory draft or parameters when verb='change'",
        },
        new_id: { type: "string", description: "Existing memory ID to supersede with when verb='change'" },
        correction: {
          type: "string",
          description: "Corrected content or correction payload when verb='correct'",
        },
        reason: { type: "string", description: "Audit rationale for this lifecycle transition" },
        valid_to: { type: "string", description: "Explicit historical cessation timestamp when verb='end' or 'change'" },
        valid_to_exact: { type: "boolean", description: "Whether the cessation timestamp is an exact historical boundary" },
        hard: { type: "boolean", description: "Whether to execute a hard erasure when verb='forget' (default: false)" },
      },
      required: ["verb", "id"],
    },
  },
  {
    name: "memory_link",
    description: "Two-way link related memory entries",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        related: { type: "array", items: { type: "string" } },
      },
      required: ["id", "related"],
    },
  },
  {
    name: "memory_mark_stale",
    description: "Mark a memory entry stale",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_reject",
    description: "Reject a memory entry",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_delete",
    description: "Soft-delete a memory entry by single point ID (tombstone, reversible via memory_restore). Dry-run by default unless confirm: true or dry_run: false.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Exact single memory ID (point ID only, no wildcards)" },
        reason: { type: "string", description: "Audit reason for tombstoning" },
        dry_run: { type: "boolean", description: "Simulate tombstoning without mutating (default: true)" },
        confirm: { type: "boolean", description: "Set to true to apply deletion" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_restore",
    description:
      "Restore a tombstoned memory entry by ID. Fails on an unknown or never-deleted entry. Set replay=true to rebuild the content from the audit ledger when the row is gone, and apply=true to write it back",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        replay: { type: "boolean" },
        apply: { type: "boolean" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_audit",
    description: "Query the append-only audit trail of memory operations",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string" },
        entry_id: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "memory_import_transcript",
    description: "Ingest a JSONL transcript or raw log into structured outcome and fix memories",
    inputSchema: {
      type: "object",
      properties: {
        transcript: { type: "string", description: "File path or raw JSONL/log content" },
        project: { type: "string" },
        confirmed: { type: "boolean" },
      },
      required: ["transcript"],
    },
  },
  {
    name: "memory_detect_providers",
    description: "Scan the machine and local workspace for existing external memory systems (24+ providers)",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "memory_detect_agents",
    description: "Scan the machine for installed coding agents (Claude Code, Cursor, Hermes, OpenCode, OpenClaw, Codex, etc.)",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "memory_connect",
    description: "Auto-wire Muse Memory MCP into installed coding agents or a specified agent",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Agent ID to connect, or 'all' to auto-detect installed agents" },
        dry_run: { type: "boolean", description: "If true, simulates wiring without writing files" },
        force: { type: "boolean", description: "If true, forces config creation even if agent was not detected" },
      },
    },
  },
  {
    name: "memory_migrate",
    description: "Auto-detect and migrate memories from external providers preserving active/superseded state",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "Optional specific provider ID to migrate (e.g. agentmemory, beads, mem0, letta, everos)" },
        all: { type: "boolean", description: "If true, attempts migration across all known provider definitions" },
        dry_run: { type: "boolean", description: "If true, simulates migration without writing files" },
        overwrite: { type: "boolean", description: "If true, overwrites existing memories with identical titles" },
        project: { type: "string", description: "Default project to assign migrated memories" },
      },
    },
  },
  {
    name: "memory_export",
    description: "Export memory snapshot for agency team synchronization",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "memory_import",
    description: "Import memory snapshot entries into the store",
    inputSchema: {
      type: "object",
      properties: {
        entries: { type: "array", items: { type: "object" } },
        overwrite: { type: "boolean" },
      },
      required: ["entries"],
    },
  },
  {
    name: "confirm_fix",
    description: "Confirm a disputed entry as fixed (disputed -> confirmed)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        resolution: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "record_session",
    description: "Record a session start entry",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        note: { type: "string" },
      },
      required: ["project"],
    },
  },
  {
    name: "memory_checkpoint",
    description: "Record a real-time progress checkpoint or task handoff to CURRENT.md to prevent loss on interruption",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Current active task description" },
        progress: { type: "array", items: { type: "string" }, description: "Steps completed or in progress" },
        status: { type: "string", enum: ["IN-PROGRESS", "COMPLETED", "PAUSED", "IDLE"] },
        agent: { type: "string", description: "Agent identity or role" },
      },
    },
  },
  {
    name: "memory_validate",
    description: "Validate the memory store for schema violations, secrets, broken links, and integrity",
    inputSchema: {
      type: "object",
      properties: {
        dry_run: { type: "boolean" },
      },
    },
  },
  {
    name: "memory_get_user_profile",
    description: "Read the active user profile and preferences (USER.md)",
    inputSchema: {
      type: "object",
      properties: {
        global: { type: "boolean", description: "If true, checks global user profile (~/.memory/USER.md)" },
      },
    },
  },
  {
    name: "memory_set_user_profile",
    description: "Update the user profile and preferences (USER.md) with inline secret scanning",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Markdown formatted profile content" },
        global: { type: "boolean", description: "If true, updates global ~/.memory/USER.md instead of local" },
      },
      required: ["content"],
    },
  },
  {
    name: "memory_search_transcripts",
    description: "Full-text search over conversation transcripts (.jsonl or text) with conversation bookends (start/end) and context window",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or keywords" },
        transcript: { type: "string", description: "File path to .jsonl transcript or raw transcript text" },
        window_size: { type: "number", description: "Number of dialogue turns before and after each match (default: 2)" },
        max_matches: { type: "number", description: "Maximum matching turns to return (default: 5)" },
      },
      required: ["query", "transcript"],
    },
  },
  {
    name: "memory_core",
    description: "Read or edit permanent core memory partitions (CORE.md) with tiers: identity, directives, conventions, context",
    inputSchema: {
      type: "object",
      properties: {
        tier: { type: "string", enum: CORE_TIERS as unknown as string[], description: "Core partition tier" },
        set: { type: "string", description: "Replace the tier's content with this text (secret-scanned)" },
        remove: { type: "boolean", description: "If true, clears the tier's content" },
      },
    },
  },
  {
    name: "memory_consolidate",
    description: "Cluster confirmed memories into scene rollup entries (architecture summaries linked to members); idempotent",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Restrict consolidation to one project" },
        dry_run: { type: "boolean", description: "If true, reports clusters without writing scenes" },
      },
    },
  },
  {
    name: "memory_trace",
    description: "Walk causal pathways (supersedes/superseded_by + related links) from a memory entry as a cycle-safe tree",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Root memory entry id" },
        depth: { type: "number", description: "Maximum traversal depth (default 5)" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_loops",
    description: "Read-only prioritized open-loop report: uncommitted git changes, unmerged branches, stale candidates, disputed entries, and CURRENT.md constraints",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "memory_distill",
    description: "Distill recurring confirmed fix patterns into .agents/skills/<slug>/SKILL.md folders (never overwrites existing skills)",
    inputSchema: {
      type: "object",
      properties: {
        min_count: { type: "number", description: "Minimum cluster size to emit a skill (default 3)" },
        dry_run: { type: "boolean", description: "If true, reports clusters without writing skill folders" },
      },
    },
  },
  {
    name: "memory_distill_route",
    description: "Multi-channel knowledge distillation router: triages memories across system (rules/fixes), content (architecture concepts), and health (contradictions/staleness) lanes with deduplication",
    inputSchema: {
      type: "object",
      properties: {
        force: { type: "boolean", description: "Bypass state deduplication and route all candidate memories" },
        dry_run: { type: "boolean", description: "If true, simulates routing without persisting state or writing drafts" },
      },
    },
  },
  {
    name: "memory_verify",
    description: "Verification oracle: execute a fix entry's test_command; exit 0 promotes candidates to confirmed and stamps independently-verified",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Fix entry id carrying a test_command" },
        timeout: { type: "number", description: "Command timeout in seconds (default 60)" },
      },
      required: ["id"],
    },
  },
  {
    name: "graph_status",
    description: "Check the status of the project graph provider (e.g. codegraph)",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "graph_index",
    description: "Index AST symbols from the project's CodeGraph/Graphify provider and cache in .memory/",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "memory_tree_search",
    description: "Hierarchical tree-indexed reasoning search across partitioned memory shards",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        project: { type: "string", description: "Filter by project" },
        type: { type: "string", description: "Filter by memory type" },
        token_budget: { type: "number", description: "Token budget limit" },
        disclosure_depth: { type: "string", enum: ["L1", "L2", "L3"], description: "Disclosure depth tier" },
        max_nodes: { type: "number", description: "Maximum nodes to return" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_wiki_get",
    description: "Read a compiled wiki page (concept, entity, index, or log)",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Page slug (e.g. 'index', 'log', or concept slug)" },
        type: { type: "string", enum: ["concept", "entity", "index", "log"], description: "Optional page type" },
      },
      required: ["slug"],
    },
  },
  {
    name: "memory_wiki_search",
    description: "List compiled wiki pages with optional filtering",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Filter by project" },
        type: { type: "string", enum: ["concept", "entity", "index", "log"], description: "Filter by page type" },
      },
    },
  },
  {
    name: "memory_wiki_compile",
    description: "Compile confirmed memories into structured wiki markdown pages",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project to compile (omit for all)" },
        dry_run: { type: "boolean", description: "Preview without writing to disk" },
      },
    },
  },
  {
    name: "memory_entities_get",
    description: "Get detailed information about an extracted entity and its relationships",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Entity ID or name" },
        include_related: { type: "boolean", description: "Include related entities in response" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_entities_search",
    description: "List extracted entities by type or project",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["person", "product", "organization", "file", "concept"], description: "Filter by entity type" },
        project: { type: "string", description: "Filter by project" },
      },
    },
  },
  {
    name: "memory_pageindex_index",
    description: "Build a PageIndex-style hierarchical tree index from document/text for reasoning-based retrieval",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Document text content (max 10MB)" },
        project: { type: "string", description: "Project to associate the index with" },
        title: { type: "string", description: "Optional title for the index" },
        maxDepth: { type: "number", description: "Max tree depth (default: 5)" },
        dryRun: { type: "boolean", description: "Preview without persisting" },
      },
      required: ["content", "project"],
    },
  },
  {
    name: "memory_pageindex_search",
    description: "Search a PageIndex tree index with reasoning-based retrieval",
    inputSchema: {
      type: "object",
      properties: {
        indexId: { type: "string", description: "Tree index ID to search" },
        query: { type: "string", description: "Search query" },
        project: { type: "string", description: "Project scope" },
        tokenBudget: { type: "number", description: "Maximum token budget" },
        maxDepth: { type: "number", description: "Max search depth" },
      },
      required: ["indexId", "query"],
    },
  },
  {
    name: "memory_pageindex_import",
    description: "Import PageIndex search results/insights as memory entries",
    inputSchema: {
      type: "object",
      properties: {
        indexId: { type: "string", description: "Tree index ID" },
        query: { type: "string", description: "Search query" },
        project: { type: "string", description: "Project scope" },
        type: { type: "string", description: "Memory type (default: discovery)" },
        confirmed: { type: "boolean", description: "Auto-confirm imported entries" },
      },
      required: ["indexId", "query", "project"],
    },
  },
  {
    name: "memory_disconnect_pageindex",
    description: "Disconnect PageIndex MCP tools and remove associated indexes",
    inputSchema: {
      type: "object",
      properties: {
        indexId: { type: "string", description: "Specific index to remove, or omit for all" },
        project: { type: "string", description: "Project scope" },
      },
    },
  },
  {
    name: "memory_settings_get",
    description: "Read unified global or project configuration settings",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Optional project scope override" },
      },
    },
  },
  {
    name: "memory_settings_set",
    description: "Update unified global or project configuration settings",
    inputSchema: {
      type: "object",
      properties: {
        settings: { type: "object", description: "Settings object to merge" },
        project: { type: "string", description: "Optional project scope override" },
      },
      required: ["settings"],
    },
  },
  {
    name: "memory_drift",
    description: "Scan the local Git workspace for modified or deleted code files and AST symbols referenced by memories. Flags drifted memories for re-verification or supersession.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
    },
  },
  {
    name: "memory_compress",
    description: "Compress formatted prompt context losslessly, stripping header whitespace and boilerplate while preserving all architectural facts.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Markdown prompt context to compress" },
        level: { type: "string", enum: ["light", "aggressive"], description: "Compression aggressiveness level" },
      },
      required: ["text"],
    },
  },
  {
    name: "memory_source_add",
    description: "Record external documentation, research paper, RFC, or URL into the provenance Source Ledger",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        title: { type: "string" },
        source_type: { type: "string", description: "Source classification: primary | secondary | documentation | rfc | repo | article" },
        excerpt: { type: "string", description: "Key quote or summary excerpt from source" },
        author: { type: "string", description: "Author or organization" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["url", "title"],
    },
  },
  {
    name: "memory_source_list",
    description: "List recorded external sources in the Source Ledger",
    inputSchema: {
      type: "object",
      properties: {
        source_type: { type: "string" },
        query: { type: "string" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
    },
  },
  {
    name: "memory_claim_record",
    description: "Record an evidence-backed claim into the Claim Ledger connected to sources and confidence tags ([RAW], [FETCH], [SEARCH], [INFER])",
    inputSchema: {
      type: "object",
      properties: {
        claim: { type: "string" },
        confidence_tag: { type: "string", enum: ["RAW", "FETCH", "SEARCH", "INFER"], description: "Confidence level: RAW (locally verified), FETCH (authoritative URL), SEARCH (synthesized search), INFER (agent deduction)" },
        source_ids: { type: "array", items: { type: "string" } },
        memory_ids: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
        verified: { type: "boolean" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["claim"],
    },
  },
  {
    name: "memory_claim_list",
    description: "List recorded claims in the Claim Ledger",
    inputSchema: {
      type: "object",
      properties: {
        confidence_tag: { type: "string", enum: ["RAW", "FETCH", "SEARCH", "INFER"] },
        query: { type: "string" },
        verified: { type: "boolean" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
    },
  },
  {
    name: "memory_freeze_run",
    description: "Capture an immutable execution snapshot (active task, file inventory, git SHA, CURRENT constraints, memory SHA-256 hashes) in .memory/runs/<run-id>/",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Task instruction text (recorded verbatim, never read as a path)" },
        task_file: {
          type: "string",
          description: "Optional workspace-relative path to a task brief file: confined to the workspace, capped at 64 KiB and secret-redacted. When set, its content becomes the snapshot task.",
        },
        run_id: { type: "string", description: "Optional unique run identifier" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["task"],
    },
  },
  {
    name: "memory_freeze_list",
    description: "List recorded frozen execution snapshots in .memory/runs/",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
    },
  },
  {
    name: "memory_prompt_list",
    description: "List available structured prompt templates in .memory/prompts/",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
    },
  },
  {
    name: "memory_prompt_get",
    description: "Get prompt template by name",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["name"],
    },
  },
  {
    name: "memory_prompt_run",
    description: "Render prompt template with variable substitution and live memory context injection",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        args: { type: "object", description: "Key-value pairs for prompt template variables" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["name"],
    },
  },
  {
    name: "memory_rollup",
    description: "Multi-scale temporal compounding: aggregate atomic memories into weekly, monthly, or quarterly synthesis wiki pages and update HOT.md cache",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", enum: ["week", "month", "quarter"] },
        date: { type: "string", description: "Optional target date (YYYY-MM-DD)" },
        project: { type: "string" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["period"],
    },
  },
  {
    name: "memory_loop_record",
    description: "Record an iteration round in the multi-agent Gauntlet Iteration Ledger (.memory/iterations.jsonl)",
    inputSchema: {
      type: "object",
      properties: {
        iteration_index: { type: "number" },
        critic_verdict: { type: "string", enum: ["pass", "fail", "regressed", "plateaued"] },
        largest_fix_identified: { type: "string" },
        test_results: { type: "string" },
        diff_hash: { type: "string" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["iteration_index", "critic_verdict", "largest_fix_identified", "test_results"],
    },
  },
  {
    name: "memory_loop_status",
    description: "Inspect multi-round iteration status, plateau warnings, and regression signals",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
    },
  },
  {
    name: "memory_verify_strict",
    description: "Execute Strict Integrity & Health Gate: audits zero secrets, referential link integrity, wikilinks, orphaned candidates, and claim sources",
    inputSchema: {
      type: "object",
      properties: {
        max_candidate_days: { type: "number" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
    },
  },
  {
    name: "memory_feedback",
    description: "Record application outcome for a memory (success, failure, or regression) to train utility and calculate memory ROI",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string", description: "ID of the memory entry applied" },
        success: { type: "boolean", description: "Whether the memory successfully solved the task" },
        regression: { type: "boolean", description: "Whether the memory introduced a regression" },
        notes: { type: "string", description: "Optional explanation of outcome" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["memory_id", "success"],
    },
  },
  {
    name: "memory_resolve_conflict",
    description: "Resolve a contradiction between two memories using a deterministic strategy (supersede, historical, reject, or keep_both)",
    inputSchema: {
      type: "object",
      properties: {
        winning_id: { type: "string", description: "ID of the winning memory to establish as valid" },
        losing_id: { type: "string", description: "ID of the conflicting memory to update" },
        strategy: {
          type: "string",
          enum: ["supersede", "historical", "reject", "keep_both"],
          description: "Resolution strategy: 'supersede', 'historical' (preserve as past context), 'reject', or 'keep_both'",
        },
        reason: { type: "string", description: "Architectural or empirical reason for resolution" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["winning_id", "losing_id", "strategy", "reason"],
    },
  },
  {
    name: "memory_roi",
    description: "Calculate memory utility, reuse success rates, and return-on-investment across the store",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Optional project name filter" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
    },
  },
  {
    name: "memory_observe",
    description: "Ingest an ephemeral raw observation (tool output, test error, build log, review feedback) to .memory/observations.jsonl",
    inputSchema: {
      type: "object",
      properties: {
        raw: { type: "string", description: "Raw output, error message, or log snippet" },
        source: {
          type: "string",
          enum: ["tool", "test", "build", "review", "pr", "transcript", "file_edit", "manual"],
          description: "Observation source channel",
        },
        project: { type: "string", description: "Project scope name" },
        summary: { type: "string", description: "Brief one-line summary" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["raw", "source", "project"],
    },
  },
  {
    name: "memory_distill_observations",
    description: "Distill unprocessed raw observations into structured candidate memories and negative lessons",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project scope name" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["project"],
    },
  },
  {
    name: "memory_negative_capture",
    description: "Record a first-class negative memory (DO_NOT_USE, FAILED_APPROACH, BUG_PRONE_PATTERN) to prevent recurring mistakes",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short description of what to avoid" },
        failed_approach: { type: "string", description: "The approach that failed or caused issues" },
        failure_reason: { type: "string", description: "Why it failed or what went wrong" },
        alternative_recommended: { type: "string", description: "What to use or do instead" },
        reproduction_command: { type: "string", description: "Optional reproduction test/build command" },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        project: { type: "string", description: "Project scope name" },
        tags: { type: "array", items: { type: "string" } },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["title", "failed_approach", "failure_reason", "project"],
    },
  },
  {
    name: "memory_code_intel_status",
    description: "Inspect registered code intelligence providers and their workspace availability status",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
    },
  },
  {
    name: "memory_code_intel_symbols",
    description: "Resolve symbols (functions, classes, types) across active code intelligence providers with fallback",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Symbol name or substring query" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_code_intel_blast_radius",
    description: "Calculate ripple effect and blast radius of modifying a symbol or file",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Symbol name or relative file path" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["target"],
    },
  },
  {
    name: "memory_enrich",
    description: "Enrich an existing memory entry with code intelligence symbol evidence",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory entry ID" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_ranked_retrieval",
    description: "Multi-factor ranked retrieval fusing symbol matching, BM25, graph overlap, blast radius, recency, utility ROI, and negative warnings",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or natural language question" },
        project: { type: "string", description: "Optional project scope filter" },
        token_budget: { type: "number", description: "Optional token budget for knapsack packing" },
        active_file_path: { type: "string", description: "Active file path in editor or workspace" },
        target_symbol: { type: "string", description: "Specific symbol of interest" },
        limit: { type: "number", description: "Max results to return (default: 10)" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_compaction_check",
    description: "Evaluate context usage against the 70% threshold and prompt if compaction is needed",
    inputSchema: {
      type: "object",
      properties: {
        used_tokens: { type: "number", description: "Current estimated token usage in session" },
        max_tokens: { type: "number", description: "Maximum model context window (default: 200000)" },
      },
      required: ["used_tokens"],
    },
  },
  {
    name: "memory_compact_handoff",
    description: "Lock the 5 mandatory invariants and write an interruption-proof session handoff to CURRENT.md before context reset",
    inputSchema: {
      type: "object",
      properties: {
        high_level_goal: { type: "string", description: "1. High level goal of your build spec" },
        current_architecture: { type: "string", description: "2. Current architecture and data flow" },
        completed_tasks: { type: "array", items: { type: "string" }, description: "3. What is already implemented and considered done" },
        open_tasks: { type: "array", items: { type: "string" }, description: "4. What is explicitly not done yet" },
        next_concrete_task: { type: "string", description: "5. The next concrete task we are working on" },
        active_constraints: { type: "array", items: { type: "string" }, description: "Optional active constraints" },
        decisions_made: { type: "array", items: { type: "string" }, description: "Optional key decisions made" },
        session_id: { type: "string", description: "Optional session ID" },
        agent: { type: "string", description: "Optional agent name" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["high_level_goal", "current_architecture", "completed_tasks", "open_tasks", "next_concrete_task"],
    },
  },
  {
    name: "memory_harvest_turn",
    description: "Continuous conversational harvester: automatically extract architectural decisions, fixes, and negative lessons from turn text",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Conversational turn text or reasoning" },
        project: { type: "string", description: "Project scope name" },
        agent: { type: "string", description: "Optional agent name" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["text", "project"],
    },
  },
  {
    name: "memory_evaluate_promotion",
    description: "Evaluate a memory entry for promotion along the ladder: LOCAL -> PROJECT -> GLOBAL (5x success rule, zero regressions, zero conflicts, generalization)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID of the memory entry to evaluate" },
        force_manual: { type: "boolean", description: "Whether to evaluate manual promotion bypassing 5x requirement" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_promote",
    description: "Execute promotion of a memory entry (LOCAL -> PROJECT or PROJECT -> GLOBAL) with generalization and audit logging. Can optionally stage in pending tier for session-end flush.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID of the memory entry to promote" },
        force_manual: { type: "boolean", description: "Manual promotion override bypassing automatic 5x threshold" },
        stage_pending: { type: "boolean", description: "Stage promotion in pending tier instead of promoting immediately (T-107 two-tier promotion)" },
        session_id: { type: "string", description: "Optional session ID for scoped pending promotions" },
        generalized_content: { type: "string", description: "Optional custom generalized principle text" },
        agent: { type: "string", description: "Optional agent or actor name" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_flush_pending",
    description: "Two-tier promotion protocol (T-107): Flushes staged pending promotions at session close or manual trigger, executing promotion for qualifying entries.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Optional session ID filter" },
        dry_run: { type: "boolean", description: "Simulate flush without applying promotions" },
        actor: { type: "string", description: "Optional actor name" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
    },
  },
  {
    name: "memory_curate",
    description: "Curator protocol (T-106): appends empirical evidence or application outcomes to an existing memory. Deterministic promotion rules evaluate eligibility and trigger promotion when criteria are satisfied.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID of the memory entry to curate" },
        type: { type: "string", enum: ["raw", "fetch", "search", "infer", "code", "test", "git", "doc", "human", "code_intelligence", "observed", "reproducible"], description: "Type of empirical evidence" },
        source: { type: "string", description: "Source of the evidence (e.g. test runner, git log, developer)" },
        excerpt: { type: "string", description: "Supporting text excerpt or error log" },
        outcome: { type: "string", enum: ["success", "failure", "regression", "neutral"], description: "Application outcome" },
        confidence: { type: "number", description: "Confidence score 0.0-1.0" },
        auto_evaluate: { type: "boolean", description: "Whether to evaluate and execute promotion if criteria are met (default true)" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_generalize",
    description: "Test and preview generalization of memory content: scrubs project-specific paths and extracts universal principles",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Memory text to generalize" },
        project: { type: "string", description: "Optional project name to scrub" },
      },
      required: ["content"],
    },
  },
  {
    name: "memory_archive",
    description: "Transition a memory entry to cold, dormant, or archived tier with reason",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID of the memory entry" },
        tier: { type: "string", enum: ["cold", "dormant", "archived"], description: "Target lifecycle tier" },
        reason: { type: "string", description: "Reason for archiving or transitioning" },
        agent: { type: "string", description: "Optional agent name" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["id", "tier", "reason"],
    },
  },
  {
    name: "memory_rehydrate",
    description: "Restore an archived, dormant, or cold memory back to active/confirmed status upon relevance",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID of the memory entry to rehydrate" },
        score: { type: "number", description: "Relevance score that triggered rehydration (default: 1.0)" },
        reason: { type: "string", description: "Optional rehydration rationale" },
        agent: { type: "string", description: "Optional agent name" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_lifecycle_status",
    description: "Inspect store-wide memory lifecycle metrics: counts across active, cold, dormant, archived, scopes, and promotion readiness",
    inputSchema: {
      type: "object",
      properties: {
        sweep: { type: "boolean", description: "Whether to execute an automatic archival sweep during inspection" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
    },
  },
  {
    name: "memory_anchor_create",
    description: "Create and attach a line-independent structural code anchor to a memory entry (repository, file, module, symbol, route, test)",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string", description: "ID of the memory entry" },
        file_path: { type: "string", description: "Relative file path in workspace" },
        kind: {
          type: "string",
          enum: ["repository", "file", "directory", "module", "symbol", "qualified_symbol", "route", "test", "commit", "pr"],
          description: "Anchor kind (default: symbol if symbol_name provided, else file)",
        },
        symbol_name: { type: "string", description: "Optional symbol name (function, class, interface, method)" },
        qualified_name: { type: "string", description: "Optional qualified symbol name (e.g. Service.method)" },
        provider_metadata: { type: "object", description: "Optional provider external IDs (e.g. CodeGraph node ID)" },
        base_path: { type: "string", description: "Optional base directory for anchor resolution (defaults to workspace root)" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["memory_id", "file_path"],
    },
  },
  {
    name: "memory_anchor_verify",
    description: "Verify all code anchors attached to a memory entry against the live codebase to detect drift or orphaned references",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string", description: "ID of the memory entry to verify" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["memory_id"],
    },
  },
  {
    name: "memory_anchor_audit",
    description: "Run repository-wide audit of all code anchors across all memories: reports integrity score, valid, drifted, and orphaned counts",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Optional project workspace directory path" },
        project: { type: "string", description: "Optional memory project scope filter" },
      },
    },
  },
  {
    name: "muse_context",
    description: "FLAGSHIP UNIFIED CONTEXT ORCHESTRATOR: Single-call fusion of active constraints, ranked memories, code anchors, and negative lessons under a strict token budget with actionable next steps.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or task description" },
        active_file: { type: "string", description: "Relative file path being edited" },
        symbol: { type: "string", description: "Symbol name being edited or referenced" },
        error_message: { type: "string", description: "Error message or stack trace if debugging" },
        task_intent: {
          type: "string",
          enum: ["feature", "bugfix", "refactor", "review", "architecture", "general"],
          description: "Intent of current task",
        },
        token_budget: { type: "number", description: "Maximum token budget to consume (default: 4000)" },
        project: { type: "string", description: "Optional project filter" },
        dir: { type: "string", description: "Optional project workspace directory path" },
        include_drifted: {
          type: "boolean",
          description: "Include memories whose code anchors have drifted (default false: they are withheld by the freshness gate and reported instead)",
        },
        session_id: { type: "string", description: "Optional session ID for 6-turn re-injection suppression and LRU tracking" },
        turn: { type: "number", description: "Optional 1-indexed turn number within the session" },
        suppress_reinjected: { type: "boolean", description: "Whether to suppress re-injecting recently seen memories (default: true if session_id provided)" },
        suppress_self_echo: { type: "boolean", description: "Whether to suppress self-echoes created by active session/agent within echo horizon (default: true)" },
        echo_horizon_ms: { type: "number", description: "Self-echo horizon in ms (default: 600000 / 10 minutes)" },
        agent: { type: "string", description: "Caller agent name for provenance self-echo matching" },
        suppress_seen_chunks: { type: "boolean", description: "Whether to suppress memories already served within their TTL window" },
        seen_chunk_ttl_ms: { type: "number", description: "Seen-chunk TTL in ms (default: 300000 / 5 minutes)" },
        check_topic_overlap: { type: "boolean", description: "Whether to skip prefetch and reuse cached context when topic overlap > 0.6" },
        topic_overlap_threshold: { type: "number", description: "Custom topic overlap threshold (default: 0.6)" },
        enable_trivial_gate: { type: "boolean", description: "Whether to bypass memory recall for trivial greetings or pleasantries (default: true)" },
      },
    },
  },
  {
    name: "muse_code_for_memory",
    description: "Bidirectional lookup: Given a memory ID, return all anchored code references, files, and symbols",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string", description: "ID of the memory entry" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["memory_id"],
    },
  },
  {
    name: "muse_memory_for_code",
    description: "Bidirectional lookup: Given a file path or symbol, return all associated memories, architectural decisions, bug fixes, constraints, and negative lessons",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Relative file path in workspace" },
        symbol_name: { type: "string", description: "Optional symbol name" },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "muse_profile_list",
    description: "List all available task-focused MCP profiles (core, coding, debugging, review, architecture, maintenance, full) and their exposed tools",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "memory_adr_record",
    description: "Record a first-class Architecture Decision Record (ADR) as an active, queryable memory with drivers, decision, consequences, options, and code anchors",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the architectural decision" },
        context_and_drivers: {
          type: "array",
          items: { type: "string" },
          description: "Key architectural context and problem drivers",
        },
        decision: { type: "string", description: "The architectural decision made" },
        consequences: {
          type: "object",
          properties: {
            positive: { type: "array", items: { type: "string" } },
            negative: { type: "array", items: { type: "string" } },
            neutral: { type: "array", items: { type: "string" } },
          },
          description: "Positive, negative (trade-offs), and operational consequences",
        },
        options_considered: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              pros: { type: "array", items: { type: "string" } },
              cons: { type: "array", items: { type: "string" } },
              rejected_reason: { type: "string" },
            },
          },
          description: "Alternative options considered and why they were rejected",
        },
        affected_files: { type: "array", items: { type: "string" }, description: "Affected source file paths" },
        affected_symbols: { type: "array", items: { type: "string" }, description: "Affected symbol names" },
        supersedes: { type: "string", description: "Optional ID of superseded ADR" },
        status: { type: "string", enum: ["proposed", "accepted", "superseded", "rejected"], description: "ADR status (default: accepted)" },
        project: { type: "string", description: "Project name" },
        tags: { type: "array", items: { type: "string" } },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
      required: ["title", "context_and_drivers", "decision", "consequences"],
    },
  },
  {
    name: "memory_adr_list",
    description: "List all Architecture Decision Records (ADRs) recorded in the memory store, optionally filtered by status",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["proposed", "accepted", "superseded", "rejected"] },
        dir: { type: "string", description: "Optional project workspace directory path" },
      },
    },
  },
  {
    name: "memory_drift_audit",
    description: "Run bidirectional documentation <-> code drift audit: verifies if documented decisions are implemented in code and flags missing/stale/conflicting code or docs",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Optional project workspace directory path" },
        project: { type: "string", description: "Optional memory project scope filter" },
      },
    },
  },
  {
    name: "muse_why",
    description: "Autonomous Engineering Cognition: Explain WHY code was designed or modified the way it is by tracing historical bug fixes, ADRs, trade-offs, and invariants",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Target concept, component, file name, or symbol" },
        file_path: { type: "string", description: "Optional specific file path" },
        symbol_name: { type: "string", description: "Optional specific symbol name" },
        dir: { type: "string", description: "Optional workspace directory" },
      },
      required: ["target"],
    },
  },
  {
    name: "muse_bug_clusters",
    description: "Analyze and cluster recurring bug fixes, negative lessons, and failures into architectural fragility hotspots with root-cause hypotheses",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Optional workspace directory" },
        project: { type: "string", description: "Optional memory project scope filter" },
      },
    },
  },
  {
    name: "muse_tech_debt",
    description: "Scan repository and memory store for technical debt indicators (TODO/FIXME/HACK, unsafe 'as any' casts, drifted code anchors) and generate refactoring priorities",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Optional workspace directory" },
        project: { type: "string", description: "Optional memory project scope filter" },
      },
    },
  },
  {
    name: "muse_health",
    description: "Unified 5-Pillar Project Health Gate: audit memory store integrity, code anchor validity, documentation drift, anti-pattern sentry, and technical debt with overall grade (A-F) and pass/fail gate status",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Optional workspace directory path" },
        project: { type: "string", description: "Optional memory project scope filter" },
      },
    },
  },
  {
    name: "muse_preflight",
    description: "Read-only pre-flight: anchored invariants, blast-radius risk and a token-budgeted context pack for the files about to be edited",
    inputSchema: {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string" }, description: "Files about to be edited" },
        symbols: { type: "array", items: { type: "string" }, description: "Symbols about to change" },
        branch: { type: "string", description: "Current branch name" },
        project: { type: "string", description: "Optional project scope" },
        budget: { type: "number", description: "Whole-pack token budget (default 800); measured over the final markdown, not just entries" },
        dir: { type: "string", description: "Optional workspace directory path" },
      },
    },
  },
  {
    name: "muse_episodes",
    description: "Recall recent episodic narratives (goal → hypothesis → trajectory → verification → retrospective) built from observations",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum episodes to return (default 5)" },
        session_id: { type: "string", description: "Optional session filter" },
        dir: { type: "string", description: "Optional workspace directory path" },
      },
    },
  },
  {
    name: "muse_playbook_recall",
    description: "Recall procedural playbooks: list by tag, or fetch one by id/title",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Playbook id or title" },
        tag: { type: "string", description: "Optional tag filter" },
        dir: { type: "string", description: "Optional workspace directory path" },
      },
    },
  },
  {
    name: "muse_playbook_record",
    description: "Save a playbook trajectory, or record success/failure for an existing playbook",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Existing playbook id/title (for outcome recording)" },
        title: { type: "string" },
        goal: { type: "string" },
        steps: { type: "array", items: { type: "object" } },
        preconditions: { type: "array", items: { type: "string" } },
        verification: { type: "array", items: { type: "string" } },
        rollback: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
        success: { type: "boolean", description: "Record a successful run" },
        dir: { type: "string", description: "Optional workspace directory path" },
      },
      // D4: this tool has two modes, so a flat `required` would be wrong
      // for one of them. Declare each mode's minimum instead: recording an
      // outcome needs id + success; saving needs title + goal + one step.
      // The handler still validates at runtime — this tells MCP clients
      // what to send rather than making them discover it from an error.
      anyOf: [
        { required: ["id", "success"] },
        { required: ["title", "goal", "steps"] },
      ],
    },
  },
  {
    name: "muse_sync_broadcast",
    description: "Exports a portable, signed SyncPacket containing confirmed memories, active constraints, and supersessions for P2P gossip sync across peer agents",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Optional local agent identity (e.g. sol, jasper, nexus)" },
        project: { type: "string", description: "Optional project scope filter" },
        limit: { type: "number", description: "Optional maximum number of memories to include" },
        dir: { type: "string", description: "Optional workspace directory" },
      },
    },
  },
  {
    name: "muse_sync_ingest",
    description: "Ingests a peer agent's SyncPacket with Vibeguard secret inspection, deduplication, and contradiction resolution",
    inputSchema: {
      type: "object",
      properties: {
        packet: { type: "object", description: "The SyncPacket object received from peer agent" },
        agent_id: { type: "string", description: "Optional local agent identity" },
        dir: { type: "string", description: "Optional workspace directory" },
      },
      required: ["packet"],
    },
  },
  {
    name: "muse_sync_status",
    description: "Inspects peer synchronization status, known peer agents, vector clocks, and pending outgoing knowledge",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Optional local agent identity" },
        dir: { type: "string", description: "Optional workspace directory" },
      },
    },
  },
  {
    name: "muse_sync_pool",
    description: "Performs two-way P2P gossip synchronization with an in-process filesystem shared pool folder",
    inputSchema: {
      type: "object",
      properties: {
        pool_dir: { type: "string", description: "Optional custom shared pool directory path" },
        agent_id: { type: "string", description: "Optional local agent identity" },
        dir: { type: "string", description: "Optional workspace directory" },
      },
    },
  },
  {
    name: "muse_mesh_status",
    description: "Inspects multi-repo and monorepo cross-project mesh topology, workspace type, and discovered package stores",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Optional workspace directory to scan" },
      },
    },
  },
  {
    name: "muse_mesh_query",
    description: "Queries memories across the entire monorepo or multi-repo cross-project mesh with origin package provenance",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or keyword" },
        projects: { type: "array", items: { type: "string" }, description: "Optional filter by project or package names" },
        types: { type: "array", items: { type: "string" }, description: "Optional filter by memory types" },
        limit: { type: "number", description: "Max results to return (default 20)" },
        dir: { type: "string", description: "Optional workspace directory" },
      },
    },
  },
  {
    name: "muse_mesh_audit",
    description: "Audits monorepo cross-package dependency contracts, entrypoint exports, and cross-repo code anchors",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Optional workspace directory" },
      },
    },
  },
  {
    name: "muse_mesh_link",
    description: "Explicitly links or unlinks an external repository or package directory path into the project mesh",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["link", "unlink"], description: "Action to perform ('link' or 'unlink')" },
        path: { type: "string", description: "Absolute or relative target directory path to link/unlink" },
        confirm: { type: "boolean", description: "Set to true to apply the link change (required: linking grants this workspace read access to the target's memory store)" },
        dir: { type: "string", description: "Optional workspace directory" },
      },
      required: ["path"],
    },
  },
  {
    name: "muse_code_impact",
    description: "Evaluates comprehensive code and memory impact before editing: callers, test suites, ADRs, negative warnings, active constraints, and composite risk level",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Target source file path to analyze" },
        symbol_name: { type: "string", description: "Optional specific function, class, or symbol name" },
        dir: { type: "string", description: "Optional workspace directory" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "muse_pr_context",
    description: "Generates rich GitHub PR descriptions from git diff linking touched code anchors, respected ADRs, tested invariants, and composite risk assessment",
    inputSchema: {
      type: "object",
      properties: {
        base_branch: { type: "string", description: "Base git branch to diff against (default: 'main')" },
        dir: { type: "string", description: "Optional workspace directory" },
      },
    },
  },
  {
    name: "muse_reconcile_anchors",
    description: "Interactively audits, prunes, or updates drifted and orphaned code anchors across memories when code is refactored or deleted",
    inputSchema: {
      type: "object",
      properties: {
        prune: { type: "boolean", description: "Whether to prune orphaned anchors (default: false)" },
        mark_stale: { type: "boolean", description: "Whether to mark memories stale if all anchors are orphaned (default: false)" },
        update_hashes: { type: "boolean", description: "Whether to update structural hashes for drifted anchors (default: false)" },
        dry_run: { type: "boolean", description: "Whether to simulate without saving changes (default: true)" },
        dir: { type: "string", description: "Optional workspace directory" },
      },
    },
  },
  {
    name: "memory_test_feedback",
    description: "Bind a real test run to the memories that were applied: green runs reinforce them, red runs record a failed application and a regression strike for anchor-relevant memories. Returns the parsed run plus regression-sentry matches.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The test command that ran (e.g. 'bun test')" },
        exit_code: { type: "number", description: "The real process exit code" },
        stdout: { type: "string", description: "Captured stdout (optional; helps failure matching)" },
        stderr: { type: "string", description: "Captured stderr (optional)" },
        memory_ids: { type: "array", items: { type: "string" }, description: "Memories that were applied during the work" },
        project: { type: "string", description: "Optional project scope" },
        session_id: { type: "string", description: "Optional session id (deduplicates regression strikes)" },
        actor: { type: "string", description: "Optional actor label" },
        dir: { type: "string", description: "Optional workspace directory path" },
      },
      required: ["command", "exit_code"],
    },
  },
  {
    name: "muse_regression_sentry",
    description: "Read-only: match failing tests against recorded BUG_PRONE_PATTERN / DO_NOT_USE / failed-approach memories and return remediation playbooks",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Optional test command for anchor/reproduction matching" },
        exit_code: { type: "number", description: "Exit code (default 1 when failures are supplied)" },
        stdout: { type: "string", description: "Captured test output to parse when failures are not supplied" },
        stderr: { type: "string", description: "Captured test error output" },
        failures: { type: "array", items: { type: "object" }, description: "Optional explicit failures: [{name, message?, file?}]" },
        project: { type: "string", description: "Optional project scope" },
        limit: { type: "number", description: "Maximum matches (default 20)" },
        dir: { type: "string", description: "Optional workspace directory path" },
      },
    },
  },
  {
    name: "muse_flaky_tests",
    description: "Read-only: flaky tests, failure bursts and dependency-file drift derived from recorded test_feedback runs",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Optional project scope" },
        window_hours: { type: "number", description: "Dependency-drift lookback in hours (default 24)" },
        gap_minutes: { type: "number", description: "Max gap between failures in one burst (default 45)" },
        min_failures: { type: "number", description: "Minimum failing runs per burst (default 3)" },
        dir: { type: "string", description: "Optional workspace directory path" },
      },
    },
  },
  {
    name: "muse_remediation_playbooks",
    description: "Read-only: synthesize remediation playbook candidates from recurring, resolved test failures (nothing is persisted)",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Optional project scope" },
        min_recurrences: { type: "number", description: "Minimum recorded failures (default 2)" },
        limit: { type: "number", description: "Maximum audit events to inspect" },
        dir: { type: "string", description: "Optional workspace directory path" },
      },
    },
  },
  {
    name: "muse_enclave_recall",
    description: "Read-only: decrypt and return entries from one client enclave vault. Requires an explicit client; every read is audit-logged.",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string", description: "Client enclave name (required)" },
        division: { type: "string", description: "Optional division/vault name (default 'default')" },
        id: { type: "string", description: "Optional entry id to fetch a single record" },
        limit: { type: "number", description: "Maximum entries to return (default 50, max 200)" },
        dir: { type: "string", description: "Optional workspace directory path" },
      },
      required: ["client"],
    },
  },
  {
    name: "muse_overlay_status",
    description: "Read-only: list branch memory overlays and their entry counts, or inspect one branch overlay's entries",
    inputSchema: {
      type: "object",
      properties: {
        branch: { type: "string", description: "Optional branch to inspect; omit to list all overlays" },
        dir: { type: "string", description: "Optional workspace directory path" },
      },
    },
  },
  {
    name: "muse_attestation_verify",
    description: "Read-only: verify an Ed25519 packet attestation or an attestation chain against an inline public key",
    inputSchema: {
      type: "object",
      properties: {
        packet: { type: "object", description: "The signed SyncPacket (required for a single attestation)" },
        attestation: { type: "object", description: "The attestation record to verify" },
        chain: { type: "array", items: { type: "object" }, description: "An attestation chain to verify instead of a single record" },
        public_key: { type: "string", description: "Inline PEM public key (required)" },
        key_id: { type: "string", description: "Optional pinned key id" },
        audience: { type: "string", description: "Optional expected audience" },
        require_head: { type: "boolean", description: "Require a signed head in a chain (default true)" },
      },
      required: ["public_key"],
    },
  },
];
