import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, save } from "../src/store.ts";
import { evaluateProjectHealth } from "../src/health/index.ts";
import { recordAdr } from "../src/adrs/index.ts";
import { createCodeAnchor } from "../src/anchors/index.ts";
import { handleHealthCommand } from "../src/cli/health.ts";
import { createServer } from "../src/mcp.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("R13: Unified 5-Pillar Project Health Gate & Observability", () => {
  let tmpDir: string;
  let store: ReturnType<typeof openStore>;
  let codeDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-health-test-"));
    store = openStore(join(tmpDir, ".memory"));
    codeDir = join(tmpDir, "src");
    mkdirSync(codeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("5-Pillar Health Evaluation Engine", () => {
    it("evaluates a pristine repository to Grade A and PASS status across all 5 pillars", () => {
      // 1. Source code
      const apiFile = join(codeDir, "api.ts");
      writeFileSync(apiFile, `export function handleRequest() { return "ok"; }\n`);

      // 2. Confirmed memory with valid code anchor
      const anchor = createCodeAnchor(tmpDir, {
        kind: "symbol",
        filePath: "src/api.ts",
        symbolName: "handleRequest",
      });

      const mem: MemoryEntry = {
        id: "m_clean_1",
        title: "Clean API Request Handler",
        content: "Handles API requests via handleRequest.",
        project: "web",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["api"],
        anchors: [anchor],
        verification: { level: "authoritative" },
      };
      save(store, mem);

      // 3. ADR
      recordAdr(store, tmpDir, {
        project: "web",
        title: "Stateless API Design",
        context_and_drivers: ["Horizontal scalability"],
        decision: "Stateless request handling",
        consequences: { positive: ["Fast"] },
        affected_files: ["src/api.ts"],
        affected_symbols: ["handleRequest"],
      });

      // 4. Negative lesson
      save(store, {
        id: "m_neg_clean",
        title: "DO NOT use synchronous file I/O in API handler",
        content: "Synchronous I/O blocks event loop.",
        project: "web",
        status: "confirmed",
        type: "negative",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["negative"],
        negative: {
          failed_approach: "fs.readFileSync",
          failure_reason: "Blocks event loop",
          severity: "high",
        },
      });

      const report = evaluateProjectHealth(store, tmpDir);

      expect(report.overall_score).toBeGreaterThanOrEqual(90);
      expect(report.overall_grade).toBe("A");
      expect(report.gate_status).toBe("PASS");

      // Verify each pillar
      expect(report.pillars.store_integrity.status).toBe("PASS");
      expect(report.pillars.code_anchors.status).toBe("PASS");
      expect(report.pillars.doc_code_alignment.status).toBe("PASS");
      expect(report.pillars.negative_anti_patterns.status).toBe("PASS");
      expect(report.pillars.technical_debt.status).toBe("PASS");
      expect(report.summary).toContain("Grade A");
    });

    it("detects degradation when conflicts, drifted anchors, and high tech debt exist", () => {
      // 1. Degraded source code with FIXME and 'as any'
      const badFile = join(codeDir, "bad.ts");
      writeFileSync(
        badFile,
        `// FIXME: Critical race condition in transaction handler\n` +
          `// HACK: Temporary bypass of validation\n` +
          `export function processOrder(item: any) {\n` +
          `  const casted = item as any;\n` +
          `  return casted;\n` +
          `}\n`
      );

      // 2. Anchored memory that drifts
      const anchor = createCodeAnchor(tmpDir, {
        kind: "symbol",
        filePath: "src/bad.ts",
        symbolName: "processOrder",
      });

      save(store, {
        id: "m_drift_mem",
        title: "Order Process Contract",
        content: "Process order contract.",
        project: "shop",
        status: "conflicted", // Conflict in store!
        conflict_ids: ["m_other_conflict"],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["order"],
        anchors: [anchor],
      });

      // Mutate badFile so anchor drifts
      writeFileSync(
        badFile,
        `// FIXME: Critical race condition in transaction handler\n` +
          `// HACK: Temporary bypass of validation\n` +
          `export function processOrder(item: any, force: boolean) {\n` +
          `  const casted = item as any;\n` +
          `  return force ? casted : null;\n` +
          `}\n`
      );

      const report = evaluateProjectHealth(store, tmpDir);

      expect(report.overall_score).toBeLessThan(90);
      expect(report.pillars.store_integrity.metrics.conflicted_memories).toBe(1);
      expect(report.pillars.code_anchors.metrics.drifted_anchors).toBe(1);
      expect(report.pillars.technical_debt.score).toBeLessThan(100);
      expect(report.actionable_checklist.length).toBeGreaterThan(0);
    });
  });

  describe("CLI Health Command Integration", () => {
    it("executes handleHealthCommand and outputs JSON report", async () => {
      let output = "";
      const origLog = console.log;
      console.log = (str: string) => {
        output += str + "\n";
      };

      try {
        const exitCode = await handleHealthCommand({
          positional: ["health"],
          flags: { dir: tmpDir, json: "true" },
        });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output);
        expect(parsed.overall_score).toBeDefined();
        expect(parsed.overall_grade).toBeDefined();
        expect(parsed.pillars.store_integrity).toBeDefined();
        expect(parsed.pillars.code_anchors).toBeDefined();
      } finally {
        console.log = origLog;
      }
    });

    it("executes handleHealthCommand and outputs formatted ANSI dashboard", async () => {
      let output = "";
      const origLog = console.log;
      console.log = (str: string) => {
        output += str + "\n";
      };

      try {
        const exitCode = await handleHealthCommand({
          positional: ["health"],
          flags: { dir: tmpDir },
        });

        expect(exitCode).toBe(0);
        expect(output).toContain("MUSE MEMORY 5-PILLAR PROJECT HEALTH GATE");
        expect(output).toContain("PILLAR BREAKDOWN");
        expect(output).toContain("Memory Store Integrity");
        expect(output).toContain("Native Code Anchor Validity");
        expect(output).toContain("Documentation <-> Code Alignment");
      } finally {
        console.log = origLog;
      }
    });
  });

  describe("MCP Tool Execution for muse_health", () => {
    it("executes muse_health via MCP tool/call", async () => {
      const server = createServer(tmpDir, "full");
      const callHandler = (server as any)._requestHandlers.get("tools/call");

      const res = await callHandler({
        method: "tools/call",
        params: {
          name: "muse_health",
          arguments: {
            dir: tmpDir,
          },
        },
      });

      expect(res.isError).toBeFalsy();
      const report = JSON.parse(res.content[0].text);
      expect(report.overall_score).toBeDefined();
      expect(report.overall_grade).toBeDefined();
      expect(report.gate_status).toBeDefined();
      expect(report.pillars.store_integrity).toBeDefined();
      expect(report.pillars.code_anchors).toBeDefined();
      expect(report.pillars.doc_code_alignment).toBeDefined();
      expect(report.pillars.negative_anti_patterns).toBeDefined();
      expect(report.pillars.technical_debt).toBeDefined();
    });
  });
});
