import { basename } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { findOrCreateProjectRoot, getGlobalMemoryDir } from "./root.ts";
import {
  openStore,
  get,
  save,
  propose,
  confirm,
  supersede,
  link,
  markStale,
  reject,
  deleteEntry,
  harvestMemories,
  type Store,
} from "./store.ts";
import { queryContext, formatPromptContext } from "./retrieval.ts";
import { getCurrent, setCurrent, syncConstraints, updateSessionHandoff } from "./governor.ts";
import { consolidateScenes } from "./consolidate.ts";
import { traceGraph } from "./trace.ts";
import { collectLoops } from "./loops.ts";
import { distillSkills } from "./distill.ts";
import { verifyEntry } from "./verify.ts";
import { hybridSearch } from "./vector.ts";
import { recordSessionStart } from "./sessions.ts";
import { validateStore } from "./schema.ts";
import { getGraphStatus, indexGraph } from "./graph.ts";
import { importTranscript } from "./harvest.ts";
import { exportSnapshot, importSnapshot } from "./snapshot.ts";
import { searchTranscriptWithBookends } from "./transcript.ts";
import { getUserProfile, setUserProfile } from "./user.ts";
import { CORE_TIERS, readCore, setCore, removeCore, type CoreTier } from "./core.ts";
import { getAuditTrail } from "./audit.ts";
import { detectProviders, runMigration } from "./migrator/index.ts";
import { detectAgents } from "./agents/detect.ts";
import { connectAgent } from "./connect.ts";
import { RetrievalEngine, buildTreeIndex, loadTreeIndex, searchTree } from "./retrieval/index.ts";
import { compileWiki, listWikiPages, getWikiPage } from "./wiki/index.ts";
import { extractEntitiesFromMemories, saveEntities, loadEntities, findEntity, findRelatedEntities } from "./entities/index.ts";
import { buildPageIndex, searchPageIndex, loadPageIndex, listPageIndexes, deletePageIndex } from "./pageindex/index.ts";
import { getSettings, setSettings, getProjectSettings, setProjectSettings } from "./settings.ts";
import { addSource, listSources, getSource } from "./provenance.ts";
import { recordClaim, listClaims, getClaim } from "./claims.ts";
import { freezeExecutionSnapshot, listExecutionSnapshots } from "./snapshot.ts";
import { listPrompts, getPrompt, renderPrompt } from "./prompts.ts";
import { rollupTemporal } from "./compounding/temporal.ts";
import { recordIteration, detectIterationStatus } from "./iterations.ts";
import { verifyStrictIntegrity } from "./verify.ts";
import { queryTieredContext, type RetrievalTier } from "./retrieval/tiered.ts";
import type { MemoryEntry, MemoryType } from "./types.ts";

export function createServer(targetDir?: string): Server {
  const resolvedTarget = targetDir || process.env.MUSE_MEMORY_PROJECT_DIR || process.env.PROJECT_ROOT || process.cwd();
  const { root, memoryDir } = findOrCreateProjectRoot(resolvedTarget);
  const store = openStore(memoryDir);

  function resolveStoreForRequest(a?: Record<string, unknown>): { activeStore: Store; activeMemoryDir: string; activeRoot: string } {
    const dir = a?.dir || a?.workspace || a?.project_dir || a?.cwd;
    if (typeof dir === "string" && dir.trim()) {
      const resolved = findOrCreateProjectRoot(dir.trim());
      return {
        activeStore: openStore(resolved.memoryDir),
        activeMemoryDir: resolved.memoryDir,
        activeRoot: resolved.root,
      };
    }
    return { activeStore: store, activeMemoryDir: memoryDir, activeRoot: root };
  }

  const server = new Server(
    { name: "musememory", version: "1.6.0" },
    {
      capabilities: { tools: {}, logging: {} },
      instructions: `MUSE MEMORY PROTOCOL:
You are equipped with Muse Memory, an autonomous persistent cognitive memory system.
1. SESSION START / FIRST TURN: You MUST call 'get_context' on your very first turn in any conversation or task. This loads the user's role profile (USER.md), active working constraints (CURRENT.md), and relevant past decisions/fixes.
2. WORKING CONSTRAINTS: When hard constraints, open loops, or project invariants are established or modified, immediately record them to CURRENT.md via 'memory_capture' (type='constraint') or 'memory_current'.
3. CONTINUOUS KNOWLEDGE CAPTURE: Whenever you resolve a bug, make an architectural decision, or establish a project convention, immediately call 'memory_capture' to persist it.
4. RETRIEVAL & VERIFICATION: Call 'search' or 'memory_tree_search' to inspect historical context. Call 'memory_supersede' when replacing outdated knowledge.`,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
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
            hybrid: { type: "boolean", description: "Use the offline vector+BM25 index (requires 'memory reindex'); falls back to live scoring when absent" },
            type: { type: "string" },
            status: { type: "string" },
            verified: { type: "boolean" },
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
            content: { type: "string" },
            project: { type: "string" },
            dir: { type: "string", description: "Optional project workspace directory path" },
            title: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            type: { type: "string" },
            confirmed: { type: "boolean" },
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
        name: "memory_harvest",
        description: "Distill conversation/text into structured outcome, fix, decision, and failure memories",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
            project: { type: "string" },
            confirmed: { type: "boolean" },
          },
          required: ["text", "project"],
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
        description: "Permanently delete a memory entry by ID and record audit event",
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
        description: "Scan the machine for 80+ coding agents (Claude Code, Cursor, Hermes, OpenCode, OpenClaw, Codex, etc.)",
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
            task: { type: "string", description: "Task description or path to task markdown file" },
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
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;
    const { activeStore, activeMemoryDir, activeRoot } = resolveStoreForRequest(a);

    try {
      switch (name) {
        case "memory_read": {
          const entry = get(activeStore, String(a.id));
          if (!entry) return toolError(`no entry with id ${a.id}`);
          return toolResult(entry);
        }
        case "get_context": {
          const queryStr = String(a.query ?? "");
          if (queryStr && activeMemoryDir) {
            try {
              updateSessionHandoff(activeMemoryDir, {
                status: "IN-PROGRESS",
                lastQuery: queryStr,
                agent: a.agent ? String(a.agent) : process.env.AGENT_NAME || "AI Assistant",
                task: a.task ? String(a.task) : queryStr,
              });
            } catch {}
          }
          const tierOpt = typeof a.tier === "number" ? (a.tier as RetrievalTier) : undefined;
          const formatted = tierOpt !== undefined
            ? queryTieredContext(activeStore, activeMemoryDir, queryStr, {
                limit: typeof a.limit === "number" ? a.limit : 5,
                tokenBudget: typeof a.token_budget === "number" ? a.token_budget : undefined,
                project: a.project ? String(a.project) : undefined,
                includeSuperseded: false,
                type: a.type ? String(a.type) : undefined,
                status: a.status ? String(a.status) : undefined,
                verified: a.verified === true,
                tier: tierOpt,
              })
            : formatPromptContext(activeStore, activeMemoryDir, queryStr, {
                limit: typeof a.limit === "number" ? a.limit : 5,
                tokenBudget: typeof a.token_budget === "number" ? a.token_budget : undefined,
                project: a.project ? String(a.project) : undefined,
                includeSuperseded: false,
                type: a.type ? String(a.type) : undefined,
                status: a.status ? String(a.status) : undefined,
                verified: a.verified === true,
                depth: a.depth ? (String(a.depth) as "L1" | "L2" | "L3") : undefined,
              });

          // Record Hebbian co-activation on retrieved memory units (SOW-204)
          if (formatted.entries.length >= 2 && activeMemoryDir) {
            try {
              const { recordCoActivation } = await import("./plasticity.ts");
              recordCoActivation(formatted.entries.map((e) => e.entry.id), activeMemoryDir);
            } catch {}
          }

          // Auto-harvest recent agent transcripts in background (non-blocking)
          if (activeMemoryDir) {
            try {
              const { harvestAllAgentTranscripts } = await import("./harvester.ts");
              harvestAllAgentTranscripts(activeStore, { memoryDir: activeMemoryDir, maxFiles: 3 });
            } catch {}
          }

          let finalMarkdown = formatted.markdown;
          if (a.compress === true) {
            const { compressPromptContext } = await import("./compress.ts");
            finalMarkdown = compressPromptContext(finalMarkdown).compressed;
          }

          return toolResult({
            markdown: finalMarkdown,
            entries: formatted.entries.map((r) => ({ ...r.entry, score: r.score })),
            total_tokens_used: formatted.totalTokensUsed,
            constraints: formatted.constraints,
            user_profile: formatted.userProfile,
          });
        }
        case "memory_checkpoint": {
          try {
            const handoff = updateSessionHandoff(activeMemoryDir, {
              status: (a.status ? String(a.status).toUpperCase() : "IN-PROGRESS") as any,
              task: a.task ? String(a.task) : undefined,
              agent: a.agent ? String(a.agent) : process.env.AGENT_NAME || "AI Agent",
              progress: Array.isArray(a.progress) ? a.progress.map(String) : undefined,
            });
            return toolResult({ success: true, handoff });
          } catch (err: unknown) {
            return toolError(err instanceof Error ? err.message : String(err));
          }
        }
        case "memory_current":
        case "memory_get_constraints":
        case "memory_set_constraints": {
          const action = a.action || (name === "memory_set_constraints" ? "append" : "get");
          if (action === "append" || a.constraint) {
            const text = String(a.constraint || a.text || "");
            if (!text.trim()) return toolError("Missing constraint text to append");
            const projectName = a.project ? String(a.project) : basename(activeRoot) || "default";
            const updated = setCurrent(activeMemoryDir, text, projectName);
            syncConstraints(activeMemoryDir, activeStore);
            return toolResult({ success: true, updated_constraints: updated });
          }
          const constraints = syncConstraints(activeMemoryDir, activeStore);
          return toolResult({ constraints });
        }
        case "memory_recall":
        case "search": {
          const mode = a.hybrid === true ? "hybrid" : a.tree === true ? "tree" : "auto";
          const res = RetrievalEngine.search(activeStore, activeMemoryDir, String(a.query), {
            mode,
            limit: typeof a.limit === "number" ? a.limit : 10,
            tokenBudget: typeof a.token_budget === "number" ? a.token_budget : undefined,
            includeSuperseded: a.include_superseded === true,
            type: a.type ? String(a.type) : undefined,
            status: a.status ? String(a.status) : undefined,
            verified: a.verified === true,
          });
          return toolResult({
            results: res.results.map((r) => ({ ...r.entry, score: r.score })),
            source: res.mode,
            stale: false,
            total_tokens_used: res.totalTokensUsed,
            explanation: res.explanation,
          });
        }
        case "propose":
        case "memory_capture": {
          const projectName = a.project ? String(a.project) : basename(activeRoot) || "default";
          try {
            const entry = propose(activeStore, {
              content: String(a.content),
              project: projectName,
              title: a.title ? String(a.title) : undefined,
              tags: Array.isArray(a.tags) ? a.tags.map(String) : undefined,
              type: a.type ? (String(a.type) as MemoryType) : undefined,
              confirmed: a.confirmed === true,
            });
            if (a.type === "constraint") {
              try {
                setCurrent(activeMemoryDir, String(a.content), projectName);
              } catch {}
            }
            if (activeMemoryDir) {
              try {
                updateSessionHandoff(activeMemoryDir, {
                  discoveries: [String(a.title || a.content || "")],
                });
              } catch {}
            }
            return toolResult(entry);
          } catch (err: unknown) {
            return toolError(err instanceof Error ? err.message : String(err));
          }
        }
      case "memory_harvest": {
        if (a.all === true || a.auto === true || !a.text) {
          const { harvestAllAgentTranscripts } = await import("./harvester.ts");
          const harvestRes = harvestAllAgentTranscripts(activeStore, {
            memoryDir: activeMemoryDir,
            confirmed: a.confirmed === true,
            project: a.project ? String(a.project) : undefined,
          });
          return toolResult(harvestRes);
        }
        const created = harvestMemories(activeStore, {
          text: String(a.text),
          project: String(a.project || "default"),
          confirmed: a.confirmed === true,
        });
        return toolResult({ harvested_count: created.length, entries: created });
      }
      case "memory_import_transcript": {
        const transcript = String(a.transcript);
        const project = a.project ? String(a.project) : undefined;
        const isConfirmed = a.confirmed === true;
        const res = importTranscript(activeStore, transcript, { project, confirmed: isConfirmed });
        return toolResult(res);
      }
      case "memory_confirm": {
        const entry = confirm(activeStore, String(a.id));
        if (!entry) return toolError(`could not confirm ${a.id} (not found or invalid status transition)`);
        return toolResult(entry);
      }
      case "memory_supersede": {
        const oldId = String(a.id);
        const newId = String(a.with ?? a.new_id ?? "");
        if (!newId) return toolError("memory_supersede requires 'with' or 'new_id' parameter");
        const entry = supersede(activeStore, oldId, newId);
        if (!entry) return toolError(`could not supersede ${oldId} with ${newId} (missing entry or target not confirmed)`);
        return toolResult(entry);
      }
      case "memory_link": {
        const related = Array.isArray(a.related) ? a.related.map(String) : [];
        const entry = link(activeStore, String(a.id), related);
        if (!entry) return toolError(`could not link ${a.id} (missing id or related id)`);
        return toolResult(entry);
      }
      case "memory_mark_stale": {
        const entry = markStale(activeStore, String(a.id), a.reason ? String(a.reason) : undefined);
        if (!entry) return toolError(`no entry with id ${a.id}`);
        return toolResult(entry);
      }
      case "memory_reject": {
        const entry = reject(activeStore, String(a.id));
        if (!entry) return toolError(`no entry with id ${a.id}`);
        return toolResult(entry);
      }
      case "memory_delete": {
        const id = String(a.id);
        const reason = a.reason ? String(a.reason) : undefined;
        const ok = deleteEntry(activeStore, id, reason, "mcp_agent");
        if (!ok) return toolError(`no entry found with id ${id}`);
        return toolResult({ success: true, deleted_id: id });
      }
      case "memory_audit": {
        const trail = getAuditTrail(activeMemoryDir, {
          operation: a.operation ? String(a.operation) : undefined,
          entryId: a.entry_id ? String(a.entry_id) : undefined,
          limit: typeof a.limit === "number" ? a.limit : 50,
        });
        return toolResult({ total: trail.length, entries: trail });
      }
      case "memory_export": {
        const snapshot = exportSnapshot(activeStore);
        return toolResult(snapshot);
      }
      case "memory_import": {
        const entries = (a.entries ?? []) as MemoryEntry[];
        const res = importSnapshot(activeStore, { entries }, { overwrite: a.overwrite === true });
        return toolResult(res);
      }
      case "confirm_fix": {
        const entry = get(activeStore, String(a.id));
        if (!entry) return toolError(`no entry with id ${a.id}`);
        if (entry.status !== "disputed") return toolError(`entry ${a.id} is not disputed`);
        const updated = confirm(activeStore, entry.id);
        if (!updated) return toolError(`no entry with id ${a.id}`);
        if (a.resolution) {
          updated.content = `${updated.content}\n\nResolution: ${String(a.resolution)}`;
          save(activeStore, updated);
        }
        return toolResult(updated);
      }
      case "record_session": {
        const { entry, sessionId } = recordSessionStart(activeStore, String(a.project), a.note ? String(a.note) : undefined);
        return toolResult({ ...entry, sessionId });
      }
      case "memory_validate": {
        const report = validateStore(activeStore);
        return toolResult(report);
      }
      case "memory_core": {
        const tier = a.tier ? (String(a.tier) as CoreTier) : undefined;
        if (tier && !(CORE_TIERS as readonly string[]).includes(tier)) {
          return toolError(`unknown core tier "${tier}" (expected: ${CORE_TIERS.join("|")})`);
        }
        try {
          if (tier && a.set !== undefined) {
            const tiers = setCore(activeMemoryDir, tier, String(a.set));
            return toolResult({ tier, lines: tiers[tier] });
          }
          if (tier && a.remove === true) {
            const tiers = removeCore(activeMemoryDir, tier);
            return toolResult({ tier, lines: tiers[tier] });
          }
          if (tier) {
            return toolResult({ tier, lines: readCore(activeMemoryDir)[tier] });
          }
          return toolResult(readCore(activeMemoryDir));
        } catch (err: unknown) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }
      case "memory_consolidate": {
        const report = consolidateScenes(activeStore, {
          project: a.project ? String(a.project) : undefined,
          dryRun: a.dry_run === true,
        });
        return toolResult(report);
      }
      case "memory_trace": {
        const node = traceGraph(activeStore, String(a.id), typeof a.depth === "number" ? a.depth : 5);
        if (!node) return toolError(`no entry with id ${a.id}`);
        return toolResult(node);
      }
      case "memory_loops": {
        const report = collectLoops(activeStore, activeRoot, activeMemoryDir);
        return toolResult(report);
      }
      case "memory_distill": {
        try {
          const report = distillSkills(activeStore, activeRoot, {
            minCount: typeof a.min_count === "number" ? a.min_count : undefined,
            dryRun: a.dry_run === true,
          });
          return toolResult(report);
        } catch (err: unknown) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }
      case "memory_verify": {
        const result = await verifyEntry(activeStore, activeRoot, activeMemoryDir, String(a.id), {
          timeout: typeof a.timeout === "number" ? a.timeout : undefined,
        });
        if (!result.ok) return toolError(result.message);
        return toolResult(result);
      }
      case "graph_status": {
        const status = getGraphStatus(activeRoot);
        return toolResult(status);
      }
      case "graph_index": {
        const index = indexGraph(activeRoot, activeMemoryDir);
        return toolResult(index);
      }
      case "memory_detect_providers": {
        const detected = detectProviders(activeRoot);
        return toolResult(detected);
      }
      case "memory_detect_agents": {
        const agents = detectAgents();
        return toolResult(agents);
      }
      case "memory_connect": {
        try {
          const reports = connectAgent(a.agent ? String(a.agent) : "all", undefined, {
            dryRun: Boolean(a.dry_run),
            force: Boolean(a.force),
          });
          return toolResult(reports);
        } catch (err: unknown) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }
      case "memory_migrate": {
        try {
          const report = await runMigration(activeStore, activeMemoryDir, {
            provider: a.provider ? String(a.provider) : undefined,
            all: Boolean(a.all),
            dryRun: Boolean(a.dry_run),
            overwrite: Boolean(a.overwrite),
            project: a.project ? String(a.project) : undefined,
          });
          return toolResult(report);
        } catch (err: unknown) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }
      case "memory_get_user_profile": {
        const isGlobal = a.global === true;
        const dir = isGlobal ? getGlobalMemoryDir() : activeMemoryDir;
        const query = a.query ? String(a.query) : undefined;
        const profile = getUserProfile(dir, { query });
        return toolResult({ profile: profile ?? "No USER.md profile configured.", exists: Boolean(profile) });
      }
      case "memory_set_user_profile": {
        try {
          const isGlobal = a.global === true;
          const dir = isGlobal ? getGlobalMemoryDir() : activeMemoryDir;
          setUserProfile(dir, String(a.content));
          return toolResult({ success: true, message: `Updated USER.md in ${dir}` });
        } catch (err: unknown) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }
      case "memory_search_transcripts": {
        try {
          const res = searchTranscriptWithBookends(String(a.transcript), String(a.query), {
            windowSize: typeof a.window_size === "number" ? a.window_size : undefined,
            maxMatches: typeof a.max_matches === "number" ? a.max_matches : undefined,
          });
          return toolResult(res);
        } catch (err: unknown) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }
      case "memory_tree_search": {
        let index = loadTreeIndex(activeMemoryDir);
        if (!index) {
          index = buildTreeIndex(activeStore, activeMemoryDir);
        }
        const res = searchTree(index, {
          query: String(a.query),
          project: a.project ? String(a.project) : undefined,
          type: a.type ? (String(a.type) as any) : undefined,
          tokenBudget: typeof a.token_budget === "number" ? a.token_budget : undefined,
          disclosureDepth: a.disclosure_depth ? (String(a.disclosure_depth) as any) : undefined,
          maxNodes: typeof a.max_nodes === "number" ? a.max_nodes : undefined,
        });
        return toolResult(res);
      }
      case "memory_wiki_get": {
        const page = getWikiPage(activeMemoryDir, String(a.slug), a.type ? (String(a.type) as any) : undefined);
        if (!page) return toolError(`Wiki page '${a.slug}' not found.`);
        return toolResult(page);
      }
      case "memory_wiki_search": {
        const pages = listWikiPages(activeMemoryDir, {
          project: a.project ? String(a.project) : undefined,
          type: a.type ? (String(a.type) as any) : undefined,
        });
        return toolResult({ pages, count: pages.length });
      }
      case "memory_wiki_compile": {
        const res = compileWiki(activeStore, activeMemoryDir, {
          project: a.project ? String(a.project) : undefined,
          dryRun: a.dry_run === true,
        });
        return toolResult(res);
      }
      case "memory_entities_get": {
        const ent = findEntity(activeMemoryDir, String(a.id));
        if (!ent) return toolError(`Entity '${a.id}' not found.`);
        if (a.include_related === true) {
          const rel = findRelatedEntities(activeMemoryDir, String(a.id));
          return toolResult({ entity: ent, related: rel });
        }
        return toolResult(ent);
      }
      case "memory_entities_search": {
        let entities = loadEntities(activeMemoryDir);
        if (a.type) entities = entities.filter((e) => e.type === a.type);
        if (a.project) entities = entities.filter((e) => !e.project || e.project === a.project);
        return toolResult({ entities, count: entities.length });
      }
      case "memory_pageindex_index": {
        try {
          const doc = buildPageIndex(String(a.content), {
            project: String(a.project),
            title: a.title ? String(a.title) : undefined,
            maxDepth: typeof a.maxDepth === "number" ? a.maxDepth : undefined,
            dryRun: a.dryRun === true,
            memoryDir: activeMemoryDir,
          });
          return toolResult(doc);
        } catch (err: unknown) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }
      case "memory_pageindex_search": {
        const project = a.project ? String(a.project) : "default";
        const doc = loadPageIndex(activeMemoryDir, project, String(a.indexId));
        if (!doc) return toolError(`PageIndex '${a.indexId}' not found for project '${project}'`);
        const res = searchPageIndex(doc, {
          query: String(a.query),
          maxDepth: typeof a.maxDepth === "number" ? a.maxDepth : undefined,
          maxNodes: typeof a.maxNodes === "number" ? a.maxNodes : undefined,
          tokenBudget: typeof a.tokenBudget === "number" ? a.tokenBudget : undefined,
        });
        return toolResult(res);
      }
      case "memory_pageindex_import": {
        const project = String(a.project);
        const doc = loadPageIndex(activeMemoryDir, project, String(a.indexId));
        if (!doc) return toolError(`PageIndex '${a.indexId}' not found for project '${project}'`);
        const search = searchPageIndex(doc, { query: String(a.query), maxNodes: 5 });
        const imported: MemoryEntry[] = [];
        for (const item of search.results) {
          const entry = propose(activeStore, {
            project,
            title: item.title,
            content: `${item.summary}\n\nPath: ${item.path}`,
            type: a.type ? (String(a.type) as any) : "discovery",
            confirmed: a.confirmed === true,
          });
          imported.push(entry);
        }
        return toolResult({ importedCount: imported.length, entries: imported });
      }
      case "memory_disconnect_pageindex": {
        const res = deletePageIndex(
          activeMemoryDir,
          a.project ? String(a.project) : undefined,
          a.indexId ? String(a.indexId) : undefined,
        );
        return toolResult({ success: true, deletedIndexes: res.deletedCount });
      }
      case "memory_settings_get": {
        const settings = a.project
          ? getProjectSettings(activeMemoryDir, String(a.project))
          : getSettings(activeMemoryDir);
        return toolResult(settings);
      }
      case "memory_settings_set": {
        try {
          if (a.project) {
            const updated = setProjectSettings(activeMemoryDir, String(a.project), a.settings as any);
            return toolResult(updated);
          } else {
            const updated = setSettings(activeMemoryDir, a.settings as any);
            return toolResult(updated);
          }
        } catch (err: unknown) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }
      case "memory_drift": {
        const { scanCodeDrift } = await import("./drift.ts");
        const report = scanCodeDrift({ workspaceRoot: activeRoot, memoryDir: activeMemoryDir });
        return toolResult(report);
      }
      case "memory_compress": {
        const { compressPromptContext } = await import("./compress.ts");
        const text = String(a.text ?? "");
        const level = a.level === "aggressive" ? "aggressive" : "light";
        const result = compressPromptContext(text, { level });
        return toolResult(result);
      }
      case "memory_source_add": {
        const source = addSource(activeMemoryDir, {
          url: String(a.url),
          title: String(a.title),
          source_type: a.source_type ? String(a.source_type) : undefined,
          excerpt: a.excerpt ? String(a.excerpt) : undefined,
          author: a.author ? String(a.author) : undefined,
        });
        return toolResult(source);
      }
      case "memory_source_list": {
        const sources = listSources(activeMemoryDir, {
          query: a.query ? String(a.query) : undefined,
          source_type: a.source_type ? String(a.source_type) : undefined,
        });
        return toolResult(sources);
      }
      case "memory_claim_record": {
        const claim = recordClaim(activeMemoryDir, {
          claim: String(a.claim),
          confidence_tag: a.confidence_tag as any,
          source_ids: Array.isArray(a.source_ids) ? a.source_ids.map(String) : undefined,
          memory_ids: Array.isArray(a.memory_ids) ? a.memory_ids.map(String) : undefined,
          notes: a.notes ? String(a.notes) : undefined,
          verified: a.verified === true,
        });
        return toolResult(claim);
      }
      case "memory_claim_list": {
        const claims = listClaims(activeMemoryDir, {
          confidence_tag: a.confidence_tag ? String(a.confidence_tag) : undefined,
          query: a.query ? String(a.query) : undefined,
          verified: typeof a.verified === "boolean" ? a.verified : undefined,
        });
        return toolResult(claims);
      }
      case "memory_freeze_run": {
        const snapshot = freezeExecutionSnapshot({
          workspaceRoot: activeRoot,
          memoryDir: activeMemoryDir,
          task: String(a.task),
          runId: a.run_id ? String(a.run_id) : undefined,
          store: activeStore,
        });
        return toolResult(snapshot);
      }
      case "memory_freeze_list": {
        const snapshots = listExecutionSnapshots(activeMemoryDir);
        return toolResult(snapshots);
      }
      case "memory_prompt_list": {
        const prompts = listPrompts(activeMemoryDir);
        return toolResult(prompts);
      }
      case "memory_prompt_get": {
        const prompt = getPrompt(activeMemoryDir, String(a.name));
        if (!prompt) return toolError(`Prompt template "${a.name}" not found`);
        return toolResult(prompt);
      }
      case "memory_prompt_run": {
        const rendered = renderPrompt(activeMemoryDir, String(a.name), (a.args as any) ?? {});
        return toolResult({ rendered });
      }
      case "memory_rollup": {
        const res = rollupTemporal(activeStore, {
          memoryDir: activeMemoryDir,
          period: (a.period as any) ?? "week",
          date: a.date ? String(a.date) : undefined,
          project: a.project ? String(a.project) : undefined,
        });
        return toolResult(res);
      }
      case "memory_loop_record": {
        const entry = recordIteration(activeMemoryDir, {
          iteration_index: Number(a.iteration_index) || 1,
          critic_verdict: String(a.critic_verdict) as any,
          largest_fix_identified: String(a.largest_fix_identified),
          test_results: String(a.test_results),
          diff_hash: a.diff_hash ? String(a.diff_hash) : undefined,
        });
        return toolResult(entry);
      }
      case "memory_loop_status": {
        const status = detectIterationStatus(activeMemoryDir);
        return toolResult(status);
      }
      case "memory_verify_strict": {
        const report = verifyStrictIntegrity(activeStore, activeMemoryDir, activeRoot, {
          maxCandidateDays: typeof a.max_candidate_days === "number" ? a.max_candidate_days : undefined,
        });
        return toolResult(report);
      }
      default:
        return toolError(`unknown tool ${name}`);
    }
  } catch (err: unknown) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
  });

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stdin.resume();
  await new Promise<void>((resolve) => {
    process.stdin.on("end", () => resolve());
    process.stdin.on("close", () => resolve());
  });
}

function toolResult(content: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(content, null, 2) }],
  };
}

function toolError(message: string) {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
