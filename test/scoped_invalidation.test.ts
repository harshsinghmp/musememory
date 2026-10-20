import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openStore,
  propose,
  detectConflict,
  extractFactTriples,
  evaluateScopedAlignment,
  evaluateScopedInvalidation,
  type SemanticFactTriple,
  type Store,
} from "../src/store.ts";

describe("T-087: Scoped Invalidation requiring (entity, relation, target) alignment", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-scoped-inval-test-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    if (store.db) {
      store.db.close();
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Triple extraction", () => {
    it("extracts explicit triples provided on memory draft", () => {
      const triples = extractFactTriples({
        title: "Database configuration",
        content: "Custom database setup",
        triples: [
          {
            entity: "primary_db",
            relation: "engine",
            target: "PostgreSQL",
            scope: "production",
          },
        ],
      });

      expect(triples.length).toBe(1);
      expect(triples[0].entity).toBe("primary db");
      expect(triples[0].relation).toBe("database"); // canonicalized
      expect(triples[0].target).toBe("postgresql");
      expect(triples[0].scope).toBe("production");
    });

    it("heuristically extracts triples from natural text with scope detection", () => {
      const prodDb = extractFactTriples({
        title: "Production database setup",
        content: "In production, the primary database uses PostgreSQL for transactional storage.",
      });
      expect(prodDb.length).toBeGreaterThan(0);
      expect(prodDb[0].relation).toBe("database");
      expect(prodDb[0].target).toBe("postgresql");
      expect(prodDb[0].scope).toBe("production");

      const devPort = extractFactTriples({
        title: "Dev server configuration",
        content: "For development, the API gateway binds to port 3000.",
      });
      expect(devPort.length).toBeGreaterThan(0);
      expect(devPort[0].relation).toBe("port");
      expect(devPort[0].target).toBe("3000");
      expect(devPort[0].scope).toBe("development");
    });

    it("respects scope tags on memory entries", () => {
      const tagged = extractFactTriples({
        title: "Warehouse storage",
        content: "The primary database uses MySQL.",
        tags: ["scope:analytics"],
      });
      expect(tagged.length).toBeGreaterThan(0);
      expect(tagged[0].scope).toBe("analytics");
      expect(tagged[0].target).toBe("mysql");
    });
  });

  describe("Semantic triple alignment (evaluateScopedAlignment)", () => {
    it("flags contradiction when entity, relation, and scope match with opposing targets", () => {
      const tripleA: SemanticFactTriple = {
        entity: "database",
        relation: "database",
        target: "postgresql",
        scope: "production",
      };
      const tripleB: SemanticFactTriple = {
        entity: "database",
        relation: "database",
        target: "mysql",
        scope: "production",
      };

      const result = evaluateScopedAlignment(tripleA, tripleB);
      expect(result.aligned).toBe(true);
      expect(result.conflicting).toBe(true);
      expect(result.reason).toContain("Contradictory target values");
    });

    it("refuses contradiction when scopes differ despite opposing targets (Graphiti #1728 lesson)", () => {
      const prodDb: SemanticFactTriple = {
        entity: "database",
        relation: "database",
        target: "postgresql",
        scope: "production",
      };
      const analyticsDb: SemanticFactTriple = {
        entity: "database",
        relation: "database",
        target: "mysql",
        scope: "analytics",
      };

      const result = evaluateScopedAlignment(prodDb, analyticsDb);
      // Different scopes -> distinct contextual truths
      expect(result.aligned).toBe(false);
      expect(result.conflicting).toBe(false);
      expect(result.reason).toContain("Distinct scopes");
    });

    it("refuses contradiction when entities differ (e.g. caching vs compression)", () => {
      const caching: SemanticFactTriple = {
        entity: "caching",
        relation: "status",
        target: "enabled",
      };
      const compression: SemanticFactTriple = {
        entity: "compression",
        relation: "status",
        target: "disabled",
      };

      const result = evaluateScopedAlignment(caching, compression);
      expect(result.aligned).toBe(false);
      expect(result.conflicting).toBe(false);
      expect(result.reason).toContain("Entity mismatch");
    });
  });

  describe("End-to-end scoped invalidation and detectConflict integration", () => {
    it("allows distinct scoped truths to coexist without false-positive conflict", () => {
      // 1. Production database setup
      propose(store, {
        title: "Production Database Persistence",
        content: "In production, the primary database uses PostgreSQL for high availability.",
        type: "architecture",
        project: "core",
        confirmed: true,
      });

      // 2. Analytics database setup (different scope: analytics)
      const analyticsDraft = {
        title: "Analytics Database Persistence",
        content: "For analytics, the warehouse database uses MySQL for analytical batch jobs.",
        type: "architecture" as const,
        project: "core",
      };

      const detection = detectConflict(store, analyticsDraft);
      expect(detection.conflicted).toBe(false);

      // Verify propose with checkConflict does not flag conflicted
      const saved = propose(store, {
        ...analyticsDraft,
        confirmed: true,
        checkConflict: true,
      });
      expect(saved.status).toBe("confirmed");
    });

    it("allows platform-scoped UI theme preferences to coexist (macOS desktop vs mobile)", () => {
      // Desktop theme
      propose(store, {
        title: "User Interface Theme Preferences",
        content: "User prefers dark mode on macOS desktop.",
        type: "preference",
        project: "app",
        confirmed: true,
      });

      // Mobile theme (different scope: mobile)
      const mobileDraft = {
        title: "User Interface Theme Preferences",
        content: "User prefers light mode on mobile iOS.",
        type: "preference" as const,
        project: "app",
      };

      const detection = detectConflict(store, mobileDraft);
      expect(detection.conflicted).toBe(false);
    });

    it("flags genuine contradiction when same entity, relation, and scope conflict", () => {
      // Production database setup
      const existing = propose(store, {
        title: "Production Database Architecture",
        content: "In production, the primary database uses PostgreSQL.",
        type: "architecture",
        project: "core",
        confirmed: true,
      });

      // Same scope (production) asserting MySQL
      const conflictingDraft = {
        title: "Production Database Architecture",
        content: "In production, the primary database uses MySQL.",
        type: "architecture" as const,
        project: "core",
      };

      const detection = detectConflict(store, conflictingDraft);
      expect(detection.conflicted).toBe(true);
      expect(detection.conflictingEntry?.id).toBe(existing.id);
      expect(detection.reason).toContain("postgresql");
      expect(detection.reason).toContain("mysql");
    });

    it("detects conflict when port binding contradicts in the same environment", () => {
      const devA = propose(store, {
        title: "API Gateway Port",
        content: "For development, the gateway binds to port 3000.",
        type: "operation",
        project: "gateway",
        confirmed: true,
      });

      // Same development environment proposing port 8080
      const devB = {
        title: "API Gateway Port",
        content: "For development, the gateway binds to port 8080.",
        type: "operation" as const,
        project: "gateway",
      };

      const detection = detectConflict(store, devB);
      expect(detection.conflicted).toBe(true);
      expect(detection.conflictingEntry?.id).toBe(devA.id);
    });

    it("allows different ports across different environments (dev vs prod)", () => {
      propose(store, {
        title: "API Gateway Port Dev",
        content: "For development, the gateway binds to port 3000.",
        type: "operation",
        project: "gateway",
        confirmed: true,
      });

      const prodPort = {
        title: "API Gateway Port Prod",
        content: "In production, the gateway binds to port 8080.",
        type: "operation" as const,
        project: "gateway",
      };

      const detection = detectConflict(store, prodPort);
      expect(detection.conflicted).toBe(false);
    });
  });
});
