import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../store.ts";
import { list } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import { generateL0Abstract } from "../store/sidecars.ts";

export interface RouteEntryNode {
  id: string;
  title: string;
  l0: string;
  type: string;
  project: string;
  tags: string[];
  symbols: string[];
  paths: string[];
}

export type RouteCategory = "project" | "tag" | "symbol" | "path" | "type";

export interface IndexRoute {
  key: string;
  category: RouteCategory;
  entry_ids: string[];
}

export interface ResidentRouteMap {
  version: number;
  generated_at: string;
  total_entries: number;
  routes: Record<string, IndexRoute>;
  entries: Record<string, RouteEntryNode>;
}

export interface RouteMatch {
  key: string;
  category: RouteCategory;
  score: number;
  matched_token: string;
  entry_ids: string[];
}

export interface RouteLookupResult {
  matched_routes: RouteMatch[];
  prioritized_entry_ids: string[];
  duration_ms: number;
}

// In-memory cache keyed by store directory
const residentRouteMapCache = new Map<string, ResidentRouteMap>();

/**
 * Builds an in-memory resident route-map from store entries.
 * Maps project, tag, symbol, path, and type routes to memory IDs and L0 summaries.
 */
export function buildResidentRouteMap(
  store: Store,
  entries?: MemoryEntry[],
): ResidentRouteMap {
  const allEntries = entries ?? list(store);
  const routes: Record<string, IndexRoute> = {};
  const entryNodes: Record<string, RouteEntryNode> = {};

  function addRouteEntry(category: RouteCategory, rawKey: string, entryId: string) {
    if (!rawKey || !rawKey.trim()) return;
    const key = `${category}:${rawKey.trim().toLowerCase()}`;
    if (!routes[key]) {
      routes[key] = {
        key,
        category,
        entry_ids: [],
      };
    }
    if (!routes[key].entry_ids.includes(entryId)) {
      routes[key].entry_ids.push(entryId);
    }
  }

  for (const entry of allEntries) {
    if (entry.status === "archived" || entry.status === "superseded" || entry.status === "rejected") {
      continue;
    }

    const symbols: string[] = [];
    const paths: string[] = [];

    // Extract symbols and paths from anchors
    if (entry.anchors) {
      for (const anc of entry.anchors) {
        if (anc.symbol_name) symbols.push(anc.symbol_name);
        if (anc.file_path) paths.push(anc.file_path);
      }
    }

    // Extract symbols and paths from graph metadata
    if (entry.graph) {
      if (entry.graph.symbol_names) {
        for (const sym of entry.graph.symbol_names) {
          if (!symbols.includes(sym)) symbols.push(sym);
        }
      }
      if (entry.graph.affected_paths) {
        for (const p of entry.graph.affected_paths) {
          if (!paths.includes(p)) paths.push(p);
        }
      }
    }

    const l0 = generateL0Abstract(entry);
    const tags = entry.tags ?? [];
    const project = entry.project || "default";
    const type = entry.type || "general";

    entryNodes[entry.id] = {
      id: entry.id,
      title: entry.title,
      l0,
      type,
      project,
      tags,
      symbols,
      paths,
    };

    // Route indexing
    addRouteEntry("project", project, entry.id);
    addRouteEntry("type", type, entry.id);
    for (const tag of tags) {
      addRouteEntry("tag", tag, entry.id);
    }
    for (const sym of symbols) {
      addRouteEntry("symbol", sym, entry.id);
    }
    for (const p of paths) {
      addRouteEntry("path", p, entry.id);
      // Index filename basename as path route
      const baseName = p.split("/").pop();
      if (baseName && baseName !== p) {
        addRouteEntry("path", baseName, entry.id);
      }
    }
  }

  const routeMap: ResidentRouteMap = {
    version: 1,
    generated_at: new Date().toISOString(),
    total_entries: Object.keys(entryNodes).length,
    routes,
    entries: entryNodes,
  };

  const cacheKey = store.memoryDir ?? store.dir;
  if (cacheKey) {
    residentRouteMapCache.set(cacheKey, routeMap);
  }

  return routeMap;
}

/**
 * Performs sub-millisecond route matching against resident index.
 */
export function matchResidentRoutes(
  routeMap: ResidentRouteMap,
  query: string,
  context?: {
    project?: string;
    active_file?: string;
    symbol?: string;
    min_score?: number;
  },
): RouteLookupResult {
  const start = performance.now();
  const matchedRoutes: RouteMatch[] = [];
  const minScore = context?.min_score ?? 0.5;

  // Direct context route lookups
  if (context?.project) {
    const key = `project:${context.project.trim().toLowerCase()}`;
    const route = routeMap.routes[key];
    if (route) {
      matchedRoutes.push({
        key: route.key,
        category: route.category,
        score: 2.0,
        matched_token: context.project,
        entry_ids: route.entry_ids,
      });
    }
  }

  if (context?.symbol) {
    const key = `symbol:${context.symbol.trim().toLowerCase()}`;
    const route = routeMap.routes[key];
    if (route) {
      matchedRoutes.push({
        key: route.key,
        category: route.category,
        score: 3.0,
        matched_token: context.symbol,
        entry_ids: route.entry_ids,
      });
    }
  }

  if (context?.active_file) {
    const fileNorm = context.active_file.toLowerCase();
    const baseName = context.active_file.split("/").pop()?.toLowerCase();

    for (const [key, route] of Object.entries(routeMap.routes)) {
      if (route.category !== "path") continue;
      const targetPath = key.replace(/^path:/, "");
      if (fileNorm.includes(targetPath) || (baseName && targetPath.includes(baseName))) {
        matchedRoutes.push({
          key: route.key,
          category: route.category,
          score: 2.5,
          matched_token: targetPath,
          entry_ids: route.entry_ids,
        });
      }
    }
  }

  // Query token scanning against routes
  if (query && query.trim()) {
    const tokens = query
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3);

    const tokenSet = new Set(tokens);

    for (const [key, route] of Object.entries(routeMap.routes)) {
      const rawRouteName = key.split(":")[1];
      if (!rawRouteName) continue;

      for (const token of tokenSet) {
        if (rawRouteName === token) {
          const score = route.category === "symbol" ? 2.5 : route.category === "tag" ? 1.5 : 1.0;
          matchedRoutes.push({
            key: route.key,
            category: route.category,
            score,
            matched_token: token,
            entry_ids: route.entry_ids,
          });
          break;
        } else if (rawRouteName.includes(token) || token.includes(rawRouteName)) {
          matchedRoutes.push({
            key: route.key,
            category: route.category,
            score: 0.8,
            matched_token: token,
            entry_ids: route.entry_ids,
          });
          break;
        }
      }
    }
  }

  // Filter by minScore and deduplicate routes by key
  const uniqueRouteMap = new Map<string, RouteMatch>();
  for (const match of matchedRoutes) {
    if (match.score < minScore) continue;
    const existing = uniqueRouteMap.get(match.key);
    if (!existing || match.score > existing.score) {
      uniqueRouteMap.set(match.key, match);
    }
  }

  const finalMatches = Array.from(uniqueRouteMap.values()).sort((a, b) => b.score - a.score);

  // Score candidate memory entries by accumulating route match scores
  const entryScores = new Map<string, number>();
  for (const match of finalMatches) {
    for (const id of match.entry_ids) {
      const current = entryScores.get(id) ?? 0;
      entryScores.set(id, current + match.score);
    }
  }

  const prioritizedEntryIds = Array.from(entryScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map((e) => e[0]);

  const duration_ms = Number((performance.now() - start).toFixed(2));

  return {
    matched_routes: finalMatches,
    prioritized_entry_ids: prioritizedEntryIds,
    duration_ms,
  };
}

/**
 * Saves resident route-map as INDEX.json on disk.
 */
export function saveResidentIndexToDisk(dir: string, routeMap: ResidentRouteMap): void {
  const filePath = join(dir, "INDEX.json");
  writeFileSync(filePath, JSON.stringify(routeMap, null, 2), "utf-8");
}

/**
 * Loads resident route-map from INDEX.json if present.
 */
export function loadResidentIndexFromDisk(dir: string): ResidentRouteMap | null {
  const filePath = join(dir, "INDEX.json");
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ResidentRouteMap;
  } catch {
    return null;
  }
}

/**
 * Gets or builds the resident route-map for a store with cache.
 */
export function getOrBuildResidentRouteMap(
  store: Store,
  options: { force?: boolean } = {},
): ResidentRouteMap {
  const cacheKey = store.memoryDir ?? store.dir;
  if (!options.force && cacheKey && residentRouteMapCache.has(cacheKey)) {
    return residentRouteMapCache.get(cacheKey)!;
  }

  // Try loading from disk if available
  if (!options.force && cacheKey) {
    const diskMap = loadResidentIndexFromDisk(cacheKey);
    if (diskMap) {
      residentRouteMapCache.set(cacheKey, diskMap);
      return diskMap;
    }
  }

  const freshMap = buildResidentRouteMap(store);
  if (cacheKey) {
    try {
      saveResidentIndexToDisk(cacheKey, freshMap);
    } catch {}
  }
  return freshMap;
}

/**
 * Clears cached resident route-map (e.g. after store writes).
 */
export function invalidateResidentRouteMap(store?: Store): void {
  if (store) {
    const cacheKey = store.memoryDir ?? store.dir;
    if (cacheKey) residentRouteMapCache.delete(cacheKey);
  } else {
    residentRouteMapCache.clear();
  }
}
