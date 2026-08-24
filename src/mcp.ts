import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { findOrCreateProjectRoot } from "./root.ts";
import { openStore, get, confirm, save, type Store } from "./store.ts";
import {
  proposeMemory,
  supersedeMemory,
  confirmMemory,
  linkMemory,
  markStaleMemory,
  rejectMemory,
  deleteMemory,
} from "./commands/lifecycle.ts";
import { harvestMemory } from "./commands/retrieval.ts";
import { search, formatPromptContext } from "./retrieval.ts";
import { consolidateScenes } from "./consolidate.ts";
import { traceGraph } from "./trace.ts";
import { collectLoops } from "./loops.ts";
import { distillSkills } from "./distill.ts";
import { verifyEntry } from "./verify.ts";
import { recordSessionStart } from "./sessions.ts";
import { validateStore } from "./schema.ts";
import { getGraphStatus } from "./graph.ts";
import { importTranscript } from "./harvest.ts";
import { exportSnapshot, importSnapshot } from "./snapshot.ts";
import { searchTranscriptWithBookends } from "./transcript.ts";
import { getUserProfile, setUserProfile } from "./user.ts";
import { CORE_TIERS, readCore, setCore, removeCore, type CoreTier } from "./core.ts";
import { getGlobalMemoryDir } from "./root.ts";
import { getAuditTrail } from "./audit.ts";
import { detectProviders, runMigration } from "./migrator/index.ts";
import { detectAgents } from "./agents/detect.ts";
import { connectAgent } from "./connect.ts";
import type { MemoryEntry, MemoryType } from "./types.ts";

export async function runMcpServer(): Promise<void> {
  const targetDir = process.env.MUSE_MEMORY_PROJECT_DIR || process.env.PROJECT_ROOT || process.cwd();
  const { root, memoryDir } = findOrCreateProjectRoot(targetDir);
  const store = openStore(memoryDir);

  const server = new Server(
    { name: "musememory", version: "1.2.0" },
    { capabilities: { tools: {} } },
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
        description: "Ranked active context entries for prompt injection (with optional token budget)",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            project: { type: "string" },
            limit: { type: "number" },
            token_budget: { type: "number", description: "Maximum token budget to consume for retrieved context" },
            type: { type: "string" },
            status: { type: "string" },
            verified: { type: "boolean" },
            depth: { type: "string", enum: ["L1", "L2", "L3"], description: "Progressive disclosure tier: L1 = id+title lines, L2 = title+content+tags (default), L3 = full raw entry" },
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
            limit: { type: "number" },
            token_budget: { type: "number", description: "Maximum token budget to consume" },
            include_superseded: { type: "boolean" },
            type: { type: "string" },
            status: { type: "string" },
            verified: { type: "boolean" },
          },
          required: ["query"],
        },
      },
      {
        name: "memory_capture",
        description: "Create a new memory entry with inline secret scan (refuses probable secrets)",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string" },
            project: { type: "string" },
            title: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            type: { type: "string" },
            confirmed: { type: "boolean" },
          },
          required: ["content", "project"],
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
        name: "memory_recall",
        description: "Rich recall of ranked entries with verification/related/session/graph fields and token budgeting",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number" },
            token_budget: { type: "number", description: "Maximum token budget to consume for retrieved recall entries" },
            project: { type: "string" },
            type: { type: "string" },
            status: { type: "string" },
            verified: { type: "boolean" },
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
        name: "propose",
        description: "Create a new memory entry (candidate by default; pass confirmed=true for confirmed)",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string" },
            project: { type: "string" },
            title: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            type: { type: "string" },
            confirmed: { type: "boolean" },
          },
          required: ["content", "project"],
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
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case "memory_read": {
        const entry = get(store, String(a.id));
        if (!entry) return toolError(`no entry with id ${a.id}`);
        return toolResult(entry);
      }
      case "get_context": {
        const formatted = formatPromptContext(store, memoryDir, String(a.query ?? ""), {
          limit: typeof a.limit === "number" ? a.limit : 5,
          tokenBudget: typeof a.token_budget === "number" ? a.token_budget : undefined,
          project: a.project ? String(a.project) : undefined,
          includeSuperseded: false,
          type: a.type ? String(a.type) : undefined,
          status: a.status ? String(a.status) : undefined,
          verified: a.verified === true,
          depth: a.depth ? (String(a.depth) as "L1" | "L2" | "L3") : undefined,
        });
        return toolResult({
          markdown: formatted.markdown,
          entries: formatted.entries.map((r) => ({ ...r.entry, score: r.score })),
          total_tokens_used: formatted.totalTokensUsed,
          constraints: formatted.constraints,
          user_profile: formatted.userProfile,
        });
      }
      case "search": {
        const res = search(store, memoryDir, String(a.query), {
          limit: typeof a.limit === "number" ? a.limit : 10,
          tokenBudget: typeof a.token_budget === "number" ? a.token_budget : undefined,
          includeSuperseded: a.include_superseded === true,
          type: a.type ? String(a.type) : undefined,
          status: a.status ? String(a.status) : undefined,
          verified: a.verified === true,
        });
        return toolResult({
          results: res.results.map((r) => ({ ...r.entry, score: r.score })),
          source: res.source,
          stale: res.stale,
          total_tokens_used: res.totalTokensUsed,
        });
      }
      case "memory_capture": {
        try {
          const entry = proposeMemory(store, {
            content: String(a.content),
            project: String(a.project),
            title: a.title ? String(a.title) : undefined,
            tags: Array.isArray(a.tags) ? a.tags.map(String) : undefined,
            type: a.type ? (String(a.type) as MemoryType) : undefined,
            confirmed: a.confirmed === true,
          });
          return toolResult(entry);
        } catch (err: unknown) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }
      case "memory_harvest": {
        const created = harvestMemory(store, {
          text: String(a.text),
          project: String(a.project),
          confirmed: a.confirmed === true,
        });
        return toolResult({ harvested_count: created.length, entries: created });
      }
      case "memory_import_transcript": {
        const transcript = String(a.transcript);
        const project = a.project ? String(a.project) : undefined;
        const isConfirmed = a.confirmed === true;
        const res = importTranscript(store, transcript, { project, confirmed: isConfirmed });
        return toolResult(res);
      }
      case "memory_recall": {
        const res = search(store, memoryDir, String(a.query ?? ""), {
          limit: typeof a.limit === "number" ? a.limit : 5,
          tokenBudget: typeof a.token_budget === "number" ? a.token_budget : undefined,
          project: a.project ? String(a.project) : undefined,
          includeSuperseded: false,
          type: a.type ? String(a.type) : undefined,
          status: a.status ? String(a.status) : undefined,
          verified: a.verified === true,
        });
        return toolResult(res.results.map((r) => ({ ...r.entry, score: r.score })));
      }
      case "memory_confirm": {
        const entry = confirmMemory(store, String(a.id));
        return toolResult(entry);
      }
      case "memory_supersede": {
        const oldId = String(a.id);
        const newId = String(a.with ?? a.new_id ?? "");
        if (!newId) return toolError("memory_supersede requires 'with' or 'new_id' parameter");
        const entry = supersedeMemory(store, { oldId, newId });
        return toolResult(entry);
      }
      case "memory_link": {
        const related = Array.isArray(a.related) ? a.related.map(String) : [];
        const entry = linkMemory(store, String(a.id), related);
        return toolResult(entry);
      }
      case "memory_mark_stale": {
        const entry = markStaleMemory(store, String(a.id), a.reason ? String(a.reason) : undefined);
        return toolResult(entry);
      }
      case "memory_reject": {
        const entry = rejectMemory(store, String(a.id));
        return toolResult(entry);
      }
      case "memory_delete": {
        const id = String(a.id);
        const reason = a.reason ? String(a.reason) : undefined;
        deleteMemory(store, id, reason, "mcp_agent");
        return toolResult({ success: true, deleted_id: id });
      }
      case "memory_audit": {
        const trail = getAuditTrail(memoryDir, {
          operation: a.operation ? String(a.operation) : undefined,
          entryId: a.entry_id ? String(a.entry_id) : undefined,
          limit: typeof a.limit === "number" ? a.limit : 50,
        });
        return toolResult({ total: trail.length, entries: trail });
      }
      case "memory_export": {
        const snapshot = exportSnapshot(store);
        return toolResult(snapshot);
      }
      case "memory_import": {
        const entries = (a.entries ?? []) as MemoryEntry[];
        const res = importSnapshot(store, { entries }, { overwrite: a.overwrite === true });
        return toolResult(res);
      }
      case "propose": {
        try {
          const entry = proposeMemory(store, {
            content: String(a.content),
            project: String(a.project),
            title: a.title ? String(a.title) : undefined,
            tags: Array.isArray(a.tags) ? a.tags.map(String) : undefined,
            type: a.type ? (String(a.type) as MemoryType) : undefined,
            confirmed: a.confirmed === true,
          });
          return toolResult(entry);
        } catch (err: unknown) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }
      case "confirm_fix": {
        const entry = get(store, String(a.id));
        if (!entry) return toolError(`no entry with id ${a.id}`);
        if (entry.status !== "disputed") return toolError(`entry ${a.id} is not disputed`);
        const updated = confirm(store, entry.id);
        if (!updated) return toolError(`no entry with id ${a.id}`);
        if (a.resolution) {
          updated.content = `${updated.content}\n\nResolution: ${String(a.resolution)}`;
          save(store, updated);
        }
        return toolResult(updated);
      }
      case "record_session": {
        const { entry, sessionId } = recordSessionStart(store, String(a.project), a.note ? String(a.note) : undefined);
        return toolResult({ ...entry, sessionId });
      }
      case "memory_validate": {
        const report = validateStore(store);
        return toolResult(report);
      }
      case "memory_core": {
        const tier = a.tier ? (String(a.tier) as CoreTier) : undefined;
        if (tier && !(CORE_TIERS as readonly string[]).includes(tier)) {
          return toolError(`unknown core tier "${tier}" (expected: ${CORE_TIERS.join("|")})`);
        }
        try {
          if (tier && a.set !== undefined) {
            const tiers = setCore(memoryDir, tier, String(a.set));
            return toolResult({ tier, lines: tiers[tier] });
          }
          if (tier && a.remove === true) {
            const tiers = removeCore(memoryDir, tier);
            return toolResult({ tier, lines: tiers[tier] });
          }
          if (tier) {
            return toolResult({ tier, lines: readCore(memoryDir)[tier] });
          }
          return toolResult(readCore(memoryDir));
        } catch (err: unknown) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }
      case "memory_consolidate": {
        const report = consolidateScenes(store, {
          project: a.project ? String(a.project) : undefined,
          dryRun: a.dry_run === true,
        });
        return toolResult(report);
      }
      case "memory_trace": {
        const node = traceGraph(store, String(a.id), typeof a.depth === "number" ? a.depth : 5);
        if (!node) return toolError(`no entry with id ${a.id}`);
        return toolResult(node);
      }
      case "memory_loops": {
        const report = collectLoops(store, root, memoryDir);
        return toolResult(report);
      }
      case "memory_distill": {
        try {
          const report = distillSkills(store, root, {
            minCount: typeof a.min_count === "number" ? a.min_count : undefined,
            dryRun: a.dry_run === true,
          });
          return toolResult(report);
        } catch (err: unknown) {
          return toolError(err instanceof Error ? err.message : String(err));
        }
      }
      case "memory_verify": {
        const result = await verifyEntry(store, root, memoryDir, String(a.id), {
          timeout: typeof a.timeout === "number" ? a.timeout : undefined,
        });
        if (!result.ok) return toolError(result.message);
        return toolResult(result);
      }
      case "graph_status": {
        const status = getGraphStatus(root);
        return toolResult(status);
      }
      case "memory_detect_providers": {
        const detected = detectProviders(root);
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
          const report = await runMigration(store, memoryDir, {
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
        const dir = isGlobal ? getGlobalMemoryDir() : memoryDir;
        const profile = getUserProfile(dir);
        return toolResult({ profile: profile ?? "No USER.md profile configured.", exists: Boolean(profile) });
      }
      case "memory_set_user_profile": {
        try {
          const isGlobal = a.global === true;
          const dir = isGlobal ? getGlobalMemoryDir() : memoryDir;
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
      default:
        return toolError(`unknown tool ${name}`);
    }
  } catch (err: unknown) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
});

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
