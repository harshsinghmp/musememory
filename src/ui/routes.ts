/**
 * Studio route table (issue #450).
 *
 * Every `/api` branch that used to live inline in `startUiServer()`'s if-chain
 * is a `UiHandler` here, keyed by `${METHOD} ${path}` in `STUDIO_ROUTES`.
 * `startUiServer()` keeps the server itself: socket/port lifecycle, the URL
 * parse, security/CORS/CSRF/OPTIONS handling, static asset serving and
 * dispatch.
 *
 * Dispatch is an exact-match `Map` lookup, never an ordered scan. Every branch
 * that moved was `pathname === "/api/..." && req.method === "GET" | "POST"`, so
 * the if-chain carried no ordering semantics: no `startsWith`, no regex, and no
 * branch that shadowed another (the only shared path is `/api/current`, split
 * by method, so the keys never collide). `/`, `/index.html` and the
 * `/assets/studio.*` shell are not in the table — they are static file serving
 * and stay in `startUiServer()`.
 *
 * The only state shared across requests lives in one explicit
 * `StudioRouterState` per server — the T-466 projection cache and its
 * generation, the lazily opened global store, the mesh topology/result caches,
 * the agent hub cache and the backup counter. Handlers reach it through
 * `UiRouteContext`; nothing else is closed over.
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Store } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import {
  confirm,
  deleteEntry,
  getStorageLayout,
  list,
  markStale,
  openStore,
  propose,
  supersede,
} from "../store.ts";
import { getGlobalMemoryDir } from "../root.ts";
import { constantTimeEqual } from "../security/timing.ts";
import { writeWorkspaceTerrain } from "../vault/index.ts";
import { discoverAgentHub } from "../agents/hub.ts";
import { connectAgent, disconnectSingleAgent } from "../connect.ts";
import { renderStandaloneHtml } from "../ui_assets.ts";
import { setCurrent, updateSessionHandoff, WorkspaceGovernor } from "../governor.ts";
import { getUserProfile, initUserProfile, setUserProfile, type UserArchetype } from "../user.ts";
import { getAuditTrail } from "../audit.ts";
import { getWikiPage, listWikiPages } from "../wiki/index.ts";
import { RetrievalEngine, rankAndRetrieveMemories } from "../retrieval/index.ts";
import { estimateTokens } from "../compress.ts";
import { validateStore } from "../schema.ts";
import { exportSnapshot } from "../snapshot.ts";
import { evaluateProjectHealth, formatAvailable, resolveProjectName } from "../health/index.ts";
import { detectDocumentationCodeDrift, listAdrs } from "../adrs/index.ts";
import {
  analyzeTechnicalDebt,
  clusterRecurringBugsAndFriction,
  explainWhyCodeIsTheWayItIs,
} from "../cognition/index.ts";
import { broadcastKnowledge, getSyncStatus, syncWithSharedPool } from "../sync/index.ts";
import { addMeshLink, auditMeshContracts, discoverWorkspaceMesh, resolveMeshMemories } from "../mesh/index.ts";

/** Explicit projection contract for UI read routes (T-400). */
export interface ProjectedUiMemory {
  id: string;
  title: string;
  content: string;
  type: string;
  status: string;
  project?: string;
  tags: string[];
  salience?: number;
  verification?: {
    level?: string;
    method?: string;
    verified_at?: string;
  };
  related_memory_ids?: string[];
  created_at: string;
  updated_at?: string;
  /** Scope origin added only by the cross-project mesh view (T-452). */
  origin_project?: string;
}

/** Project raw MemoryEntry into safe UI allowlist schema (T-400). */
export function projectMemoryForUi(entry: MemoryEntry): ProjectedUiMemory {
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    type: entry.type || "discovery",
    status: entry.status,
    project: entry.project,
    tags: Array.isArray(entry.tags) ? [...entry.tags] : [],
    salience: typeof entry.salience === "number" ? entry.salience : 0.5,
    verification: entry.verification
      ? {
          level: entry.verification.level,
          method: entry.verification.method,
          verified_at: entry.verification.verified_at,
        }
      : undefined,
    related_memory_ids: Array.isArray(entry.related_memory_ids) ? [...entry.related_memory_ids] : [],
    created_at: entry.created_at,
    updated_at: entry.updated_at,
  };
}

/** T-452: the studio reads memories/stats from one of three scopes. */
export type StudioScope = "project" | "global" | "mesh";

interface ProjectionCacheEntry {
  version: number;
  token: string;
  body: string;
}

type MeshTopology = ReturnType<typeof discoverWorkspaceMesh>;

interface TopologyCacheEntry {
  key: string;
  at: number;
  topology: MeshTopology;
}

interface MeshResultCacheEntry {
  key: string;
  at: number;
  results: Array<{ entry: MemoryEntry; origin: string }>;
}

/**
 * Everything that has to outlive a single request. One instance per
 * `startUiServer()` call, created by `createStudioRouter()`.
 */
export interface StudioRouterState {
  /**
   * Generation counter for the projection cache. Incremented by the caller for
   * every mutation POST before dispatch, so a read can never see a stale body.
   */
  projectionVersion: number;
  /** T-466: read projections cached per scope, invalidated by writes. */
  projectionCache: Map<string, ProjectionCacheEntry>;
  /** Lazily opened global store (a read must not create one). */
  globalStoreCache: { dir: string; store: Store } | undefined;
  topologyCache: TopologyCacheEntry | undefined;
  meshResultCache: MeshResultCacheEntry | undefined;
  /** Agent hub discovery cache, 5s TTL, cleared by wire/unwire. */
  agentHubCache: { at: number; body: string } | undefined;
  /** Monotonic counter so two backups of the same target never collide. */
  backupSeq: number;
}

export interface StudioRouterOptions {
  store: Store;
  memoryDir: string;
  token?: string;
}

/** Exactly what a handler needs: the store, the request, and the helpers. */
export interface UiRouteContext {
  /** Project store the server was started with; writes stay project-scoped. */
  readonly store: Store;
  /** Memory directory the server was started with. */
  readonly memoryDir: string;
  /** Optional UI auth token from `UiServerOptions` (falls back to `MUSE_UI_TOKEN`). */
  readonly token?: string;
  /** Parsed request URL (pathname + query params). */
  readonly url: URL;
  /** Mutable per-server state: caches and counters only. */
  readonly state: StudioRouterState;
  /** Read the request body as JSON (1 MB cap). */
  body(): Promise<Record<string, unknown>>;
  /** `writeHead(status, {"Content-Type": "application/json"})` + JSON body. */
  json(status: number, body: unknown): void;
  /** Workspace root: the store's layout root, else derived from `memoryDir`. */
  workspaceRoot(): string;
  /** `?scope=` → `project` (default) | `global` | `mesh`. */
  parseScope(): StudioScope;
  /** Cache-busting token for a scope's on-disk mtimes / mesh window. */
  freshnessToken(scope: StudioScope): string;
  /** View over the requested scope; undefined when its store is unavailable. */
  scopedView(scope: StudioScope): { store: Store; memoryDir: string } | undefined;
  /** Lazily opened global store; undefined when it does not already exist. */
  openGlobalStore(): Store | undefined;
  meshTopology(): MeshTopology;
  meshMemories(limit: number): Array<{ entry: MemoryEntry; origin: string }>;
  invalidateMeshTopology(): void;
  /** Keep at most `keep` `<file>.<timestamp>.<n>.bak` backups per target. */
  pruneBackups(target: string, keep?: number): void;
}

export type UiHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: UiRouteContext,
) => Promise<void> | void;

/**
 * Safer inversion: only these POSTs are read-only; everything else bumps
 * `projectionVersion`, so a forgotten route can only cause a cache MISS, never
 * a stale HIT. `/api/search` records retrieval telemetry, so it is not here.
 */
export const READ_ONLY_POST_ROUTES: ReadonlySet<string> = new Set(["/api/cognition/why"]);

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB payload limit

function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    let byteLength = 0;
    req.on("data", (chunk: Buffer | string) => {
      byteLength += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      if (byteLength > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("Payload too large: request body exceeds 1MB limit"));
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function parseScope(u: URL): StudioScope {
  const raw = u.searchParams.get("scope");
  return raw === "global" || raw === "mesh" ? raw : "project";
}

function freshnessToken(memoryDir: string, scope: StudioScope): string {
  const dir = scope === "global" ? getGlobalMemoryDir() : memoryDir;
  if (scope === "mesh") return `mesh:${Math.floor(Date.now() / 2000)}`;
  const layout = getStorageLayout(dir);
  // WAL commits land in dbPath-wal; the YAML mirror lands in memoriesDir.
  // Probe every path a writer can touch, and use "-" (never a fake zero)
  // when a path does not exist yet.
  const probed = [dir, layout.memoriesDir, layout.dbPath, `${layout.dbPath}-wal`, `${layout.dbPath}-journal`];
  return probed
    .map((candidate) => {
      try {
        return String(statSync(candidate).mtimeMs);
      } catch {
        return "-";
      }
    })
    .join(":");
}

function openGlobalStore(state: StudioRouterState): Store | undefined {
  const dir = getGlobalMemoryDir();
  if (!existsSync(dir)) return undefined;
  const layout = getStorageLayout(dir);
  // A read must not mint a store. Both the YAML mirror and the SQLite file
  // have to already exist, and opening must not re-sync CURRENT.md or the wiki.
  if (!existsSync(layout.memoriesDir) || !existsSync(layout.dbPath)) return undefined;
  if (!state.globalStoreCache || state.globalStoreCache.dir !== dir) {
    state.globalStoreCache = {
      dir,
      store: openStore(dir, { skipSyncConstraints: true, skipAutoWiki: true }),
    };
  }
  return state.globalStoreCache.store;
}

function meshTopology(state: StudioRouterState, store: Store, memoryDir: string): MeshTopology {
  const workspaceRoot = store.layout?.root || getStorageLayout(memoryDir).root;
  const key = `${workspaceRoot}|${memoryDir}`;
  const now = Date.now();
  if (!state.topologyCache || state.topologyCache.key !== key || now - state.topologyCache.at > 2000) {
    state.topologyCache = { key, at: now, topology: discoverWorkspaceMesh(workspaceRoot, memoryDir) };
  }
  return state.topologyCache.topology;
}

function meshMemories(
  state: StudioRouterState,
  store: Store,
  memoryDir: string,
  limit: number,
): Array<{ entry: MemoryEntry; origin: string }> {
  const topology = meshTopology(state, store, memoryDir);
  const key = `${topology.rootPath}|${topology.updatedAt}|${limit}`;
  const now = Date.now();
  if (!state.meshResultCache || state.meshResultCache.key !== key || now - state.meshResultCache.at > 2000) {
    state.meshResultCache = {
      key,
      at: now,
      results: resolveMeshMemories(store, topology, { query: "", limit }).map((r) => ({
        entry: r.memory,
        origin: r.originProject,
      })),
    };
  }
  return state.meshResultCache.results;
}

function pruneBackups(target: string, keep = 3): void {
  try {
    const dir = dirname(target);
    const prefix = `${basename(target)}.`;
    const backups = readdirSync(dir)
      .filter((name) => name.startsWith(prefix) && name.endsWith(".bak"))
      .sort();
    for (const stale of backups.slice(0, Math.max(0, backups.length - keep))) {
      try {
        unlinkSync(join(dir, stale));
      } catch {
        // retention is best-effort; never fail a wire over it
      }
    }
  } catch {
    // missing directory is not an error for retention
  }
}

// Reads that have a meaningful global counterpart (CURRENT.md, wiki, persona,
// audit) follow the scope too. Writes stay project-scoped by design; the
// client shows a banner whenever the viewed scope is not the project store.
function scopedView(
  store: Store,
  memoryDir: string,
  state: StudioRouterState,
  scope: StudioScope,
): { store: Store; memoryDir: string } | undefined {
  if (scope === "global") {
    const globalStore = openGlobalStore(state);
    return globalStore ? { store: globalStore, memoryDir: getGlobalMemoryDir() } : undefined;
  }
  return { store, memoryDir };
}

const ROUTES = new Map<string, UiHandler>();

function add(method: string, path: string, handler: UiHandler): void {
  const key = `${method} ${path}`;
  if (ROUTES.has(key)) throw new Error(`Duplicate studio route: ${key}`);
  ROUTES.set(key, handler);
}

add("GET", "/api/memories", async (req, res, ctx) => {
  const scope = ctx.parseScope();
  const token = ctx.freshnessToken(scope);
  const cached = ctx.state.projectionCache.get(scope);
  if (cached && cached.version === ctx.state.projectionVersion && cached.token === token) {
    res.writeHead(200, { "Content-Type": "application/json", "X-Cache": "HIT" });
    res.end(cached.body);
    return;
  }
  let projected: ProjectedUiMemory[];
  if (scope === "mesh") {
    projected = ctx.meshMemories(200).map((r) => ({
      ...projectMemoryForUi(r.entry),
      origin_project: r.origin,
    }));
  } else if (scope === "global") {
    const globalStore = ctx.openGlobalStore();
    projected = globalStore ? list(globalStore).map(projectMemoryForUi) : [];
  } else {
    projected = list(ctx.store).map(projectMemoryForUi);
  }
  const body = JSON.stringify(projected);
  ctx.state.projectionCache.set(scope, { version: ctx.state.projectionVersion, token, body });
  res.writeHead(200, { "Content-Type": "application/json", "X-Cache": "MISS" });
  res.end(body);
});

add("GET", "/api/stats", async (req, res, ctx) => {
  const scope = ctx.parseScope();
  const statsKey = `stats:${scope}`;
  const statsToken = ctx.freshnessToken(scope);
  const cachedStats = ctx.state.projectionCache.get(statsKey);
  if (cachedStats && cachedStats.version === ctx.state.projectionVersion && cachedStats.token === statsToken) {
    res.writeHead(200, { "Content-Type": "application/json", "X-Cache": "HIT" });
    res.end(cachedStats.body);
    return;
  }
  const metaStore = scope === "global" ? ctx.openGlobalStore() : ctx.store;
  const metaDir = scope === "global" ? getGlobalMemoryDir() : ctx.memoryDir;
  const memories: MemoryEntry[] = scope === "mesh"
    ? ctx.meshMemories(200).map((r) => r.entry)
    : metaStore ? list(metaStore) : [];
  const activeState = metaStore ? WorkspaceGovernor.getActiveState(metaStore, metaDir) : undefined;
  const wiki = metaStore ? listWikiPages(metaDir) : [];
  const trail = metaStore ? getAuditTrail(metaDir, { limit: 100 }) : [];
  const typeCounts: Record<string, number> = {};
  let confirmedCount = 0;
  let linksCount = 0;

  for (const m of memories) {
    typeCounts[m.type || "discovery"] = (typeCounts[m.type || "discovery"] || 0) + 1;
    if (m.status === "confirmed") confirmedCount++;
    linksCount += (m.related_memory_ids || []).length;
  }

  const statsBody = JSON.stringify({
    scope,
    available: scope !== "global" || Boolean(metaStore),
    total: memories.length,
    confirmed: confirmedCount,
    confirmedRatio: memories.length > 0 ? (confirmedCount / memories.length).toFixed(2) : "0.00",
    constraints: activeState ? activeState.constraints.length : 0,
    wikiPages: wiki.length,
    auditEvents: trail.length,
    links: Math.floor(linksCount / 2),
    typeCounts,
    handoff: activeState ? activeState.handoff : null,
  });
  ctx.state.projectionCache.set(statsKey, { version: ctx.state.projectionVersion, token: statsToken, body: statsBody });
  res.writeHead(200, { "Content-Type": "application/json", "X-Cache": "MISS" });
  res.end(statsBody);
});

add("GET", "/api/snapshot", async (req, res, ctx) => {
  const snapshot = exportSnapshot(ctx.store);
  const projectedSnapshot = {
    ...snapshot,
    entries: snapshot.entries.map(projectMemoryForUi),
  };
  ctx.json(200, projectedSnapshot);
});

add("GET", "/api/validate", async (req, res, ctx) => {
  ctx.json(200, validateStore(ctx.store));
});

add("GET", "/api/current", async (req, res, ctx) => {
  const view = ctx.scopedView(ctx.parseScope());
  const state = view ? WorkspaceGovernor.getActiveState(view.store, view.memoryDir) : undefined;
  ctx.json(200, { lines: state ? state.constraints : [], handoff: state ? state.handoff : null });
});

add("POST", "/api/current", async (req, res, ctx) => {
  try {
    const body = await ctx.body();
    if (body.text) {
      // #433: an over-length constraint is a bad request, not a server fault.
      let lines: string[];
      try {
        lines = setCurrent(ctx.memoryDir, String(body.text), String(body.project || "default"));
      } catch (err: unknown) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        return;
      }
      ctx.json(200, { lines });
      return;
    }
    if (body.handoff) {
      const updated = updateSessionHandoff(ctx.memoryDir, body.handoff as any);
      ctx.json(200, updated);
      return;
    }
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid current request" }));
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

add("GET", "/api/wiki", async (req, res, ctx) => {
  const view = ctx.scopedView(ctx.parseScope());
  const pageSlug = ctx.url.searchParams.get("page");
  if (pageSlug) {
    const page = view ? getWikiPage(view.memoryDir, pageSlug) : undefined;
    if (!page) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Wiki page '${pageSlug}' not found` }));
      return;
    }
    ctx.json(200, page);
    return;
  }
  const pages = view ? listWikiPages(view.memoryDir) : [];
  ctx.json(200, { pages });
});

add("GET", "/api/user-profile", async (req, res, ctx) => {
  const view = ctx.scopedView(ctx.parseScope());
  const profile = view ? getUserProfile(view.memoryDir) : null;
  ctx.json(200, { profile });
});

add("POST", "/api/user-profile", async (req, res, ctx) => {
  try {
    const body = await ctx.body();
    const archetype = body.archetype as UserArchetype | undefined;
    if (archetype) {
      initUserProfile(ctx.memoryDir, archetype);
    } else if (body.content) {
      setUserProfile(ctx.memoryDir, String(body.content));
    }
    const updated = getUserProfile(ctx.memoryDir);
    ctx.json(200, { profile: updated });
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

add("GET", "/api/activity", async (req, res, ctx) => {
  const activityScope = ctx.parseScope();
  const view = ctx.scopedView(activityScope);
  if (!view) {
    ctx.json(200, { scope: activityScope, available: false, days: [], sessions: [], total_mutations: 0 });
    return;
  }
  const trail = getAuditTrail(view.memoryDir, { limit: 5000 });
  const counts = new Map<string, number>();
  for (const event of trail) {
    const date = String(event.timestamp || "").slice(0, 10);
    if (date) counts.set(date, (counts.get(date) || 0) + 1);
  }
  const days: Array<{ date: string; count: number }> = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let offset = 370; offset >= 0; offset--) {
    const day = new Date(today);
    day.setDate(day.getDate() - offset);
    const key = day.toISOString().slice(0, 10);
    days.push({ date: key, count: counts.get(key) || 0 });
  }
  const entries = list(view.store);
  const bySession = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    if (!entry.session_id) continue;
    const bucket = bySession.get(entry.session_id) || [];
    bucket.push(entry);
    bySession.set(entry.session_id, bucket);
  }
  const sessions = [...bySession.entries()]
    .map(([sessionId, bucket]) => {
      const ordered = [...bucket].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const start = ordered.find((e) => e.type === "session" && /start/i.test(e.title)) || ordered[0];
      const end = ordered.find((e) => e.type === "session" && /(end|complete)/i.test(e.title));
      return {
        session_id: sessionId,
        title: start.title,
        started_at: start.created_at,
        ended_at: end ? end.created_at : undefined,
        status: end ? "completed" : "active",
        messages: ordered.filter((e) => e.type !== "session").length,
        tags: start.tags || [],
      };
    })
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))
    .slice(0, 24);
  ctx.json(200, {
    scope: activityScope,
    available: true,
    days,
    sessions,
    total_mutations: trail.length,
  });
});

add("GET", "/api/agents", async (req, res, ctx) => {
  const cache = ctx.state.agentHubCache;
  if (cache && Date.now() - cache.at < 5000) {
    res.writeHead(200, { "Content-Type": "application/json", "X-Cache": "HIT" });
    res.end(cache.body);
    return;
  }
  const agents = discoverAgentHub();
  const counts = {
    wired: agents.filter((a) => a.status === "WIRED").length,
    unwired: agents.filter((a) => a.status === "UNWIRED").length,
    absent: agents.filter((a) => a.status === "ABSENT").length,
  };
  const body = JSON.stringify({ agents, counts });
  ctx.state.agentHubCache = { at: Date.now(), body };
  res.writeHead(200, { "Content-Type": "application/json", "X-Cache": "MISS" });
  res.end(body);
});

add("GET", "/api/agents/manifest", async (req, res, ctx) => {
  const database = ctx.store.layout?.dbPath || join(ctx.memoryDir, "memory.db");
  const snippet = [
    "You have access to aimm over MCP (stdio).",
    "Server: memory mcp",
    `Memory directory: ${ctx.memoryDir}`,
    `Database: ${database}`,
    "Call memory_search before starting work, and memory_capture after decisions, fixes, or discoveries.",
  ].join("\n");
  ctx.json(200, {
    memoryDir: ctx.memoryDir,
    database,
    mcpCommand: "memory mcp",
    files: [ctx.memoryDir, database],
    snippet,
  });
});

add("POST", "/api/agents/wire", async (req, res, ctx) => {
  try {
    const body = await ctx.body();
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing required 'id' field" }));
      return;
    }
    if (id === "all") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "A specific agent id is required (not 'all')" }));
      return;
    }
    const dryRun = body.dryRun === true;
    const home = process.env.HOME || homedir();
    const detected = discoverAgentHub(home).find(
      (agent) => agent.id === id || agent.id.replace(/-cli$/, "") === id,
    );
    if (!detected) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Unknown agent '${id}'` }));
      return;
    }
    const backups: string[] = [];
    if (!dryRun) {
      const targets = new Set<string>();
      if (detected.configPath) targets.add(detected.configPath);
      if (detected.id === "claude-code") {
        targets.add(join(home, ".claude.json"));
        targets.add(join(home, ".claude", "settings.json"));
      }
      for (const target of targets) {
        if (!existsSync(target)) continue;
        const backup = `${target}.${Date.now()}.${++ctx.state.backupSeq}.bak`;
        try {
          copyFileSync(target, backup);
          ctx.pruneBackups(target);
          backups.push(backup);
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Backup failed for ${target}: ${err instanceof Error ? err.message : String(err)}` }));
          return;
        }
      }
    }
    const harness = typeof body.harness === "string" ? body.harness : undefined;
    ctx.state.agentHubCache = undefined;
    const reports = connectAgent(id, home, { dryRun, harness });
    if (reports.length === 1 && /^Unknown agent/.test(reports[0].message)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: reports[0].message }));
      return;
    }
    ctx.json(200, { success: reports.some((report) => report.updated || report.installed), backups, reports });
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

add("POST", "/api/agents/unwire", async (req, res, ctx) => {
  try {
    const body = await ctx.body();
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing required 'id' field" }));
      return;
    }
    const home = process.env.HOME || homedir();
    const known = discoverAgentHub(home).some(
      (agent) => agent.id === id || agent.id.replace(/-cli$/, "") === id,
    );
    if (!known) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Unknown agent '${id}'` }));
      return;
    }
    const report = disconnectSingleAgent(id, home, { dryRun: body.dryRun === true });
    ctx.state.agentHubCache = undefined;
    ctx.json(200, { success: report.updated, report });
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

add("GET", "/api/terrain", async (req, res, ctx) => {
  const terrainDir = join(ctx.memoryDir, "terrain");
  const names = ["repo.md", "stack.md", "habits.md", "ownership.md", "packages.md", "logs.md"];
  const files = names.map((name) => {
    const filePath = join(terrainDir, name);
    const generated = existsSync(filePath);
    let content = "";
    try {
      content = generated ? readFileSync(filePath, "utf8") : "";
    } catch {
      content = "";
    }
    return { name, generated, content };
  });
  ctx.json(200, { files, available: files.some((file) => file.generated) });
});

add("POST", "/api/terrain/reindex", async (req, res, ctx) => {
  try {
    const terrainRoot = ctx.workspaceRoot();
    const result = writeWorkspaceTerrain(terrainRoot, join(ctx.memoryDir, "terrain"));
    ctx.json(200, { success: true, files: result.files });
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

add("GET", "/api/audit", async (req, res, ctx) => {
  const rawLimit = parseInt(ctx.url.searchParams.get("limit") || "50", 10);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(1000, rawLimit) : 50;
  const view = ctx.scopedView(ctx.parseScope());
  const trail = view ? getAuditTrail(view.memoryDir, { limit }) : [];
  ctx.json(200, { trail });
});

add("POST", "/api/search", async (req, res, ctx) => {
  try {
    const body = await ctx.body();
    const query = String(body.query || "");
    const tokenBudget = typeof body.tokenBudget === "number" && Number.isFinite(body.tokenBudget) && body.tokenBudget > 0
      ? Math.min(100000, Math.floor(body.tokenBudget))
      : undefined;
    const rawLimit = typeof body.limit === "number" ? body.limit : 10;
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(500, rawLimit) : 10;
    const mode = body.mode as any || "auto";
    const resSearch = RetrievalEngine.search(ctx.store, ctx.memoryDir, query, {
      mode,
      tokenBudget,
      limit,
      type: body.type ? String(body.type) : undefined,
      status: body.status ? String(body.status) : undefined,
    });
    const promptCtx = RetrievalEngine.formatPromptContext(ctx.store, ctx.memoryDir, query, {
      tokenBudget,
      depth: body.depth as any || "L2",
    });
    ctx.json(200, { search: resSearch, promptContext: promptCtx });
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

add("POST", "/api/recall-debug", async (req, res, ctx) => {
  try {
    const body = await ctx.body();
    const query = String(body.query || "");
    if (!query.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "query is required" }));
      return;
    }
    const rawLimit = typeof body.limit === "number" ? body.limit : 10;
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(100, rawLimit) : 10;
    const rawBudget = typeof body.tokenBudget === "number" && Number.isFinite(body.tokenBudget) && body.tokenBudget > 0
      ? Math.min(100000, Math.floor(body.tokenBudget))
      : undefined;
    // R32: reuse the canonical ranker. A second scoring path here would
    // let the panel disagree with what recall actually did.
    const ranked = await rankAndRetrieveMemories(ctx.store, query, {
      limit,
      tokenBudget: rawBudget,
      project: body.project ? String(body.project) : undefined,
      activeFilePath: body.activeFilePath ? String(body.activeFilePath) : undefined,
      targetSymbol: body.targetSymbol ? String(body.targetSymbol) : undefined,
    });
    const totalTokens = ranked.reduce((sum, r) => sum + estimateTokens(`${r.entry.title}\n${r.entry.content}`), 0);
    ctx.json(200, {
      query,
      limit,
      tokenBudget: rawBudget ?? null,
      totalTokens,
      count: ranked.length,
      results: ranked.map((r) => ({
        id: r.entry.id,
        title: r.entry.title,
        type: r.entry.type,
        status: r.entry.status,
        project: r.entry.project,
        score: Number(r.score.toFixed(4)),
        why_retrieved: r.why_retrieved ?? [],
        factors: r.factors,
      })),
    });
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

add("POST", "/api/propose", async (req, res, ctx) => {
  try {
    const body = await ctx.body();
    const entry = propose(ctx.store, {
      content: String(body.content || ""),
      project: String(body.project || "default"),
      title: body.title ? String(body.title) : undefined,
      tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
      type: body.type as any,
      confirmed: body.confirmed === true,
    });
    ctx.json(200, entry);
  } catch (err: unknown) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

add("POST", "/api/confirm", async (req, res, ctx) => {
  try {
    const body = await ctx.body();
    const entry = confirm(ctx.store, String(body.id));
    if (!entry) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Could not confirm ${body.id}` }));
      return;
    }
    ctx.json(200, entry);
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

add("POST", "/api/mark-stale", async (req, res, ctx) => {
  try {
    const body = await ctx.body();
    const entry = markStale(ctx.store, String(body.id), body.reason ? String(body.reason) : undefined);
    if (!entry) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Could not mark ${body.id} stale` }));
      return;
    }
    ctx.json(200, entry);
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

add("POST", "/api/supersede", async (req, res, ctx) => {
  try {
    const body = await ctx.body();
    const entry = supersede(ctx.store, String(body.oldId), String(body.newId));
    if (!entry) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Could not supersede ${body.oldId} with ${body.newId}` }));
      return;
    }
    ctx.json(200, entry);
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

add("POST", "/api/delete", async (req, res, ctx) => {
  try {
    const body = await ctx.body();
    const ok = deleteEntry(ctx.store, String(body.id), body.reason ? String(body.reason) : "Web UI delete", "web_user");
    if (!ok) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Could not delete ${body.id}` }));
      return;
    }
    ctx.json(200, { success: true, id: body.id });
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

add("POST", "/api/refresh", async (req, res, ctx) => {
  try {
    const body = await ctx.body();
    let harvestedCount = 0;
    if (body.harvest === true) {
      try {
        const { harvestAllAgentTranscripts } = await import("../harvester.ts");
        const h = harvestAllAgentTranscripts(ctx.store, { memoryDir: ctx.memoryDir });
        harvestedCount = h.memoriesImported;
      } catch {}
    }
    const memories = list(ctx.store);
    const activeState = WorkspaceGovernor.getActiveState(ctx.store, ctx.memoryDir);
    ctx.json(200, {
      success: true,
      totalMemories: memories.length,
      activeConstraints: activeState.constraints.length,
      harvestedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

add("POST", "/api/optimize", async (req, res, ctx) => {
  try {
    const body = await ctx.body();
    const dryRun = body.dryRun !== false; // Default to dryRun: true (T-004)

    // Localhost / Token Gate (T-004)
    const expectedToken = ctx.token || process.env.MUSE_UI_TOKEN;
    const remoteIp = req.socket?.remoteAddress;
    const isLoopback = remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp === "::ffff:127.0.0.1";
    const headerToken = req.headers["x-muse-token"];
    const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : undefined;
    const bearerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader;
    const providedToken = (typeof headerToken === "string" ? headerToken : undefined) || bearerToken;

    if (expectedToken) {
      // Issue #513: `providedToken !== expectedToken` stops at the first
      // differing character, so the response time described a prefix of the
      // configured Studio token. The comparison is now constant-time; the gate
      // itself (403 on mismatch, loopback fallback otherwise) is unchanged.
      if (!constantTimeEqual(providedToken ?? "", expectedToken)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden: Invalid or missing authentication token" }));
        return;
      }
    } else if (!isLoopback && !dryRun) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden: Non-dryRun optimization requires localhost origin or configured token" }));
      return;
    }

    const { optimizeStore } = await import("../optimize.ts");
    const report = optimizeStore(ctx.store, {
      memoryDir: ctx.memoryDir,
      project: body.project ? String(body.project) : undefined,
      dryRun,
      force: body.force !== false,
    });
    ctx.json(200, { success: true, report });
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

add("GET", "/api/optimize/status", async (req, res, ctx) => {
  try {
    const { readOptimizationMetadata, shouldAutoOptimize } = await import("../optimize.ts");
    const meta = readOptimizationMetadata(ctx.memoryDir);
    const autoCheck = shouldAutoOptimize(ctx.memoryDir);
    ctx.json(200, {
      success: true,
      meta,
      shouldAutoOptimize: autoCheck.shouldRun,
      autoOptimizeReason: autoCheck.reason,
    });
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

// R15: Project Health Gate Endpoint
add("GET", "/api/health", async (req, res, ctx) => {
  const workspaceRoot = ctx.workspaceRoot();
  try {
    // T-321: optional project scope filter.
    // T-406: the requested name resolves case-insensitively to the
    // canonical store spelling; an unknown project answers 404 with
    // what IS available instead of a silent 200-empty report.
    const requestedProject = ctx.url.searchParams.get("project")?.trim() || undefined;
    const canonicalProject = resolveProjectName(ctx.store, requestedProject);
    if (requestedProject && canonicalProject === undefined) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `no memories for project "${requestedProject}" — available: ${formatAvailable(ctx.store)}`,
        }),
      );
      return;
    }
    const report = evaluateProjectHealth(ctx.store, workspaceRoot, {
      project: canonicalProject,
    });
    ctx.json(200, report);
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

// R15: Architecture Decision Records Endpoint
add("GET", "/api/adrs", async (req, res, ctx) => {
  try {
    const adrs = listAdrs(ctx.store);
    ctx.json(200, adrs);
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

// R15: Code ↔ Documentation Drift Endpoint
add("GET", "/api/drift", async (req, res, ctx) => {
  const workspaceRoot = ctx.workspaceRoot();
  try {
    // T-321: optional project scope filter.
    // T-406 fan-out: the requested name resolves case-insensitively to
    // the canonical store spelling; an unknown project answers 404 with
    // what IS available instead of a silent 200-empty report.
    const requestedProject = ctx.url.searchParams.get("project")?.trim() || undefined;
    const canonicalProject = resolveProjectName(ctx.store, requestedProject);
    if (requestedProject && canonicalProject === undefined) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `no memories for project "${requestedProject}" — available: ${formatAvailable(ctx.store)}`,
        }),
      );
      return;
    }
    const drift = detectDocumentationCodeDrift(ctx.store, workspaceRoot, {
      project: canonicalProject,
    });
    ctx.json(200, drift);
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

// R15: Cognition "Why" Reasoner Endpoint
add("POST", "/api/cognition/why", async (req, res, ctx) => {
  try {
    const body = await ctx.body();
    const query = typeof body.query === "string" ? body.query : (typeof body.symbol_or_path === "string" ? body.symbol_or_path : "");
    const explanation = explainWhyCodeIsTheWayItIs(ctx.store, {
      target: query,
      filePath: typeof body.file_path === "string" ? body.file_path : undefined,
      symbolName: typeof body.symbol_name === "string" ? body.symbol_name : undefined,
    });
    ctx.json(200, explanation);
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

// R15: Cognition Recurring Bug Clusters Endpoint
add("GET", "/api/cognition/clusters", async (req, res, ctx) => {
  try {
    // T-321: optional project scope filter.
    // T-406 fan-out: the requested name resolves case-insensitively to
    // the canonical store spelling; an unknown project answers 404 with
    // what IS available instead of a silent 200-empty report.
    const requestedProject = ctx.url.searchParams.get("project")?.trim() || undefined;
    const canonicalProject = resolveProjectName(ctx.store, requestedProject);
    if (requestedProject && canonicalProject === undefined) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `no memories for project "${requestedProject}" — available: ${formatAvailable(ctx.store)}`,
        }),
      );
      return;
    }
    const clusters = clusterRecurringBugsAndFriction(ctx.store, {
      project: canonicalProject,
    });
    ctx.json(200, { total_clusters: clusters.length, clusters });
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

// R15: Cognition Technical Debt Endpoint
add("GET", "/api/cognition/debt", async (req, res, ctx) => {
  const workspaceRoot = ctx.workspaceRoot();
  try {
    // T-321: optional project scope filter.
    // T-406 fan-out: the requested name resolves case-insensitively to
    // the canonical store spelling; an unknown project answers 404 with
    // what IS available instead of a silent 200-empty report.
    const requestedProject = ctx.url.searchParams.get("project")?.trim() || undefined;
    const canonicalProject = resolveProjectName(ctx.store, requestedProject);
    if (requestedProject && canonicalProject === undefined) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `no memories for project "${requestedProject}" — available: ${formatAvailable(ctx.store)}`,
        }),
      );
      return;
    }
    const debt = analyzeTechnicalDebt(ctx.store, workspaceRoot, {
      project: canonicalProject,
    });
    ctx.json(200, debt);
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

// R15: P2P Sync Status Endpoint
add("GET", "/api/sync/status", async (req, res, ctx) => {
  const workspaceRoot = ctx.workspaceRoot();
  try {
    const status = getSyncStatus(ctx.store, workspaceRoot);
    ctx.json(200, status);
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

// R15: P2P Sync Pool Endpoint
add("POST", "/api/sync/pool", async (req, res, ctx) => {
  const workspaceRoot = ctx.workspaceRoot();
  try {
    const body = await ctx.body();
    const poolDir = typeof body.pool_dir === "string" ? body.pool_dir : undefined;
    const agentId = typeof body.agent_id === "string" ? body.agent_id : undefined;
    const report = syncWithSharedPool(ctx.store, workspaceRoot, poolDir, agentId);
    ctx.json(200, report);
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

// R15: P2P Broadcast Endpoint
add("POST", "/api/sync/broadcast", async (req, res, ctx) => {
  const workspaceRoot = ctx.workspaceRoot();
  try {
    const body = await ctx.body();
    const agentId = typeof body.agent_id === "string" ? body.agent_id : undefined;
    const project = typeof body.project === "string" ? body.project : undefined;
    const packet = broadcastKnowledge(ctx.store, workspaceRoot, { agentId, project });
    ctx.json(200, packet);
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

// R16: Mesh Topology Status Endpoint
add("GET", "/api/mesh/status", async (req, res, ctx) => {
  try {
    const topology = ctx.meshTopology();
    ctx.json(200, topology);
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

// R16: Mesh Cross-Project Query Endpoint
add("GET", "/api/mesh/query", async (req, res, ctx) => {
  try {
    const q = ctx.url.searchParams.get("q") || "";
    const topology = ctx.meshTopology();
    const results = resolveMeshMemories(ctx.store, topology, { query: q });
    ctx.json(200, results);
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

// R16: Mesh Contract Audit Endpoint
add("GET", "/api/mesh/audit", async (req, res, ctx) => {
  try {
    const topology = ctx.meshTopology();
    const audit = auditMeshContracts(topology, ctx.store);
    ctx.json(200, audit);
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

// R16: Mesh Link Endpoint
add("POST", "/api/mesh/link", async (req, res, ctx) => {
  try {
    const body = await ctx.body();
    const targetPath = typeof body.path === "string" ? body.path : "";
    if (!targetPath) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing required 'path' field" }));
      return;
    }
    addMeshLink(ctx.memoryDir, targetPath);
    ctx.invalidateMeshTopology();
    ctx.json(200, { success: true, linked: targetPath });
  } catch (err: unknown) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

add("GET", "/api/export-html", async (req, res, ctx) => {
  const html = renderStandaloneHtml(ctx.store);
  res.setHeader("Content-Disposition", 'attachment; filename="musememory-graph.html"');
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});

/** `METHOD path` → handler. Exact matches only; see the module comment. */
export const STUDIO_ROUTES: ReadonlyMap<string, UiHandler> = ROUTES;

/** The dispatch surface `startUiServer()` holds on to, one per server. */
export interface StudioRouter {
  /** Run the handler for `${req.method} ${url.pathname}`; false when absent. */
  dispatch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean>;
  /** A mutation POST: make every cached projection unreadable. */
  invalidateProjections(): void;
  /** Release the lazily opened global store handle, if any. */
  close(): void;
}

export function createStudioRouter(opts: StudioRouterOptions): StudioRouter {
  const state: StudioRouterState = {
    projectionVersion: 0,
    projectionCache: new Map(),
    globalStoreCache: undefined,
    topologyCache: undefined,
    meshResultCache: undefined,
    agentHubCache: undefined,
    backupSeq: 0,
  };

  const createContext = (req: IncomingMessage, res: ServerResponse, url: URL): UiRouteContext => ({
    store: opts.store,
    memoryDir: opts.memoryDir,
    token: opts.token,
    url,
    state,
    body: () => parseJsonBody(req),
    json: (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    },
    workspaceRoot: () => opts.store.layout?.root || getStorageLayout(opts.memoryDir).root,
    parseScope: () => parseScope(url),
    freshnessToken: (scope) => freshnessToken(opts.memoryDir, scope),
    scopedView: (scope) => scopedView(opts.store, opts.memoryDir, state, scope),
    openGlobalStore: () => openGlobalStore(state),
    meshTopology: () => meshTopology(state, opts.store, opts.memoryDir),
    meshMemories: (limit) => meshMemories(state, opts.store, opts.memoryDir, limit),
    invalidateMeshTopology: () => {
      state.topologyCache = undefined;
      state.meshResultCache = undefined;
    },
    pruneBackups: (target, keep) => pruneBackups(target, keep),
  });

  return {
    async dispatch(req, res, url) {
      const handler = STUDIO_ROUTES.get(`${req.method} ${url.pathname}`);
      if (!handler) return false;
      await handler(req, res, createContext(req, res, url));
      return true;
    },
    invalidateProjections() {
      state.projectionVersion += 1;
    },
    close() {
      try {
        state.globalStoreCache?.store.db?.close();
      } catch {}
    },
  };
}
