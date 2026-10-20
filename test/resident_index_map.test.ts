import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, save, type Store } from "../src/store.ts";
import {
  buildResidentRouteMap,
  matchResidentRoutes,
  getOrBuildResidentRouteMap,
  saveResidentIndexToDisk,
  loadResidentIndexFromDisk,
  invalidateResidentRouteMap,
} from "../src/orchestrator/route_map.ts";
import { resolveMuseContext } from "../src/orchestrator/context.ts";

describe("T-124: Resident INDEX route-map", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-route-map-test-"));
    store = openStore(tmpDir);
    invalidateResidentRouteMap();
  });

  afterEach(() => {
    invalidateResidentRouteMap();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  function seedStore() {
    const e1 = propose(store, {
      title: "Authentication Token Handling with JWT",
      content: "JWT tokens are validated using RS256 signature verification in AuthMiddleware.",
      type: "decision",
      project: "auth-service",
      tags: ["security", "jwt", "tokens"],
      anchors: [
        {
          id: "anc-auth",
          kind: "symbol",
          file_path: "src/auth/middleware.ts",
          symbol_name: "AuthMiddleware",
        },
      ],
    });

    const e2 = propose(store, {
      title: "PostgreSQL Database Connection Pooling",
      content: "PgBouncer connection pool configured with 20 pool size and transaction mode.",
      type: "decision",
      project: "data-service",
      tags: ["database", "postgres", "pooling"],
      anchors: [
        {
          id: "anc-db",
          kind: "symbol",
          file_path: "src/db/connection.ts",
          symbol_name: "ConnectionPool",
        },
      ],
    });

    let e3 = propose(store, {
      title: "Legacy Cookie Authentication (Archived)",
      content: "Old session cookie mechanism deprecated.",
      type: "decision",
      project: "auth-service",
      tags: ["cookies", "legacy"],
    });
    e3 = { ...e3, status: "archived" };
    save(store, e3);

    return { e1, e2, e3 };
  }

  describe("buildResidentRouteMap", () => {
    it("indexes active memories into project, tag, symbol, and path routes", () => {
      const { e1, e2, e3 } = seedStore();
      const routeMap = buildResidentRouteMap(store);

      expect(routeMap.version).toBe(1);
      expect(routeMap.total_entries).toBe(2); // e3 is archived
      expect(routeMap.entries[e1.id]).toBeDefined();
      expect(routeMap.entries[e1.id].l0).toBeDefined();
      expect(routeMap.entries[e3.id]).toBeUndefined();

      // Check project routes
      expect(routeMap.routes["project:auth-service"]).toBeDefined();
      expect(routeMap.routes["project:auth-service"].entry_ids).toContain(e1.id);

      // Check tag routes
      expect(routeMap.routes["tag:security"]).toBeDefined();
      expect(routeMap.routes["tag:security"].entry_ids).toContain(e1.id);
      expect(routeMap.routes["tag:postgres"]).toBeDefined();
      expect(routeMap.routes["tag:postgres"].entry_ids).toContain(e2.id);

      // Check symbol routes
      expect(routeMap.routes["symbol:authmiddleware"]).toBeDefined();
      expect(routeMap.routes["symbol:authmiddleware"].entry_ids).toContain(e1.id);

      // Check path routes
      expect(routeMap.routes["path:src/auth/middleware.ts"]).toBeDefined();
      expect(routeMap.routes["path:middleware.ts"]).toBeDefined();
    });
  });

  describe("matchResidentRoutes", () => {
    it("matches routes based on context symbol and active file", () => {
      const { e1, e2 } = seedStore();
      const routeMap = buildResidentRouteMap(store);

      const result = matchResidentRoutes(routeMap, "validate token", {
        symbol: "AuthMiddleware",
        active_file: "src/auth/middleware.ts",
        project: "auth-service",
      });

      expect(result.matched_routes.length).toBeGreaterThan(0);
      expect(result.prioritized_entry_ids).toContain(e1.id);
      expect(result.prioritized_entry_ids[0]).toBe(e1.id);
      expect(result.duration_ms).toBeLessThan(50); // sub-millisecond fast
    });

    it("matches routes from free-text query tokens", () => {
      const { e2 } = seedStore();
      const routeMap = buildResidentRouteMap(store);

      const result = matchResidentRoutes(routeMap, "how does postgres pooling work?");
      expect(result.matched_routes.some((r) => r.key === "tag:postgres" || r.key === "tag:pooling")).toBe(true);
      expect(result.prioritized_entry_ids).toContain(e2.id);
    });
  });

  describe("disk persistence", () => {
    it("saves and loads route map from INDEX.json", () => {
      seedStore();
      const routeMap = buildResidentRouteMap(store);
      saveResidentIndexToDisk(tmpDir, routeMap);

      expect(existsSync(join(tmpDir, "INDEX.json"))).toBe(true);

      const loaded = loadResidentIndexFromDisk(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe(routeMap.version);
      expect(loaded!.total_entries).toBe(routeMap.total_entries);
      expect(loaded!.routes["project:auth-service"]).toBeDefined();
    });
  });

  describe("caching and invalidation", () => {
    it("returns cached route-map and invalidates cleanly", () => {
      seedStore();
      const map1 = getOrBuildResidentRouteMap(store);
      const map2 = getOrBuildResidentRouteMap(store);
      expect(map1).toBe(map2); // identical reference from cache

      invalidateResidentRouteMap(store);
      const map3 = getOrBuildResidentRouteMap(store, { force: true });
      expect(map3).not.toBe(map1);
    });
  });

  describe("integration with resolveMuseContext", () => {
    it("returns matched_routes and route_prioritized_ids in FusedContextResult", async () => {
      const { e1 } = seedStore();
      const result = await resolveMuseContext(store, tmpDir, {
        query: "JWT token authentication",
        project: "auth-service",
        symbol: "AuthMiddleware",
      });

      expect(result.relevant_memories.length).toBeGreaterThan(0);
      expect(result.matched_routes).toBeDefined();
      expect(result.matched_routes!.length).toBeGreaterThan(0);
      expect(result.route_prioritized_ids).toBeDefined();
      expect(result.route_prioritized_ids!).toContain(e1.id);
    });
  });
});
