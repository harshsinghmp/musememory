import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MCP_TOOL_CATALOG } from "./mcp/catalog.ts";
import { dispatchToolCall } from "./mcp/dispatch.ts";
import { toolError } from "./mcp/tool-result.ts";
import { findOrCreateProjectRoot } from "./root.ts";
import { openStore, type Store } from "./store.ts";
import { getSettings } from "./settings.ts";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./version.ts";
import { filterToolsForProfile, getActiveMcpProfile, type McpProfile } from "./orchestrator/index.ts";

// --- T-301: in-process async write queue -------------------------------------
// Read tools must never mutate the store synchronously. Handlers compute the
// response from a consistent snapshot, enqueue their write side-effects, and the
// queue is flushed after the response (scheduled task) or on process exit.
const pendingWrites: Array<() => void> = [];
let writeFlushScheduled = false;

/** Apply every queued write in FIFO order. Safe to call when idle. */
export function flushPendingWrites(): void {
  writeFlushScheduled = false;
  while (pendingWrites.length > 0) {
    try {
      pendingWrites.shift()!();
    } catch {
      // A deferred write must never break the response path.
    }
  }
}

function enqueueWrites(writes: Array<() => void>): void {
  if (writes.length === 0) return;
  pendingWrites.push(...writes);
  if (writeFlushScheduled) return;
  writeFlushScheduled = true;
  setTimeout(flushPendingWrites, 0);
}

process.on("exit", flushPendingWrites);

// --- #432: one Store per memory directory, for the life of the process --------
// `resolveStoreForRequest` used to open a brand-new Store for every request that
// carried a `dir`, and nothing ever closed it: each call leaked the SQLite
// handle (plus its WAL), so a long-lived MCP server walked into the fd limit.
// At that limit `openDatabase` throws EMFILE, which `openStore` degrades past,
// and every tool then silently answers from the YAML mirror while reporting
// success. Caching by memory directory bounds the fds, and makes every handler
// for a directory share one cache and one circuit breaker instead of a fresh,
// permanently-cold pair per request.
const storeByMemoryDir = new Map<string, Store>();

/** Return the cached Store for `memoryDir`, opening and caching it on first use. */
export function getCachedStore(memoryDir: string): Store {
  const cached = storeByMemoryDir.get(memoryDir);
  if (cached) return cached;
  const opened = openStore(memoryDir);
  storeByMemoryDir.set(memoryDir, opened);
  return opened;
}

export function createServer(targetDir?: string, requestedProfile?: McpProfile): Server {
  const activeProfile = getActiveMcpProfile(requestedProfile);
  const resolvedTarget = targetDir || process.env.MUSE_MEMORY_PROJECT_DIR || process.env.PROJECT_ROOT || process.cwd();
  const { root, memoryDir } = findOrCreateProjectRoot(resolvedTarget);
  // #432: the server's own store goes through the cache too, so a request that
  // names this project's directory reuses it rather than opening a second one.
  const store = getCachedStore(memoryDir);

  function resolveStoreForRequest(a?: Record<string, unknown>): { activeStore: Store; activeMemoryDir: string; activeRoot: string } {
    const dir = a?.dir || a?.workspace || a?.project_dir || a?.cwd;
    if (typeof dir === "string" && dir.trim()) {
      const resolved = findOrCreateProjectRoot(dir.trim());
      return {
        activeStore: getCachedStore(resolved.memoryDir),
        activeMemoryDir: resolved.memoryDir,
        activeRoot: resolved.root,
      };
    }
    return { activeStore: store, activeMemoryDir: memoryDir, activeRoot: root };
  }

  const server = new Server(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
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
    const filteredByProfile = filterToolsForProfile(MCP_TOOL_CATALOG, activeProfile);
    // T-394: Enforce mcp.enabledTools from settings
    const settings = getSettings(memoryDir);
    const enabledTools = settings.mcp?.enabledTools;
    const finalTools =
      enabledTools && enabledTools.length > 0
        ? filteredByProfile.filter((t) => enabledTools.includes(t.name))
        : filteredByProfile;

    return { tools: finalTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;
    const { activeStore, activeMemoryDir, activeRoot } = resolveStoreForRequest(a);

    // T-394: Reject disabled tools per mcp.enabledTools
    const settings = getSettings(activeMemoryDir);
    if (settings.mcp?.enabledTools && settings.mcp.enabledTools.length > 0) {
      if (!settings.mcp.enabledTools.includes(name)) {
        return toolError(`Tool '${name}' is disabled by mcp.enabledTools settings configuration`);
      }
    }

    try {
      // `await` is deliberate: a case that throws inside the dispatch table must
      // land in this catch and be reported through `toolError`, exactly as the
      // inlined switch did before the extraction.
      return await dispatchToolCall(a, {
        name,
        activeStore,
        activeMemoryDir,
        activeRoot,
        activeProfile,
        enqueueWrites,
      });
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

export const SUPPORTED_MCP_PROTOCOL_VERSIONS = ["2024-11-05", "2025-06-18"];
