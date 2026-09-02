import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, save } from "../src/store.ts";
import {
  resolveMuseContext,
  resolveCodeForMemory,
  resolveMemoryForCode,
  filterToolsForProfile,
  listMcpProfiles,
  getActiveMcpProfile,
} from "../src/orchestrator/index.ts";
import { createCodeAnchor } from "../src/anchors/index.ts";
import { createServer } from "../src/mcp.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("R9 & R10: Unified Context Orchestrator & Task-Focused MCP Profiles", () => {
  let tmpDir: string;
  let store: ReturnType<typeof openStore>;
  let codeDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-orchestrator-test-"));
    store = openStore(join(tmpDir, ".memory"));
    codeDir = join(tmpDir, "src");
    mkdirSync(codeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Flagship Unified Tool: muse_context", () => {
    it("fuses active constraints, code anchors, ranked memories, and negative lessons under token budget", async () => {
      // 1. Setup CURRENT.md with active invariants
      writeFileSync(
        join(store.memoryDir!, "CURRENT.md"),
        `# Project Status\n\n## Active Working Constraints & Open Loops\n- Invariant: Zero external daemons permitted.\n- Invariant: All endpoints require rate limiting.\n`
      );

      // 2. Setup code file
      const authFile = join(codeDir, "auth.ts");
      writeFileSync(
        authFile,
        `export function authenticateToken(token: string): boolean {\n  return token === "valid";\n}\n`
      );

      const anchor = createCodeAnchor(tmpDir, {
        kind: "symbol",
        filePath: "src/auth.ts",
        symbolName: "authenticateToken",
      });

      // 3. Save anchored architectural decision
      const mem1: MemoryEntry = {
        id: "m_901_auth",
        title: "Token authentication contract",
        content: "Use authenticateToken with HMAC SHA256 validation in auth.ts.",
        project: "test",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["auth", "token"],
        anchors: [anchor],
      };

      // 4. Save negative anti-pattern memory
      const mem2: MemoryEntry = {
        id: "m_902_neg",
        title: "Do not store JWT in unencrypted local storage",
        content: "Storing JWT tokens in localStorage causes XSS session hijacking vulnerabilities.",
        project: "test",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["negative", "security", "anti-pattern"],
        negative: {
          failed_approach: "Store JWT in localStorage",
          failure_reason: "Causes XSS session hijacking vulnerabilities",
          reproduction_command: "localStorage.setItem('jwt', token)",
          severity: "critical",
        },
      };

      // 5. Save general architectural decision
      const mem3: MemoryEntry = {
        id: "m_903_db",
        title: "Database connection pool timeout",
        content: "Keep max pool size at 20 with 30s idle timeout.",
        project: "test",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["database"],
      };

      save(store, mem1);
      save(store, mem2);
      save(store, mem3);

      // Execute flagship orchestrator
      const fused = await resolveMuseContext(store, tmpDir, {
        query: "authentication tokens",
        active_file: "src/auth.ts",
        symbol: "authenticateToken",
        task_intent: "feature",
        token_budget: 3000,
      });

      expect(fused.active_constraints.length).toBeGreaterThanOrEqual(1);
      expect(fused.active_constraints[0].content).toContain("Zero external daemons permitted");
      expect(fused.code_anchors.length).toBe(1);
      expect(fused.code_anchors[0].symbol_name).toBe("authenticateToken");
      expect(fused.negative_lessons.length).toBe(1);
      expect(fused.negative_lessons[0].id).toBe("m_902_neg");
      expect(fused.relevant_memories.some((m) => m.id === "m_901_auth")).toBe(true);
      expect(fused.suggested_next_steps.length).toBeGreaterThan(0);
      expect(fused.suggested_next_steps.some((s) => s.includes("Avoid known anti-pattern") || s.includes("Inspect anchored code symbol"))).toBe(true);
      expect(fused.tokens_used).toBeLessThanOrEqual(fused.token_budget);
    });

    it("respects token budget knapsack limits by prioritizing constraints and negative lessons", async () => {
      const mem1: MemoryEntry = {
        id: "m_904_c",
        title: "Strict Constraint A",
        content: "Never execute shell commands directly without authorization.",
        project: "test",
        type: "constraint",
        temporal_mode: "timeless",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["security"],
      };

      const mem2: MemoryEntry = {
        id: "m_905_neg",
        title: "Anti-pattern B",
        content: "Avoid synchronous blocking filesystem calls in hot request paths.",
        project: "test",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["negative"],
        negative: {
          failed_approach: "Synchronous blocking filesystem calls",
          failure_reason: "Blocks event loop in hot path",
          severity: "high",
        },
      };

      save(store, mem1);
      save(store, mem2);

      // Very tiny budget (e.g. 50 tokens)
      const fused = await resolveMuseContext(store, tmpDir, {
        query: "filesystem security",
        token_budget: 50,
      });

      expect(fused.tokens_used).toBeLessThanOrEqual(50);
      expect(fused.active_constraints.length + fused.negative_lessons.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Bidirectional Lookups", () => {
    it("resolves code references for memory (muse_code_for_memory)", () => {
      const paymentFile = join(codeDir, "payment.ts");
      writeFileSync(paymentFile, `export function chargeCard() { return true; }\n`);

      const anchor = createCodeAnchor(tmpDir, {
        kind: "symbol",
        filePath: "src/payment.ts",
        symbolName: "chargeCard",
      });

      const entry: MemoryEntry = {
        id: "m_906_payment",
        title: "Credit Card Billing Gateway",
        content: "Always invoke `chargeCard()` within `src/payment.ts` inside an idempotent try/catch block.",
        project: "billing",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["payment"],
        anchors: [anchor],
      };
      save(store, entry);

      const res = resolveCodeForMemory(store, entry.id);
      expect(res.memory_id).toBe(entry.id);
      expect(res.anchors.length).toBe(1);
      expect(res.referenced_files).toContain("src/payment.ts");
      expect(res.referenced_symbols).toContain("chargeCard");
    });

    it("resolves memories for code file and symbol (muse_memory_for_code)", () => {
      const orderFile = join(codeDir, "order.ts");
      writeFileSync(orderFile, `export function placeOrder() { return 1; }\n`);

      const anchor = createCodeAnchor(tmpDir, {
        kind: "symbol",
        filePath: "src/order.ts",
        symbolName: "placeOrder",
      });

      const decision: MemoryEntry = {
        id: "m_907_order",
        title: "Order Placement Workflow",
        content: "In `src/order.ts`, placeOrder requires inventory lock.",
        project: "shop",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["order"],
        anchors: [anchor],
      };

      const antiPattern: MemoryEntry = {
        id: "m_908_order_neg",
        title: "Never place order without inventory reservation",
        content: "Calling placeOrder without inventory reservation leads to overselling.",
        project: "shop",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["negative", "order"],
        negative: {
          failed_approach: "Place order without reservation",
          failure_reason: "Leads to overselling",
          severity: "high",
        },
      };

      save(store, decision);
      save(store, antiPattern);

      const res = resolveMemoryForCode(store, {
        filePath: "src/order.ts",
        symbolName: "placeOrder",
      });

      expect(res.total_found).toBe(2);
      expect(res.associated_memories.some((m) => m.id === "m_907_order")).toBe(true);
      expect(res.negative_lessons.some((m) => m.id === "m_908_order_neg")).toBe(true);
    });
  });

  describe("Task-Focused MCP Profiles", () => {
    it("lists all predefined profiles and tool mappings", () => {
      const profiles = listMcpProfiles();
      expect(profiles.length).toBe(7);
      const profileNames = profiles.map((p) => p.profile);
      expect(profileNames).toContain("core");
      expect(profileNames).toContain("coding");
      expect(profileNames).toContain("debugging");
      expect(profileNames).toContain("review");
      expect(profileNames).toContain("architecture");
      expect(profileNames).toContain("maintenance");
      expect(profileNames).toContain("full");
    });

    it("filters tools cleanly for core profile", () => {
      const sampleTools = [
        { name: "memory_read" },
        { name: "get_context" },
        { name: "memory_capture" },
        { name: "muse_context" },
        { name: "memory_anchor_create" },
      ];

      const coreTools = filterToolsForProfile(sampleTools, "core");
      expect(coreTools.length).toBe(3);
      expect(coreTools.map((t) => t.name)).toEqual(["memory_read", "get_context", "memory_capture"]);
    });

    it("filters tools cleanly for coding profile", () => {
      const sampleTools = [
        { name: "muse_context" },
        { name: "memory_anchor_create" },
        { name: "memory_read" },
        { name: "memory_wiki_compile" },
      ];

      const codingTools = filterToolsForProfile(sampleTools, "coding");
      expect(codingTools.length).toBe(3);
      expect(codingTools.map((t) => t.name)).toContain("muse_context");
      expect(codingTools.map((t) => t.name)).toContain("memory_anchor_create");
      expect(codingTools.map((t) => t.name)).not.toContain("memory_wiki_compile");
    });

    it("initializes createServer with coding profile and exposes only coding tools", async () => {
      const server = createServer(tmpDir, "coding");
      const listHandler = (server as any)._requestHandlers.get("tools/list");
      const res = await listHandler({ method: "tools/list", params: {} });
      const toolNames = res.tools.map((t: any) => t.name);

      expect(toolNames).toContain("muse_context");
      expect(toolNames).toContain("memory_anchor_create");
      expect(toolNames).toContain("muse_code_for_memory");
      expect(toolNames).toContain("muse_memory_for_code");
      expect(toolNames).not.toContain("memory_wiki_compile");
      expect(toolNames).not.toContain("memory_lifecycle_status");
    });

    it("initializes createServer with core profile and exposes minimal footprint", async () => {
      const server = createServer(tmpDir, "core");
      const listHandler = (server as any)._requestHandlers.get("tools/list");
      const res = await listHandler({ method: "tools/list", params: {} });
      const toolNames = res.tools.map((t: any) => t.name);

      expect(toolNames.length).toBeLessThanOrEqual(5);
      expect(toolNames).toContain("memory_read");
      expect(toolNames).toContain("get_context");
      expect(toolNames).not.toContain("muse_context");
    });
  });

  describe("MCP Tool Execution for Flagship Orchestrator", () => {
    it("executes muse_context, muse_code_for_memory, and muse_memory_for_code via tool/call", async () => {
      const server = createServer(tmpDir, "full");
      const callHandler = (server as any)._requestHandlers.get("tools/call");

      const entry: MemoryEntry = {
        id: "m_909_mcp",
        title: "Session Gateway Cache",
        content: "In `src/cache.ts`, call initCache() on startup.",
        project: "app",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["cache"],
      };
      save(store, entry);

      // 1. muse_context
      const ctxRes = await callHandler({
        method: "tools/call",
        params: {
          name: "muse_context",
          arguments: {
            query: "cache init",
            dir: tmpDir,
          },
        },
      });
      expect(ctxRes.isError).toBeFalsy();
      const ctxData = JSON.parse(ctxRes.content[0].text);
      expect(ctxData.tokens_used).toBeGreaterThan(0);
      expect(ctxData.relevant_memories.some((m: any) => m.id === "m_909_mcp")).toBe(true);

      // 2. muse_code_for_memory
      const codeRes = await callHandler({
        method: "tools/call",
        params: {
          name: "muse_code_for_memory",
          arguments: {
            memory_id: entry.id,
            dir: tmpDir,
          },
        },
      });
      expect(codeRes.isError).toBeFalsy();
      const codeData = JSON.parse(codeRes.content[0].text);
      expect(codeData.referenced_files).toContain("src/cache.ts");

      // 3. muse_memory_for_code
      const memRes = await callHandler({
        method: "tools/call",
        params: {
          name: "muse_memory_for_code",
          arguments: {
            file_path: "src/cache.ts",
            dir: tmpDir,
          },
        },
      });
      expect(memRes.isError).toBeFalsy();
      const memData = JSON.parse(memRes.content[0].text);
      expect(memData.total_found).toBe(1);

      // 4. muse_profile_list
      const profRes = await callHandler({
        method: "tools/call",
        params: {
          name: "muse_profile_list",
          arguments: {},
        },
      });
      expect(profRes.isError).toBeFalsy();
      const profData = JSON.parse(profRes.content[0].text);
      expect(profData.profiles.length).toBe(7);
    });
  });
});
