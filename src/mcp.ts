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
import {
  recordApplicationOutcome,
  resolveConflict,
  computeMemoryRoi,
  recordRetrievals,
} from "./quality/index.ts";
import {
  recordObservation,
  listObservations,
  recordNegativeLesson,
  distillObservationsToCandidates,
} from "./learning/index.ts";
import {
  defaultRegistry,
  enrichMemoryWithCodeIntel,
} from "./intelligence/index.ts";
import {
  evaluateContextUsage,
  generateSessionHandoff,
  harvestSessionMemories,
} from "./compaction/index.ts";
import {
  evaluatePromotion,
  promoteMemory,
  generalizeContent,
  evaluateArchival,
  archiveMemory,
  rehydrateMemory,
  getLifecycleStats,
} from "./promotion/index.ts";
import {
  createCodeAnchor,
  verifyCodeAnchor,
  attachAnchorToMemory,
  auditMemoryAnchors,
} from "./anchors/index.ts";
import {
  recordAdr,
  listAdrs,
  detectDocumentationCodeDrift,
} from "./adrs/index.ts";
import {
  explainWhyCodeIsTheWayItIs,
  clusterRecurringBugsAndFriction,
  analyzeTechnicalDebt,
} from "./cognition/index.ts";
import { evaluateProjectHealth, reconcileCodeAnchors } from "./health/index.ts";
import { analyzeMemoryCodeImpact } from "./intelligence/index.ts";
import { generatePrContext } from "./compaction/index.ts";
import {
  broadcastKnowledge,
  ingestKnowledge,
  getSyncStatus,
  syncWithSharedPool,
} from "./sync/index.ts";
import {
  discoverWorkspaceMesh,
  resolveMeshMemories,
  auditMeshContracts,
  addMeshLink,
  removeMeshLink,
} from "./mesh/index.ts";
import {
  resolveMuseContext,
  resolveCodeForMemory,
  resolveMemoryForCode,
  listMcpProfiles,
  filterToolsForProfile,
  getActiveMcpProfile,
  type McpProfile,
} from "./orchestrator/index.ts";
import { listPrompts, getPrompt, renderPrompt } from "./prompts.ts";
import { rollupTemporal } from "./compounding/temporal.ts";
import { recordIteration, detectIterationStatus } from "./iterations.ts";
import { verifyStrictIntegrity } from "./verify.ts";
import { queryTieredContext, type RetrievalTier, rankAndRetrieveMemories } from "./retrieval/index.ts";
import type { MemoryEntry, MemoryType } from "./types.ts";

export function createServer(targetDir?: string, requestedProfile?: McpProfile): Server {
  const activeProfile = getActiveMcpProfile(requestedProfile);
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

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const allTools = [
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
        description: "Execute promotion of a memory entry (LOCAL -> PROJECT or PROJECT -> GLOBAL) with generalization and audit logging",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "ID of the memory entry to promote" },
            force_manual: { type: "boolean", description: "Manual promotion override bypassing automatic 5x threshold" },
            generalized_content: { type: "string", description: "Optional custom generalized principle text" },
            agent: { type: "string", description: "Optional agent or actor name" },
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
          },
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
    ];

    return { tools: filterToolsForProfile(allTools, activeProfile) };
  });

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
      case "memory_feedback": {
        const updated = recordApplicationOutcome(activeStore, {
          memoryId: String(a.memory_id),
          success: Boolean(a.success),
          regression: a.regression === true,
          notes: a.notes ? String(a.notes) : undefined,
          actor: a.agent ? String(a.agent) : "agent",
        });
        return toolResult(updated);
      }
      case "memory_resolve_conflict": {
        const result = resolveConflict(activeStore, {
          winningId: String(a.winning_id),
          losingId: String(a.losing_id),
          strategy: a.strategy as "supersede" | "historical" | "reject" | "keep_both",
          reason: String(a.reason),
          actor: a.agent ? String(a.agent) : "user",
        });
        return toolResult(result);
      }
      case "memory_roi": {
        const report = computeMemoryRoi(activeStore, {
          project: a.project ? String(a.project) : undefined,
        });
        return toolResult(report);
      }
      case "memory_observe": {
        const obs = recordObservation(activeStore, {
          source: String(a.source) as any,
          project: String(a.project),
          raw: String(a.raw),
          summary: a.summary ? String(a.summary) : undefined,
          metadata: a.metadata ? (a.metadata as Record<string, any>) : undefined,
        });
        return toolResult(obs);
      }
      case "memory_distill_observations": {
        const result = distillObservationsToCandidates(activeStore, String(a.project));
        return toolResult(result);
      }
      case "memory_negative_capture": {
        const entry = recordNegativeLesson(activeStore, {
          project: String(a.project),
          title: String(a.title),
          failed_approach: String(a.failed_approach),
          failure_reason: String(a.failure_reason),
          alternative_recommended: a.alternative_recommended ? String(a.alternative_recommended) : undefined,
          reproduction_command: a.reproduction_command ? String(a.reproduction_command) : undefined,
          severity: a.severity as any,
          tags: Array.isArray(a.tags) ? a.tags.map(String) : undefined,
          source: a.agent ? String(a.agent) : "agent",
        });
        return toolResult(entry);
      }
      case "memory_code_intel_status": {
        const workspaceDir = a.dir ? String(a.dir) : activeRoot;
        const available = await defaultRegistry.getAvailableProviders(workspaceDir);
        return toolResult({
          workspaceDir,
          availableProviders: available.map((p) => ({
            name: p.name,
            capabilities: p.getCapabilities(),
          })),
        });
      }
      case "memory_code_intel_symbols": {
        const workspaceDir = a.dir ? String(a.dir) : activeRoot;
        const symbols = await defaultRegistry.resolveSymbolsWithFallback(String(a.query), workspaceDir);
        return toolResult({ query: a.query, count: symbols.length, symbols });
      }
      case "memory_code_intel_blast_radius": {
        const workspaceDir = a.dir ? String(a.dir) : activeRoot;
        const blast = await defaultRegistry.getBlastRadiusWithFallback(String(a.target), workspaceDir);
        return toolResult(blast);
      }
      case "memory_enrich": {
        const entry = get(activeStore, String(a.id));
        if (!entry) return toolError(`memory ${a.id} not found`);
        const workspaceDir = a.dir ? String(a.dir) : activeRoot;
        const enriched = await enrichMemoryWithCodeIntel(activeStore, entry, workspaceDir);
        return toolResult(enriched);
      }
      case "memory_ranked_retrieval": {
        const results = await rankAndRetrieveMemories(activeStore, String(a.query), {
          project: a.project ? String(a.project) : undefined,
          tokenBudget: a.token_budget ? Number(a.token_budget) : undefined,
          activeFilePath: a.active_file_path ? String(a.active_file_path) : undefined,
          targetSymbol: a.target_symbol ? String(a.target_symbol) : undefined,
          limit: a.limit ? Number(a.limit) : 10,
        });
        return toolResult({
          query: a.query,
          count: results.length,
          results: results.map((r) => ({
            id: r.entry.id,
            title: r.entry.title,
            project: r.entry.project,
            type: r.entry.type,
            status: r.entry.status,
            temporal_mode: r.entry.temporal_mode,
            score: Number(r.score.toFixed(3)),
            factors: r.factors,
            content: r.entry.content,
          })),
        });
      }
      case "memory_compaction_check": {
        const evaluation = evaluateContextUsage(
          Number(a.used_tokens),
          a.max_tokens ? Number(a.max_tokens) : undefined,
        );
        return toolResult(evaluation);
      }
      case "memory_compact_handoff": {
        const result = generateSessionHandoff(
          activeMemoryDir,
          {
            highLevelGoal: String(a.high_level_goal),
            currentArchitecture: String(a.current_architecture),
            completedTasks: Array.isArray(a.completed_tasks) ? a.completed_tasks.map(String) : [],
            openTasks: Array.isArray(a.open_tasks) ? a.open_tasks.map(String) : [],
            nextConcreteTask: String(a.next_concrete_task),
            activeConstraints: Array.isArray(a.active_constraints) ? a.active_constraints.map(String) : undefined,
            decisionsMade: Array.isArray(a.decisions_made) ? a.decisions_made.map(String) : undefined,
          },
          {
            agent: a.agent ? String(a.agent) : undefined,
            sessionId: a.session_id ? String(a.session_id) : undefined,
            project: a.project ? String(a.project) : undefined,
          },
        );
        return toolResult(result);
      }
      case "memory_harvest_turn": {
        const harvested = harvestSessionMemories(
          activeStore,
          String(a.text),
          {
            project: String(a.project),
            actor: a.agent ? String(a.agent) : undefined,
          },
        );
        return toolResult({
          harvestedCount: harvested.length,
          memories: harvested,
        });
      }
      case "memory_evaluate_promotion": {
        const entry = get(activeStore, String(a.id));
        if (!entry) return toolError(`entry '${a.id}' not found`);
        const evaluation = evaluatePromotion(entry, { forceManual: Boolean(a.force_manual) });
        return toolResult(evaluation);
      }
      case "memory_promote": {
        const result = promoteMemory(activeStore, String(a.id), {
          forceManual: Boolean(a.force_manual),
          customGeneralizedContent: a.generalized_content ? String(a.generalized_content) : undefined,
          actor: a.agent ? String(a.agent) : undefined,
        });
        return toolResult(result);
      }
      case "memory_generalize": {
        const result = generalizeContent(String(a.content), {
          projectName: a.project ? String(a.project) : undefined,
        });
        return toolResult(result);
      }
      case "memory_archive": {
        const tier = String(a.tier) as "cold" | "dormant" | "archived";
        const result = archiveMemory(activeStore, String(a.id), tier, String(a.reason), a.agent ? String(a.agent) : undefined);
        return toolResult(result);
      }
      case "memory_rehydrate": {
        const score = typeof a.score === "number" ? a.score : 1.0;
        const result = rehydrateMemory(
          activeStore,
          String(a.id),
          score,
          a.reason ? String(a.reason) : undefined,
          a.agent ? String(a.agent) : undefined,
        );
        return toolResult(result);
      }
      case "memory_lifecycle_status": {
        let sweepResult = undefined;
        if (Boolean(a.sweep)) {
          const { autoArchiveSweep } = require("./promotion/archival.ts");
          sweepResult = autoArchiveSweep(activeStore);
        }
        const stats = getLifecycleStats(activeStore);
        return toolResult({
          stats,
          sweep: sweepResult,
        });
      }
      case "memory_anchor_create": {
        const kind = (a.kind ? String(a.kind) : (a.symbol_name ? "symbol" : "file")) as any;
        const anchor = createCodeAnchor(activeRoot, {
          kind,
          filePath: String(a.file_path),
          symbolName: a.symbol_name ? String(a.symbol_name) : undefined,
          qualifiedName: a.qualified_name ? String(a.qualified_name) : undefined,
          providerMetadata: (a.provider_metadata && typeof a.provider_metadata === "object") ? a.provider_metadata as Record<string, any> : undefined,
        });
        const updatedEntry = attachAnchorToMemory(activeStore, String(a.memory_id), anchor, a.agent ? String(a.agent) : undefined);
        return toolResult({
          anchor,
          entry_id: updatedEntry.id,
          total_anchors: updatedEntry.anchors?.length || 0,
        });
      }
      case "memory_anchor_verify": {
        const entry = get(activeStore, String(a.memory_id));
        if (!entry) return toolError(`entry '${a.memory_id}' not found`);
        const anchors = entry.anchors || [];
        const results = anchors.map((anc) => verifyCodeAnchor(activeRoot, anc));
        return toolResult({
          entry_id: entry.id,
          anchors_count: anchors.length,
          verification: results,
        });
      }
      case "memory_anchor_audit": {
        const report = auditMemoryAnchors(activeStore, activeRoot);
        return toolResult(report);
      }
      case "muse_context": {
        const result = await resolveMuseContext(activeStore, activeRoot, {
          query: a.query ? String(a.query) : undefined,
          active_file: a.active_file ? String(a.active_file) : undefined,
          symbol: a.symbol ? String(a.symbol) : undefined,
          error_message: a.error_message ? String(a.error_message) : undefined,
          task_intent: a.task_intent as any,
          token_budget: typeof a.token_budget === "number" ? a.token_budget : undefined,
          project: a.project ? String(a.project) : undefined,
          dir: a.dir ? String(a.dir) : undefined,
        });
        return toolResult(result);
      }
      case "muse_code_for_memory": {
        const result = resolveCodeForMemory(activeStore, String(a.memory_id));
        return toolResult(result);
      }
      case "muse_memory_for_code": {
        const result = resolveMemoryForCode(activeStore, {
          filePath: String(a.file_path),
          symbolName: a.symbol_name ? String(a.symbol_name) : undefined,
        });
        return toolResult(result);
      }
      case "muse_profile_list": {
        const profiles = listMcpProfiles();
        return toolResult({
          active_profile: activeProfile,
          profiles,
        });
      }
      case "memory_adr_record": {
        const adrEntry = recordAdr(activeStore, activeRoot, {
          title: String(a.title),
          context_and_drivers: Array.isArray(a.context_and_drivers) ? a.context_and_drivers.map(String) : [],
          decision: String(a.decision),
          consequences: (a.consequences && typeof a.consequences === "object") ? a.consequences as any : {},
          options_considered: Array.isArray(a.options_considered) ? a.options_considered as any : undefined,
          affected_files: Array.isArray(a.affected_files) ? a.affected_files.map(String) : undefined,
          affected_symbols: Array.isArray(a.affected_symbols) ? a.affected_symbols.map(String) : undefined,
          supersedes: a.supersedes ? String(a.supersedes) : undefined,
          status: a.status as any,
          project: a.project ? String(a.project) : "architecture",
          tags: Array.isArray(a.tags) ? a.tags.map(String) : undefined,
          actor: a.agent ? String(a.agent) : undefined,
        });
        return toolResult({
          adr: adrEntry,
          adr_number: adrEntry.adr?.adr_number,
          id: adrEntry.id,
        });
      }
      case "memory_adr_list": {
        const adrs = listAdrs(activeStore, a.status as any);
        return toolResult({
          total: adrs.length,
          adrs: adrs.map((e) => ({
            id: e.id,
            adr_number: e.adr?.adr_number,
            title: e.title,
            status: e.adr?.status,
            decision: e.adr?.decision,
            updated_at: e.updated_at,
          })),
        });
      }
      case "memory_drift_audit": {
        const report = detectDocumentationCodeDrift(activeStore, activeRoot);
        return toolResult(report);
      }
      case "muse_why": {
        const explanation = explainWhyCodeIsTheWayItIs(activeStore, {
          target: String(a.target),
          filePath: a.file_path ? String(a.file_path) : undefined,
          symbolName: a.symbol_name ? String(a.symbol_name) : undefined,
        });
        return toolResult(explanation);
      }
      case "muse_bug_clusters": {
        const clusters = clusterRecurringBugsAndFriction(activeStore);
        return toolResult({
          total_clusters: clusters.length,
          clusters,
        });
      }
      case "muse_tech_debt": {
        const report = analyzeTechnicalDebt(activeStore, activeRoot);
        return toolResult(report);
      }
      case "muse_health": {
        const report = evaluateProjectHealth(activeStore, activeRoot);
        return toolResult(report);
      }
      case "muse_sync_broadcast": {
        const packet = broadcastKnowledge(activeStore, activeRoot, {
          agentId: a.agent_id as string | undefined,
          project: a.project as string | undefined,
          limit: typeof a.limit === "number" ? a.limit : undefined,
        });
        return toolResult(packet);
      }
      case "muse_sync_ingest": {
        const packet = a.packet as any;
        if (!packet) {
          return toolError("Missing required 'packet' argument");
        }
        const result = ingestKnowledge(activeStore, activeRoot, packet, a.agent_id as string | undefined);
        return toolResult(result);
      }
      case "muse_sync_status": {
        const status = getSyncStatus(activeStore, activeRoot, a.agent_id as string | undefined);
        return toolResult(status);
      }
      case "muse_sync_pool": {
        const report = syncWithSharedPool(
          activeStore,
          activeRoot,
          a.pool_dir as string | undefined,
          a.agent_id as string | undefined
        );
        return toolResult(report);
      }
      case "muse_mesh_status": {
        const topology = discoverWorkspaceMesh(activeRoot, activeMemoryDir);
        return toolResult(topology);
      }
      case "muse_mesh_query": {
        const topology = discoverWorkspaceMesh(activeRoot, activeMemoryDir);
        const results = resolveMeshMemories(activeStore, topology, {
          query: a.query as string | undefined,
          targetProjects: Array.isArray(a.projects) ? (a.projects as string[]) : undefined,
          types: Array.isArray(a.types) ? (a.types as MemoryType[]) : undefined,
          limit: typeof a.limit === "number" ? a.limit : undefined,
        });
        return toolResult({ total_found: results.length, results });
      }
      case "muse_mesh_audit": {
        const topology = discoverWorkspaceMesh(activeRoot, activeMemoryDir);
        const audit = auditMeshContracts(topology, activeStore);
        return toolResult(audit);
      }
      case "muse_mesh_link": {
        const targetPath = a.path as string;
        if (!targetPath) return toolError("Missing required 'path' argument");
        const action = (a.action as string) || "link";
        if (action === "unlink") {
          removeMeshLink(activeMemoryDir, targetPath);
          return toolResult({ success: true, action: "unlinked", path: targetPath });
        } else {
          addMeshLink(activeMemoryDir, targetPath);
          return toolResult({ success: true, action: "linked", path: targetPath });
        }
      }
      case "muse_code_impact": {
        const filePath = a.file_path as string;
        if (!filePath) return toolError("Missing required 'file_path' argument");
        const symbolName = a.symbol_name as string | undefined;
        const result = await analyzeMemoryCodeImpact(activeStore, {
          filePath,
          symbolName,
          workspaceRoot: activeRoot,
        });
        return toolResult(result);
      }
      case "muse_pr_context": {
        const baseBranch = (a.base_branch as string) || "main";
        const result = await generatePrContext(activeStore, {
          baseBranch,
          workspaceRoot: activeRoot,
        });
        return toolResult(result);
      }
      case "muse_reconcile_anchors": {
        const prune = a.prune === true;
        const markStale = a.mark_stale === true;
        const updateHashes = a.update_hashes === true;
        const dryRun = a.dry_run !== false;
        const report = await reconcileCodeAnchors(activeStore, {
          prune,
          markStale,
          updateHashes,
          dryRun,
          workspaceRoot: activeRoot,
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
