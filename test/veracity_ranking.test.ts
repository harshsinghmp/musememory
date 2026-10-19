import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openStore,
  closeStore,
  propose,
  type Store,
  resolveVeracityClass,
  getVeracityWeight,
  VERACITY_RANK_WEIGHTS,
} from "../src/store.ts";
import {
  computeFactors,
  deriveWhyRetrieved,
  conditionalRerank,
  queryContext,
} from "../src/retrieval.ts";
import { RetrievalEngine } from "../src/retrieval/engine.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("T-089: Veracity Rank Weights (User 1.0, Agent 0.7, External 0.5, System 0.3)", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-veracity-test-"));
    store = openStore(tmpDir);
  });

  afterEach(async () => {
    await closeStore(store);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Provenance Resolution & Canonical Weights", () => {
    it("resolves canonical veracity weights according to hierarchy", () => {
      expect(VERACITY_RANK_WEIGHTS.user).toBe(1.0);
      expect(VERACITY_RANK_WEIGHTS.agent).toBe(0.7);
      expect(VERACITY_RANK_WEIGHTS.external).toBe(0.5);
      expect(VERACITY_RANK_WEIGHTS.system).toBe(0.3);
    });

    it("resolves 'user' tier from source, trust, or verification indicators", () => {
      expect(resolveVeracityClass({ source: "user" })).toBe("user");
      expect(resolveVeracityClass({ source: "principal" })).toBe("user");
      expect(resolveVeracityClass({ trust: "trusted" })).toBe("user");
      expect(resolveVeracityClass({ trust: "T1" })).toBe("user");
      expect(resolveVeracityClass({ verification: { level: "user-confirmed" } })).toBe("user");
      expect(resolveVeracityClass({ verification: { level: "authoritative" } })).toBe("user");
      expect(getVeracityWeight({ source: "user" })).toBe(1.0);
    });

    it("resolves 'agent' tier from agent indicators", () => {
      expect(resolveVeracityClass({ source: "agent" })).toBe("agent");
      expect(resolveVeracityClass({ source: "assistant" })).toBe("agent");
      expect(resolveVeracityClass({ source: "subagent" })).toBe("agent");
      expect(resolveVeracityClass({ trust: "candidate" })).toBe("agent");
      expect(resolveVeracityClass({ trust: "T2" })).toBe("agent");
      expect(resolveVeracityClass({})).toBe("agent");
      expect(getVeracityWeight({ source: "agent" })).toBe(0.7);
    });

    it("resolves 'external' tier from web/crawler/external indicators", () => {
      expect(resolveVeracityClass({ source: "external" })).toBe("external");
      expect(resolveVeracityClass({ source: "web" })).toBe("external");
      expect(resolveVeracityClass({ source: "crawler" })).toBe("external");
      expect(resolveVeracityClass({ source: "import" })).toBe("external");
      expect(resolveVeracityClass({ trust: "untrusted" })).toBe("external");
      expect(resolveVeracityClass({ trust: "T3" })).toBe("external");
      expect(getVeracityWeight({ source: "external" })).toBe(0.5);
    });

    it("resolves 'system' tier from system/background daemon indicators", () => {
      expect(resolveVeracityClass({ source: "system" })).toBe("system");
      expect(resolveVeracityClass({ source: "daemon" })).toBe("system");
      expect(resolveVeracityClass({ source: "background" })).toBe("system");
      expect(resolveVeracityClass({ source: "sweep" })).toBe("system");
      expect(resolveVeracityClass({ trust: "T4" })).toBe("system");
      expect(getVeracityWeight({ source: "system" })).toBe(0.3);
    });
  });

  describe("Ranking Factor Calculation & WhyRetrieved Tokens", () => {
    it("computes veracity bonus/discount accurately in computeFactors", () => {
      const baseMemory: MemoryEntry = {
        id: "mem-test-1",
        title: "Database connection pooling configuration",
        content: "Always pool connections with max 20 connections in Postgres.",
        status: "active",
        type: "decision",
        project: "test",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const ctx = { now: Date.now() };

      const userFactors = computeFactors(
        { ...baseMemory, source: "user" },
        ["database", "connection"],
        ctx,
      );
      expect(userFactors.veracityClass).toBe("user");
      expect(userFactors.veracityWeight).toBe(1.0);
      expect(userFactors.veracityBonus).toBe(0.15);

      const agentFactors = computeFactors(
        { ...baseMemory, source: "agent" },
        ["database", "connection"],
        ctx,
      );
      expect(agentFactors.veracityClass).toBe("agent");
      expect(agentFactors.veracityWeight).toBe(0.7);
      expect(agentFactors.veracityBonus).toBe(0.0);

      const externalFactors = computeFactors(
        { ...baseMemory, source: "external" },
        ["database", "connection"],
        ctx,
      );
      expect(externalFactors.veracityClass).toBe("external");
      expect(externalFactors.veracityWeight).toBe(0.5);
      expect(externalFactors.veracityBonus).toBe(-0.1);

      const systemFactors = computeFactors(
        { ...baseMemory, source: "system" },
        ["database", "connection"],
        ctx,
      );
      expect(systemFactors.veracityClass).toBe("system");
      expect(systemFactors.veracityWeight).toBe(0.3);
      expect(systemFactors.veracityBonus).toBe(-0.2);
    });

    it("emits veracity reasons in deriveWhyRetrieved", () => {
      const entry: MemoryEntry = {
        id: "mem-test-2",
        title: "API rate limiting",
        content: "Enforce 100 requests per minute per IP.",
        status: "active",
        type: "decision",
        project: "test",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const ctx = { now: Date.now() };

      const userFactors = computeFactors({ ...entry, source: "user" }, ["api"], ctx);
      const userReasons = deriveWhyRetrieved(userFactors, { ...entry, source: "user" });
      expect(userReasons).toContain("user_veracity_boost");

      const externalFactors = computeFactors({ ...entry, source: "external" }, ["api"], ctx);
      const externalReasons = deriveWhyRetrieved(externalFactors, { ...entry, source: "external" });
      expect(externalReasons).toContain("discounted_veracity");

      const systemFactors = computeFactors({ ...entry, source: "system" }, ["api"], ctx);
      const systemReasons = deriveWhyRetrieved(systemFactors, { ...entry, source: "system" });
      expect(systemReasons).toContain("discounted_veracity");
    });
  });

  describe("Tie-Breaking with conditionalRerank", () => {
    it("breaks score ties in favor of user provenance over agent or system provenance", () => {
      const now = new Date().toISOString();
      const userEntry: MemoryEntry = {
        id: "mem-user",
        title: "Auth strategy",
        content: "Use JWT tokens in auth header",
        status: "active",
        type: "decision",
        project: "test",
        source: "user",
        created_at: now,
        updated_at: now,
      };
      const agentEntry: MemoryEntry = {
        id: "mem-agent",
        title: "Auth strategy",
        content: "Use session cookies for auth",
        status: "active",
        type: "decision",
        project: "test",
        source: "agent",
        created_at: now,
        updated_at: now,
      };
      const systemEntry: MemoryEntry = {
        id: "mem-system",
        title: "Auth strategy",
        content: "Use basic auth for endpoints",
        status: "active",
        type: "decision",
        project: "test",
        source: "system",
        created_at: now,
        updated_at: now,
      };

      // Tightly clustered / tied scores (0.80)
      const candidates = [
        { entry: systemEntry, score: 0.80 },
        { entry: agentEntry, score: 0.80 },
        { entry: userEntry, score: 0.80 },
      ];

      const reranked = conditionalRerank(candidates);
      expect(reranked[0].entry.id).toBe("mem-user");
      expect(reranked[1].entry.id).toBe("mem-agent");
      expect(reranked[2].entry.id).toBe("mem-system");
    });
  });

  describe("Filtering by minVeracity in queryContext & RetrievalEngine", () => {
    it("withholds lower-veracity entries when minVeracity threshold is set", () => {
      propose(store, {
        title: "User Guideline",
        content: "Principal specified Postgres only for relational storage",
        source: "user",
        project: "alpha",
      });
      propose(store, {
        title: "Agent Inferred Guideline",
        content: "Agent inferred Redis might be used for caching Postgres",
        source: "agent",
        project: "alpha",
      });
      propose(store, {
        title: "External Web Snippet",
        content: "External blog suggests SQLite for all microservices",
        source: "external",
        project: "alpha",
      });
      propose(store, {
        title: "System Routine Rule",
        content: "Background daemon runs VACUUM on Postgres nightly",
        source: "system",
        project: "alpha",
      });

      // Query with minVeracity: 'agent' (0.7) -> allows user (1.0) and agent (0.7), withholds external (0.5) and system (0.3)
      const agentResult = queryContext(store, "Postgres storage", {
        minVeracity: "agent",
      });
      const returnedAgentIds = agentResult.results.map((r) => r.entry.title);
      expect(returnedAgentIds).toContain("User Guideline");
      expect(returnedAgentIds).toContain("Agent Inferred Guideline");
      expect(returnedAgentIds).not.toContain("External Web Snippet");
      expect(returnedAgentIds).not.toContain("System Routine Rule");

      expect(agentResult.withheld).toBeDefined();
      const reasons = agentResult.withheld!.map((w) => w.reason);
      expect(reasons).toContain("low_veracity_source");

      // Query with minVeracity: 'user' (1.0) -> allows ONLY user
      const userOnlyResult = queryContext(store, "Postgres storage", {
        minVeracity: "user",
      });
      expect(userOnlyResult.results.length).toBe(1);
      expect(userOnlyResult.results[0].entry.title).toBe("User Guideline");

      // Query via RetrievalEngine.search
      const engineResult = RetrievalEngine.search(store, tmpDir, "Postgres storage", {
        minVeracity: 0.7,
      });
      const engineTitles = engineResult.results.map((r) => r.entry.title);
      expect(engineTitles).toContain("User Guideline");
      expect(engineTitles).toContain("Agent Inferred Guideline");
      expect(engineTitles).not.toContain("External Web Snippet");
      expect(engineResult.withheld).toBeDefined();
    });
  });
});
