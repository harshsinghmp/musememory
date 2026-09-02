import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, save, get, list } from "../src/store.ts";
import {
  evaluatePromotion,
  promoteMemory,
  generalizeContent,
  calculateSpecificityScore,
  isContentGeneralizable,
  evaluateArchival,
  archiveMemory,
  rehydrateMemory,
  autoArchiveSweep,
  getLifecycleStats,
} from "../src/promotion/index.ts";
import { searchMemories } from "../src/retrieval.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("R7 & R8: Scoped Promotion, Generalization & Archival Lifecycle", () => {
  let tmpDir: string;
  let globalTmpDir: string;
  let store: ReturnType<typeof openStore>;
  const origGlobalDir = process.env.MUSEMEMORY_GLOBAL_DIR;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-promo-test-"));
    globalTmpDir = mkdtempSync(join(tmpdir(), "muse-global-test-"));
    process.env.MUSEMEMORY_GLOBAL_DIR = globalTmpDir;
    store = openStore(join(tmpDir, ".memory"));
  });

  afterEach(() => {
    if (origGlobalDir !== undefined) {
      process.env.MUSEMEMORY_GLOBAL_DIR = origGlobalDir;
    } else {
      delete process.env.MUSEMEMORY_GLOBAL_DIR;
    }
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(globalTmpDir, { recursive: true, force: true });
  });

  describe("5x Success Rule & Scoped Promotion Policy", () => {
    it("blocks automatic global promotion when successful uses < 5", () => {
      const entry: MemoryEntry = {
        id: "m_100_cache_invalidation",
        title: "Cache Invalidation Pattern",
        content: "Always invalidate checkout cache before emitting events.",
        project: "ecommerce",
        status: "confirmed",
        scope: "project",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["cache", "checkout"],
        verification: { level: "independently-verified" },
        utility: {
          retrieval_count: 5,
          application_count: 4,
          successful_applications: 4,
          failed_applications: 0,
          regressions: 0,
          contradictions: 0,
          reuse_success_rate: 1.0,
        },
      };

      const evaluation = evaluatePromotion(entry);
      expect(evaluation.eligible).toBe(false);
      expect(evaluation.reasons.some((r) => r.includes("Insufficient successful applications: 4/5"))).toBe(true);
    });

    it("approves global promotion when >= 5 successful uses, 100% success rate, 0 regressions, and 0 conflicts", () => {
      const entry: MemoryEntry = {
        id: "m_101_cache_invalidation",
        title: "Cache Invalidation Pattern",
        content: "Always invalidate checkout cache before emitting events.",
        project: "ecommerce",
        status: "confirmed",
        scope: "project",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["cache", "checkout"],
        verification: { level: "independently-verified" },
        utility: {
          retrieval_count: 10,
          application_count: 7,
          successful_applications: 7,
          failed_applications: 0,
          regressions: 0,
          contradictions: 0,
          reuse_success_rate: 1.0,
        },
      };

      const evaluation = evaluatePromotion(entry);
      expect(evaluation.eligible).toBe(true);
      expect(evaluation.target_scope).toBe("global");
      expect(evaluation.reasons.some((r) => r.includes("Met all policy gates"))).toBe(true);
    });

    it("blocks promotion if entry has regressions or active conflicts", () => {
      const entryWithRegression: MemoryEntry = {
        id: "m_102_regression",
        title: "Flaky cache pattern",
        content: "Bypass cache validation.",
        project: "ecommerce",
        status: "confirmed",
        scope: "project",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["cache"],
        verification: { level: "observed" },
        utility: {
          retrieval_count: 8,
          application_count: 6,
          successful_applications: 5,
          failed_applications: 1,
          regressions: 1,
          contradictions: 0,
          reuse_success_rate: 0.83,
        },
      };

      const evalRegression = evaluatePromotion(entryWithRegression);
      expect(evalRegression.eligible).toBe(false);
      expect(evalRegression.reasons.some((r) => r.includes("regression"))).toBe(true);

      const entryWithConflict: MemoryEntry = {
        id: "m_103_conflict",
        title: "Conflicted rule",
        content: "Keep active tokens in memory.",
        project: "ecommerce",
        status: "conflicted",
        scope: "project",
        conflict_ids: ["m_999_other"],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["auth"],
        verification: { level: "user-confirmed" },
        utility: {
          retrieval_count: 10,
          application_count: 6,
          successful_applications: 6,
          failed_applications: 0,
          regressions: 0,
          contradictions: 1,
          reuse_success_rate: 1.0,
        },
      };

      const evalConflict = evaluatePromotion(entryWithConflict);
      expect(evalConflict.eligible).toBe(false);
      expect(evalConflict.reasons.some((r) => r.includes("conflict"))).toBe(true);
    });

    it("allows manual global promotion to bypass 5x requirement while retaining audit trail", () => {
      const entry: MemoryEntry = {
        id: "m_104_manual",
        title: "Axiomatic constraint",
        content: "Always check process exit code before declaring success.",
        project: "core",
        status: "confirmed",
        scope: "project",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["process"],
        verification: { level: "authoritative" },
        utility: {
          retrieval_count: 1,
          application_count: 1,
          successful_applications: 1,
          failed_applications: 0,
          regressions: 0,
          contradictions: 0,
          reuse_success_rate: 1.0,
        },
      };

      const evaluation = evaluatePromotion(entry, { forceManual: true });
      expect(evaluation.eligible).toBe(true);
      expect(evaluation.reasons.some((r) => r.includes("Manual promotion override"))).toBe(true);
    });
  });

  describe("Generalization Engine", () => {
    it("scrubs specific repository file paths, line numbers, and commit hashes into architectural concepts", () => {
      const specificText =
        "Use src/payment/legacy-cache.ts at line 42 for checkout fixes, verified in tests/payment.test.ts under commit 3409b5ad.";
      const result = generalizeContent(specificText, { projectName: "payment" });

      expect(result.changesMade.length).toBeGreaterThan(0);
      expect(result.generalized).not.toContain("src/payment/legacy-cache.ts");
      expect(result.generalized).not.toContain("line 42");
      expect(result.generalized).not.toContain("3409b5ad");
      expect(result.generalized).toContain("the caching subsystem");
      expect(result.generalized).toContain("the test suite");
      expect(result.generalized).toContain("[commit]");
    });

    it("computes specificity score appropriately", () => {
      const highlySpecific = "Edit /home/harsh/project/src/cache.ts at line 55 for commit abc12345.";
      const scoreHigh = calculateSpecificityScore(highlySpecific);
      expect(scoreHigh).toBeGreaterThanOrEqual(0.6);

      const generic = "Always validate network requests before dispatching actions to the event store.";
      const scoreLow = calculateSpecificityScore(generic);
      expect(scoreLow).toBeLessThan(0.2);
    });

    it("identifies ungeneralizable fragments", () => {
      expect(isContentGeneralizable("temp fix for bug")).toBe(false);
      expect(isContentGeneralizable("quick hack to bypass login")).toBe(false);
      expect(isContentGeneralizable("Always verify database migration rollbacks in isolation before production deployment.")).toBe(true);
    });
  });

  describe("End-to-End Promotion Execution", () => {
    it("promotes local candidate to project scope", () => {
      const candidate: MemoryEntry = {
        id: "m_201_local_candidate",
        title: "Verified build procedure",
        content: "Run bun run typecheck before building dist bundle.",
        project: "musememory",
        status: "candidate",
        scope: "local",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["build"],
        verification: { level: "independently-verified" },
      };
      save(store, candidate);

      const promoResult = promoteMemory(store, candidate.id);
      expect(promoResult.promoted).toBe(true);
      expect(promoResult.from_scope).toBe("local");
      expect(promoResult.to_scope).toBe("project");

      const updated = get(store, candidate.id);
      expect(updated?.scope).toBe("project");
      expect(updated?.status).toBe("confirmed");
      expect(updated?.promotion?.policy).toBe("validation");

      // Verify audit trail
      const auditLog = readFileSync(join(store.memoryDir!, "audit.jsonl"), "utf8");
      expect(auditLog).toContain('"operation":"promote"');
    });

    it("promotes project memory to global store with generalization and links", () => {
      const projectMemory: MemoryEntry = {
        id: "m_202_global_ready",
        title: "Checkout Cache Mutation Boundary",
        content: "In src/payment/legacy-cache.ts, always flush cache before committing db transaction in ecommerce.",
        project: "ecommerce",
        status: "confirmed",
        scope: "project",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["cache", "checkout"],
        verification: { level: "independently-verified" },
        utility: {
          retrieval_count: 10,
          application_count: 5,
          successful_applications: 5,
          failed_applications: 0,
          regressions: 0,
          contradictions: 0,
          reuse_success_rate: 1.0,
        },
      };
      save(store, projectMemory);

      const promoResult = promoteMemory(store, projectMemory.id);
      expect(promoResult.promoted).toBe(true);
      expect(promoResult.from_scope).toBe("project");
      expect(promoResult.to_scope).toBe("global");
      expect(promoResult.generalized_content).toBeDefined();
      expect(promoResult.generalized_content).not.toContain("src/payment/legacy-cache.ts");

      // Check global store
      const globalStore = openStore(globalTmpDir);
      const globalEntry = get(globalStore, projectMemory.id);
      expect(globalEntry).toBeDefined();
      expect(globalEntry?.project).toBe("global");
      expect(globalEntry?.scope).toBe("global");
      expect(globalEntry?.content).toBe(promoResult.generalized_content!);
      expect(globalEntry?.promotion?.policy).toBe("repeated_success");

      // Verify audit logs in both stores
      const localAudit = readFileSync(join(store.memoryDir!, "audit.jsonl"), "utf8");
      const globalAudit = readFileSync(join(globalTmpDir, "audit.jsonl"), "utf8");
      expect(localAudit).toContain('"operation":"promote"');
      expect(globalAudit).toContain('"operation":"promote"');
    });
  });

  describe("Archival Lifecycle & Dynamic Rehydration", () => {
    it("evaluates superseded entries for immediate archival", () => {
      const entry: MemoryEntry = {
        id: "m_301_superseded",
        title: "Legacy auth endpoint",
        content: "Use /v1/auth/login",
        project: "api",
        status: "superseded",
        superseded_by: "m_302_new_auth",
        created_at: new Date(Date.now() - 200 * 86400000).toISOString(),
        updated_at: new Date(Date.now() - 100 * 86400000).toISOString(),
        tags: ["auth"],
      };

      const evalResult = evaluateArchival(entry);
      expect(evalResult.recommended_status).toBe("archived");
      expect(evalResult.is_superseded).toBe(true);
    });

    it("evaluates aging unused entries through the COLD -> DORMANT -> ARCHIVED ladder", () => {
      // 1. 100 days old, 0 uses -> cold
      const staleEntry: MemoryEntry = {
        id: "m_302_cold_candidate",
        title: "Old deploy script",
        content: "Deploy with fabfile.py",
        project: "infra",
        status: "active",
        type: "operation",
        created_at: new Date(Date.now() - 200 * 86400000).toISOString(),
        updated_at: new Date(Date.now() - 190 * 86400000).toISOString(),
        tags: ["deploy"],
        utility: { retrieval_count: 0, application_count: 0, successful_applications: 0, failed_applications: 0, regressions: 0, contradictions: 0 },
      };
      const evalCold = evaluateArchival(staleEntry);
      expect(evalCold.recommended_status).toBe("cold");

      // 2. Already cold, aged another policy cycle -> dormant
      const coldEntry: MemoryEntry = {
        ...staleEntry,
        status: "cold",
        updated_at: new Date(Date.now() - 200 * 86400000).toISOString(),
      };
      const evalDormant = evaluateArchival(coldEntry);
      expect(evalDormant.recommended_status).toBe("dormant");

      // 3. Dormant for 400 days -> archived
      const dormantEntry: MemoryEntry = {
        ...staleEntry,
        status: "dormant",
        updated_at: new Date(Date.now() - 400 * 86400000).toISOString(),
      };
      const evalArchived = evaluateArchival(dormantEntry);
      expect(evalArchived.recommended_status).toBe("archived");
    });

    it("keeps timeless architectural constraints active regardless of age", () => {
      const timelessEntry: MemoryEntry = {
        id: "m_303_timeless",
        title: "Zero Secret Rule",
        content: "Never commit credentials or tokens.",
        project: "security",
        status: "active",
        type: "constraint",
        temporal_mode: "timeless",
        created_at: new Date(Date.now() - 500 * 86400000).toISOString(),
        updated_at: new Date(Date.now() - 500 * 86400000).toISOString(),
        tags: ["security"],
      };

      const evalTimeless = evaluateArchival(timelessEntry);
      expect(evalTimeless.recommended_status).toBe("active");
    });

    it("archives an entry and excludes it from default retrieval", () => {
      const entry: MemoryEntry = {
        id: "m_304_to_archive",
        title: "Old RabbitMQ connection config",
        content: "Connect to rabbitmq cluster on port 5672.",
        project: "messaging",
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["rabbitmq"],
      };
      save(store, entry);

      archiveMemory(store, entry.id, "archived", "Migrated to Apache Kafka");
      const updated = get(store, entry.id);
      expect(updated?.status).toBe("archived");
      expect(updated?.archive_reason).toBe("Migrated to Apache Kafka");
      expect(updated?.archived_at).toBeDefined();

      // Default search must exclude archived memories
      const searchRes = searchMemories(store, "RabbitMQ connection");
      expect(searchRes.results.some((r) => r.entry.id === entry.id)).toBe(false);

      // Search with includeArchived: true returns it
      const searchWithArchived = searchMemories(store, "RabbitMQ connection", { includeArchived: true });
      expect(searchWithArchived.results.some((r) => r.entry.id === entry.id)).toBe(true);
    });

    it("rehydrates an archived memory back to active upon strong relevance match", () => {
      const archivedEntry: MemoryEntry = {
        id: "m_305_archived_fix",
        title: "Database connection pool timeout fix",
        content: "Configure max pool size to 25 and idle timeout to 30000ms for connection pool timeouts.",
        project: "db",
        status: "archived",
        archive_reason: "Infrequent use",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["database", "pool"],
        verification: { level: "independently-verified" },
      };
      save(store, archivedEntry);

      // Rehydrate explicitly
      const rehydrateRes = rehydrateMemory(store, archivedEntry.id, 0.88, "Emergency pool timeout recurrence");
      expect(rehydrateRes.rehydrated).toBe(true);
      expect(rehydrateRes.previous_status).toBe("archived");
      expect(rehydrateRes.new_status).toBe("confirmed");

      const refreshed = get(store, archivedEntry.id);
      expect(refreshed?.status).toBe("confirmed");
      expect(refreshed?.archive_reason).toBeUndefined();
      expect(refreshed?.utility?.retrieval_count).toBeGreaterThanOrEqual(1);

      // Verify audit log
      const auditLog = readFileSync(join(store.memoryDir!, "audit.jsonl"), "utf8");
      expect(auditLog).toContain('"operation":"rehydrate"');
    });

    it("auto-rehydrates archived memory when autoRehydrate flag is set on search", () => {
      const dormantEntry: MemoryEntry = {
        id: "m_306_dormant_redis",
        title: "Redis cluster failover handler",
        content: "Handle Redis cluster reconnect failover with exponential backoff strategy.",
        project: "cache",
        status: "dormant",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["redis", "failover"],
      };
      save(store, dormantEntry);

      // Search with autoRehydrate: true and includeArchived
      const res = searchMemories(store, "Redis cluster reconnect failover backoff", {
        includeArchived: true,
        autoRehydrate: true,
      });

      expect(res.results.length).toBeGreaterThan(0);
      const refreshed = get(store, dormantEntry.id);
      expect(refreshed?.status).toBe("active");
    });
  });

  describe("Lifecycle Statistics & Store Sweeper", () => {
    it("reports accurate lifecycle metrics across store", () => {
      const e1: MemoryEntry = {
        id: "m_401_active",
        title: "Active 1",
        content: "Active content",
        project: "p1",
        status: "active",
        scope: "project",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["t1"],
      };
      const e2: MemoryEntry = {
        id: "m_402_cold",
        title: "Cold 1",
        content: "Cold content",
        project: "p1",
        status: "cold",
        scope: "project",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["t2"],
      };
      save(store, e1);
      save(store, e2);

      const stats = getLifecycleStats(store);
      expect(stats.total).toBe(2);
      expect(stats.by_status.active).toBe(1);
      expect(stats.by_status.cold).toBe(1);
      expect(stats.by_scope.project).toBe(2);
    });

    it("executes autoArchiveSweep to transition eligible aging memories", () => {
      const ancientSuperseded: MemoryEntry = {
        id: "m_403_ancient",
        title: "Ancient superseded rule",
        content: "Old rule",
        project: "p1",
        status: "superseded",
        superseded_by: "m_new",
        created_at: new Date(Date.now() - 300 * 86400000).toISOString(),
        updated_at: new Date(Date.now() - 300 * 86400000).toISOString(),
        tags: ["t"],
      };
      save(store, ancientSuperseded);

      const sweep = autoArchiveSweep(store);
      expect(sweep.swept).toBeGreaterThanOrEqual(1);
      expect(sweep.archived).toContain(ancientSuperseded.id);

      const updated = get(store, ancientSuperseded.id);
      expect(updated?.status).toBe("archived");
    });
  });

  describe("MCP Tool Handlers", () => {
    it("exposes and executes promotion and archival MCP tools", async () => {
      const { createServer } = await import("../src/mcp.ts");
      const server = createServer(tmpDir);
      const listHandler = (server as any)._requestHandlers?.get("tools/list");
      const callHandler = (server as any)._requestHandlers?.get("tools/call");
      expect(listHandler).toBeDefined();
      expect(callHandler).toBeDefined();

      const toolsList = await listHandler({ method: "tools/list" });
      const toolNames = toolsList.tools.map((t: any) => t.name);
      expect(toolNames).toContain("memory_evaluate_promotion");
      expect(toolNames).toContain("memory_promote");
      expect(toolNames).toContain("memory_generalize");
      expect(toolNames).toContain("memory_archive");
      expect(toolNames).toContain("memory_rehydrate");
      expect(toolNames).toContain("memory_lifecycle_status");

      // 1. memory_generalize
      const genRes = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_generalize",
          arguments: {
            content: "Fix cache in src/cache/service.ts at line 88",
            project: "cache",
          },
        },
      });
      expect(genRes.isError).toBeFalsy();
      const genData = JSON.parse(genRes.content[0].text);
      expect(genData.generalized).not.toContain("src/cache/service.ts");

      // 2. Add entry to test promote / archive
      const testEntry: MemoryEntry = {
        id: "m_501_mcp_test",
        title: "Test MCP Entry",
        content: "Universal validation invariant rule.",
        project: "test",
        status: "confirmed",
        scope: "project",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["test"],
        verification: { level: "independently-verified" },
      };
      save(store, testEntry);

      // 3. memory_archive
      const archRes = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_archive",
          arguments: {
            id: testEntry.id,
            tier: "cold",
            reason: "Testing MCP archive",
            dir: tmpDir,
          },
        },
      });
      expect(archRes.isError).toBeFalsy();
      const archData = JSON.parse(archRes.content[0].text);
      expect(archData.archived).toBe(true);
      expect(archData.new_status).toBe("cold");

      // 4. memory_rehydrate
      const rehydRes = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_rehydrate",
          arguments: {
            id: testEntry.id,
            score: 0.95,
            dir: tmpDir,
          },
        },
      });
      expect(rehydRes.isError).toBeFalsy();
      const rehydData = JSON.parse(rehydRes.content[0].text);
      expect(rehydData.rehydrated).toBe(true);

      // 5. memory_lifecycle_status
      const statusRes = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_lifecycle_status",
          arguments: {
            dir: tmpDir,
          },
        },
      });
      expect(statusRes.isError).toBeFalsy();
      const statusData = JSON.parse(statusRes.content[0].text);
      expect(statusData.stats.total).toBeGreaterThanOrEqual(1);
    });
  });
});
