import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, save, get } from "../src/store.ts";
import {
  recordAdr,
  supersedeAdr,
  listAdrs,
  detectDocumentationCodeDrift,
} from "../src/adrs/index.ts";
import { createCodeAnchor } from "../src/anchors/index.ts";
import { createServer } from "../src/mcp.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("R11: Architecture Decision Records (ADRs) & Documentation Drift Engine", () => {
  let tmpDir: string;
  let store: ReturnType<typeof openStore>;
  let codeDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-adr-test-"));
    store = openStore(join(tmpDir, ".memory"));
    codeDir = join(tmpDir, "src");
    mkdirSync(codeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("First-Class ADR Creation & Formatting", () => {
    it("creates, auto-numbers, and formats ADR-1 with native code anchors", () => {
      const authFile = join(codeDir, "auth.ts");
      writeFileSync(authFile, `export function verifyHmac() { return true; }\n`);

      const adr1 = recordAdr(store, tmpDir, {
        project: "gateway",
        title: "Stateless HMAC Authentication Tokens",
        context_and_drivers: [
          "Session storage causes database bottlenecks under peak load",
          "Horizontal autoscaling requires stateless request validation",
        ],
        decision: "Adopt HMAC SHA-256 signed bearer tokens with 15-minute rotation windows.",
        consequences: {
          positive: ["Eliminates session database lookups", "Enables linear horizontal scaling"],
          negative: ["Immediate token revocation requires active blacklist cache"],
          neutral: ["Clients must implement token renewal refresh workflow"],
        },
        options_considered: [
          {
            title: "Database-backed sessions",
            pros: ["Instant revocation"],
            cons: ["High database load"],
            rejected_reason: "Does not meet sub-10ms latency requirement",
          },
        ],
        affected_files: ["src/auth.ts"],
        affected_symbols: ["verifyHmac"],
      });

      expect(adr1.adr?.adr_number).toBe(1);
      expect(adr1.title).toBe("ADR-1: Stateless HMAC Authentication Tokens");
      expect(adr1.status).toBe("confirmed");
      expect(adr1.temporal_mode).toBe("timeless");
      expect(adr1.type).toBe("adr");
      expect(adr1.content).toContain("# ADR-1: Stateless HMAC Authentication Tokens");
      expect(adr1.content).toContain("## Status\nACCEPTED");
      expect(adr1.content).toContain("## Decision");
      expect(adr1.content).toContain("Option: Database-backed sessions");
      expect(adr1.anchors?.length).toBe(1);
      expect(adr1.anchors?.[0].symbol_name).toBe("verifyHmac");

      // Verify audit trail
      const auditLog = readFileSync(join(store.memoryDir!, "audit.jsonl"), "utf8");
      expect(auditLog).toContain('"operation":"adr_recorded"');
    });

    it("auto-increments ADR number sequentially", () => {
      const adr1 = recordAdr(store, tmpDir, {
        project: "app",
        title: "First Decision",
        context_and_drivers: ["Driver 1"],
        decision: "Decision 1",
        consequences: { positive: ["P1"] },
      });

      const adr2 = recordAdr(store, tmpDir, {
        project: "app",
        title: "Second Decision",
        context_and_drivers: ["Driver 2"],
        decision: "Decision 2",
        consequences: { positive: ["P2"] },
      });

      expect(adr1.adr?.adr_number).toBe(1);
      expect(adr2.adr?.adr_number).toBe(2);
      expect(adr2.title).toBe("ADR-2: Second Decision");
    });

    it("supports ADR supersession workflow with mutual linking and audit records", () => {
      const adr1 = recordAdr(store, tmpDir, {
        project: "app",
        title: "Monolithic Router Architecture",
        context_and_drivers: ["Early prototype"],
        decision: "Use single file router for all API endpoints.",
        consequences: { positive: ["Simple"] },
      });

      const adr2 = recordAdr(store, tmpDir, {
        project: "app",
        title: "Modular Domain Router Architecture",
        context_and_drivers: ["Route file exceeds 3000 lines"],
        decision: "Split router into domain-specific modules.",
        consequences: { positive: ["Separation of concerns"] },
        supersedes: adr1.id,
      });

      expect(adr2.adr?.supersedes).toBe(adr1.id);

      const refreshedAdr1 = get(store, adr1.id);
      expect(refreshedAdr1?.status).toBe("superseded");
      expect(refreshedAdr1?.adr?.status).toBe("superseded");
      expect(refreshedAdr1?.adr?.superseded_by).toBe(adr2.id);

      // Verify audit log
      const auditLog = readFileSync(join(store.memoryDir!, "audit.jsonl"), "utf8");
      expect(auditLog).toContain('"operation":"adr_superseded"');
    });

    it("lists ADRs and filters by status", () => {
      recordAdr(store, tmpDir, {
        project: "app",
        title: "Accepted 1",
        context_and_drivers: ["D1"],
        decision: "Dec 1",
        consequences: {},
        status: "accepted",
      });

      recordAdr(store, tmpDir, {
        project: "app",
        title: "Proposed 2",
        context_and_drivers: ["D2"],
        decision: "Dec 2",
        consequences: {},
        status: "proposed",
      });

      const all = listAdrs(store);
      expect(all.length).toBe(2);

      const proposedOnly = listAdrs(store, "proposed");
      expect(proposedOnly.length).toBe(1);
      expect(proposedOnly[0].adr?.status).toBe("proposed");
    });
  });

  describe("Documentation <-> Code Drift Engine", () => {
    it("classifies code and doc alignment across DOCUMENTED, IMPLEMENTED, PARTIAL, CONFLICTING, STALE, and MISSING", () => {
      // 1. Create source files
      const cacheFile = join(codeDir, "cache.ts");
      const dbFile = join(codeDir, "db.ts");
      const orphanedFile = join(codeDir, "old.ts");

      writeFileSync(cacheFile, `export function getCachedItem() { return null; }\n`);
      writeFileSync(dbFile, `export function queryDatabase() { return []; }\nexport function unDocumentedHelper() { return true; }\n`);
      writeFileSync(orphanedFile, `export function toDelete() { return 0; }\n`);

      // Anchor for cache
      const cacheAnchor = createCodeAnchor(tmpDir, {
        kind: "symbol",
        filePath: "src/cache.ts",
        symbolName: "getCachedItem",
      });

      // Anchor for db
      const dbAnchor = createCodeAnchor(tmpDir, {
        kind: "symbol",
        filePath: "src/db.ts",
        symbolName: "queryDatabase",
      });

      // Anchor for old file
      const staleAnchor = createCodeAnchor(tmpDir, {
        kind: "symbol",
        filePath: "src/old.ts",
        symbolName: "toDelete",
      });

      // Record ADR pointing to cacheAnchor (IMPLEMENTED)
      recordAdr(store, tmpDir, {
        project: "app",
        title: "Redis L1 In-Memory Caching",
        context_and_drivers: ["High query latency"],
        decision: "Cache frequently read items in getCachedItem",
        consequences: {},
        affected_files: ["src/cache.ts"],
        affected_symbols: ["getCachedItem"],
      });

      // Record general memory pointing to dbAnchor
      const dbMemory: MemoryEntry = {
        id: "m_1101_db",
        title: "Database Query Limits",
        content: "Always use queryDatabase with pagination.",
        project: "app",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["database"],
        anchors: [dbAnchor],
      };
      save(store, dbMemory);

      // Record memory pointing to staleAnchor, then delete the file (STALE)
      const staleMemory: MemoryEntry = {
        id: "m_1102_stale",
        title: "Old Helper Contract",
        content: "Use toDelete helper.",
        project: "app",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["old"],
        anchors: [staleAnchor],
      };
      save(store, staleMemory);
      rmSync(orphanedFile); // Delete file -> becomes STALE

      // Mutate dbFile to trigger drift (PARTIAL)
      writeFileSync(dbFile, `export function queryDatabase(limit: number) { return [limit]; }\nexport function unDocumentedHelper() { return true; }\n`);

      // Run drift detection
      const report = detectDocumentationCodeDrift(store, tmpDir);

      expect(report.total_items).toBeGreaterThanOrEqual(4);
      expect(report.stale_count).toBeGreaterThanOrEqual(1);
      expect(report.partial_count).toBeGreaterThanOrEqual(1);
      expect(report.missing_count).toBeGreaterThanOrEqual(1);
      expect(report.alignment_score).toBeGreaterThan(0.0);
      expect(report.alignment_score).toBeLessThan(1.0);

      // Verify unDocumentedHelper was detected as MISSING
      const missingItem = report.items.find((i) => i.claimed_symbol === "unDocumentedHelper");
      expect(missingItem).toBeDefined();
      expect(missingItem?.drift_state).toBe("MISSING");

      // Verify stale item details
      const staleItem = report.items.find((i) => i.claimed_path === "src/old.ts");
      expect(staleItem).toBeDefined();
      expect(staleItem?.drift_state).toBe("STALE");
    });
  });

  describe("MCP Tool Integration for ADRs & Drift", () => {
    it("records ADRs, lists ADRs, and audits drift via MCP tool calls", async () => {
      const server = createServer(tmpDir, "full");
      const callHandler = (server as any)._requestHandlers.get("tools/call");

      const queueFile = join(codeDir, "queue.ts");
      writeFileSync(queueFile, `export function pushMessage() { return true; }\n`);

      // 1. memory_adr_record
      const recordRes = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_adr_record",
          arguments: {
            title: "Zero-Resident Background Task Queuing",
            context_and_drivers: ["Daemons cause memory leaks", "In-process queues required"],
            decision: "Use append-only tasks.jsonl without background daemons.",
            consequences: {
              positive: ["Zero daemon footprint"],
              negative: ["Queue polling bounded to CLI invocation"],
            },
            affected_files: ["src/queue.ts"],
            affected_symbols: ["pushMessage"],
            dir: tmpDir,
          },
        },
      });

      expect(recordRes.isError).toBeFalsy();
      const recordData = JSON.parse(recordRes.content[0].text);
      expect(recordData.adr_number).toBe(1);
      expect(recordData.adr.title).toContain("ADR-1: Zero-Resident Background Task Queuing");

      // 2. memory_adr_list
      const listRes = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_adr_list",
          arguments: {
            dir: tmpDir,
          },
        },
      });

      expect(listRes.isError).toBeFalsy();
      const listData = JSON.parse(listRes.content[0].text);
      expect(listData.total).toBe(1);
      expect(listData.adrs[0].adr_number).toBe(1);

      // 3. memory_drift_audit
      const driftRes = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_drift_audit",
          arguments: {
            dir: tmpDir,
          },
        },
      });

      expect(driftRes.isError).toBeFalsy();
      const driftData = JSON.parse(driftRes.content[0].text);
      expect(driftData.total_items).toBeGreaterThanOrEqual(1);
      expect(driftData.implemented_count).toBe(1);
    });
  });
});
