import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import { MCP_TOOL_CATALOG } from "./mcp/catalog.ts";
import { dispatchToolCall } from "./mcp/dispatch.ts";
import { toolError } from "./mcp/tool-result.ts";
import { STATIC_MCP_RESOURCES, readMcpResource } from "./mcp/resources.ts";
import { getMcpPrompt, listMcpPrompts } from "./mcp/prompts.ts";
import { findOrCreateProjectRoot } from "./root.ts";
import { isWithinRoot, realishPath } from "./paths.ts";
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

/**
 * #512: the operator's opt-in for a server that deliberately serves more than
 * one project. Unset (the default) means a request-supplied directory must stay
 * inside the workspace root `createServer` resolved.
 */
export const ALLOW_EXTERNAL_DIR_ENV = "MUSE_MCP_ALLOW_EXTERNAL_DIR";

/** True when the operator opted into request directories outside the root. */
export function allowsExternalRequestDirs(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ALLOW_EXTERNAL_DIR_ENV] === "1";
}

/** Either the store a call should use, or the reason it was refused. */
type StoreResolution =
  | { ok: true; activeStore: Store; activeMemoryDir: string; activeRoot: string }
  | { ok: false; reason: string };

export function createServer(targetDir?: string, requestedProfile?: McpProfile): Server {
  const activeProfile = getActiveMcpProfile(requestedProfile);
  const resolvedTarget = targetDir || process.env.MUSE_MEMORY_PROJECT_DIR || process.env.PROJECT_ROOT || process.cwd();
  const { root, memoryDir } = findOrCreateProjectRoot(resolvedTarget);
  // #432: the server's own store goes through the cache too, so a request that
  // names this project's directory reuses it rather than opening a second one.
  const store = getCachedStore(memoryDir);

  /**
   * Resolve the store a tool call addresses.
   *
   * #512: `dir`/`workspace`/`project_dir`/`cwd` come from the model, and this
   * function used to hand them straight to `findOrCreateProjectRoot`, which
   * creates `.memory/` wherever it is told. A prompt-injected agent could
   * therefore point the store at `/`, at `$HOME`, or at another tenant's
   * checkout and read or write there. The request directory is now confined to
   * the workspace root this server was started for — resolved through
   * `realishPath` so a symlinked prefix cannot launder an escape — and a
   * directory outside it is rejected *before* `findOrCreateProjectRoot`, so no
   * store is created for a rejected path. `MUSE_MCP_ALLOW_EXTERNAL_DIR=1` is the
   * operator's opt-in for the deliberate multi-project workflow.
   */
  function resolveStoreForRequest(
    a?: Record<string, unknown>,
  ): StoreResolution {
    const requested = a?.dir || a?.workspace || a?.project_dir || a?.cwd;
    if (typeof requested === "string" && requested.trim()) {
      const raw = requested.trim();

      if (!allowsExternalRequestDirs()) {
        let candidate: string;
        let configuredRoot: string;
        try {
          candidate = realishPath(raw);
          configuredRoot = realishPath(root);
        } catch (err: unknown) {
          return {
            ok: false,
            reason: `Invalid directory '${raw}': ${err instanceof Error ? err.message : String(err)}.`,
          };
        }
        if (!isWithinRoot(configuredRoot, candidate)) {
          return {
            ok: false,
            reason:
              `Directory '${raw}' resolves to '${candidate}', which is outside the MCP workspace root ` +
              `'${configuredRoot}'. Omit 'dir' to use the configured store, or start the server with ` +
              `${ALLOW_EXTERNAL_DIR_ENV}=1 to permit external directories.`,
          };
        }
      }

      const resolved = findOrCreateProjectRoot(raw);
      return {
        ok: true,
        activeStore: getCachedStore(resolved.memoryDir),
        activeMemoryDir: resolved.memoryDir,
        activeRoot: resolved.root,
      };
    }
    return { ok: true, activeStore: store, activeMemoryDir: memoryDir, activeRoot: root };
  }

  const server = new Server(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    {
      capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
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
    const resolution = resolveStoreForRequest(a);
    // #512: a rejected directory is a tool error, not a crash and not a silent
    // fallback to the configured store — the caller must see which root bounds it.
    if (!resolution.ok) return toolError(resolution.reason);
    const { activeStore, activeMemoryDir, activeRoot } = resolution;

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

  // --- #494: resources -------------------------------------------------------
  // `resources/list` advertises only the four stable documents. Enumerating
  // every memory entry here would be an unbounded token cost for a client that
  // asked for an index; entries stay reachable by id via `memory://entry/<id>`.
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: STATIC_MCP_RESOURCES.map((resource) => ({ ...resource })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    // `readMcpResource` throws McpError(-32602) for an unknown or malformed URI
    // and for an entry id the store does not hold, so the rejection reaches the
    // client as a JSON-RPC error instead of an empty document.
    const resource = readMcpResource(store, memoryDir, request.params.uri);
    return { contents: [resource] };
  });

  // --- #494: prompts ---------------------------------------------------------
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: listMcpPrompts(),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: promptArgs } = request.params;
    return getMcpPrompt(memoryDir, name, (promptArgs ?? {}) as Record<string, string>);
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

/**
 * #494: the protocol revisions this server accepts, newest first.
 *
 * Bound to the installed SDK's own list rather than duplicated, because the SDK
 * is what actually negotiates: it answers `initialize` with the client's version
 * when that version is in `SUPPORTED_PROTOCOL_VERSIONS` and falls back to
 * `LATEST_PROTOCOL_VERSION` otherwise. A hand-maintained copy here could only
 * drift from the negotiation it is supposed to describe. The installed
 * `@modelcontextprotocol/sdk@1.32.2` list is
 * `['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']`.
 *
 * This is also the HTTP transport's `mcp-protocol-version` allowlist, so a
 * header naming anything else is rejected with 400 (see `src/mcp/http.ts`).
 */
export const SUPPORTED_MCP_PROTOCOL_VERSIONS: readonly string[] = [...SUPPORTED_PROTOCOL_VERSIONS];
