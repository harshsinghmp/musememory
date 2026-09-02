import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, save } from "../src/store.ts";
import {
  explainWhyCodeIsTheWayItIs,
  clusterRecurringBugsAndFriction,
  analyzeTechnicalDebt,
} from "../src/cognition/index.ts";
import { recordAdr } from "../src/adrs/index.ts";
import { createCodeAnchor } from "../src/anchors/index.ts";
import { createServer } from "../src/mcp.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("R12: Autonomous Engineering Cognition & 'Why' Reasoner", () => {
  let tmpDir: string;
  let store: ReturnType<typeof openStore>;
  let codeDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-cognition-test-"));
    store = openStore(join(tmpDir, ".memory"));
    codeDir = join(tmpDir, "src");
    mkdirSync(codeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Autonomous 'Why' Explanation Engine", () => {
    it("traces historical timeline of ADRs, bug fixes, and constraints to explain code rationale", () => {
      const authFile = join(codeDir, "session.ts");
      writeFileSync(
        authFile,
        `export function validateSessionToken(token: string) {\n  if (!token) throw new Error("Missing token");\n  return true;\n}\n`
      );

      // 1. ADR establishing the architecture
      const adr = recordAdr(store, tmpDir, {
        project: "auth",
        title: "Stateless Session Token Verification",
        context_and_drivers: ["High latency from remote session cluster"],
        decision: "Validate cryptographically signed session tokens in memory using validateSessionToken.",
        consequences: {
          positive: ["Sub-millisecond verification"],
          negative: ["Requires local key caching", "Token revocation requires blacklist propagation"],
        },
        affected_files: ["src/session.ts"],
        affected_symbols: ["validateSessionToken"],
      });

      // 2. Bug fix hardening the code
      const fixEntry: MemoryEntry = {
        id: "m_1201_fix",
        title: "Fix null token crash in validateSessionToken",
        content: "Added boundary guard in `validateSessionToken` when undefined or empty token is supplied.",
        project: "auth",
        status: "confirmed",
        type: "fix",
        created_at: new Date(Date.now() + 1000).toISOString(),
        updated_at: new Date(Date.now() + 1000).toISOString(),
        tags: ["fix", "auth"],
        anchors: [
          createCodeAnchor(tmpDir, {
            kind: "symbol",
            filePath: "src/session.ts",
            symbolName: "validateSessionToken",
          }),
        ],
      };
      save(store, fixEntry);

      // 3. Negative lesson
      const negEntry: MemoryEntry = {
        id: "m_1202_neg",
        title: "DO NOT deserialize raw token payload without signature check",
        content: "Deserializing untrusted tokens causes remote code execution.",
        project: "auth",
        status: "confirmed",
        type: "negative",
        created_at: new Date(Date.now() + 2000).toISOString(),
        updated_at: new Date(Date.now() + 2000).toISOString(),
        tags: ["negative", "security"],
        negative: {
          failed_approach: "Raw JSON.parse of base64 token",
          failure_reason: "Bypasses cryptographic authentication signature check",
          severity: "critical",
        },
      };
      save(store, negEntry);

      // 4. Timeless invariant constraint
      const ruleEntry: MemoryEntry = {
        id: "m_1203_rule",
        title: "Never log session token strings to disk or stdout",
        content: "Mask session token as [REDACTED] in all logger output.",
        project: "auth",
        status: "confirmed",
        type: "constraint",
        temporal_mode: "timeless",
        created_at: new Date(Date.now() + 3000).toISOString(),
        updated_at: new Date(Date.now() + 3000).toISOString(),
        tags: ["rule", "security"],
      };
      save(store, ruleEntry);

      // Execute 'Why' Explanation query
      const explanation = explainWhyCodeIsTheWayItIs(store, {
        target: "validateSessionToken",
        filePath: "src/session.ts",
        symbolName: "validateSessionToken",
      });

      expect(explanation.target).toBe("validateSessionToken");
      expect(explanation.timeline.length).toBeGreaterThanOrEqual(2);
      expect(explanation.timeline[0].type).toBe("adr");
      expect(explanation.core_rationale).toContain("Stateless Session Token Verification");
      expect(explanation.trade_offs_accepted).toContain("Requires local key caching");
      expect(explanation.confidence_score).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe("Recurring Bug & Friction Clustering", () => {
    it("clusters bug fixes and failures into root cause categories and computes fragility scores", () => {
      // 1. Race condition fixes
      save(store, {
        id: "m_bug_1",
        title: "Fix async race condition in file lock release",
        content: "Parallel write operations caused concurrent interleaved writes to log file.",
        project: "core",
        status: "confirmed",
        type: "fix",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["fix", "async", "race"],
      });

      save(store, {
        id: "m_bug_2",
        title: "Fix deadlock during concurrent transaction commit",
        content: "Async lock acquired in reverse order caused permanent server deadlock.",
        project: "core",
        status: "confirmed",
        type: "fix",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["fix", "lock", "concurrency"],
      });

      // 2. Resource leak fix
      save(store, {
        id: "m_bug_3",
        title: "Fix socket file descriptor leak on client timeout",
        content: "Unclosed socket handle caused connection exhaustion and server hang.",
        project: "net",
        status: "confirmed",
        type: "fix",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["fix", "leak", "timeout"],
      });

      const clusters = clusterRecurringBugsAndFriction(store);

      expect(clusters.length).toBeGreaterThanOrEqual(2);

      const raceCluster = clusters.find((c) => c.category === "race_condition");
      expect(raceCluster).toBeDefined();
      expect(raceCluster?.occurrence_count).toBe(2);
      expect(raceCluster?.fragility_score).toBeGreaterThan(0.0);
      expect(raceCluster?.root_cause_hypothesis).toContain("Asynchronous");
      expect(raceCluster?.preventative_recommendation).toBeDefined();

      const leakCluster = clusters.find((c) => c.category === "resource_leak");
      expect(leakCluster).toBeDefined();
      expect(leakCluster?.occurrence_count).toBe(1);
    });
  });

  describe("Technical Debt & Workaround Registry", () => {
    it("scans workspace for TODO/FIXME comments, dangerous 'as any' casts, and drifted anchors", () => {
      const fileA = join(codeDir, "processor.ts");
      writeFileSync(
        fileA,
        `// TODO: Add retry loop with exponential backoff\n` +
          `// FIXME: Memory leak in event listener registration\n` +
          `export function processData(input: any) {\n` +
          `  const payload = input as any;\n` +
          `  return payload;\n` +
          `}\n`
      );

      const fileB = join(codeDir, "stale_mod.ts");
      writeFileSync(fileB, `export function initialFn() { return 1; }\n`);

      // Anchor pointing to fileB, then mutate fileB to trigger drifted anchor
      const anchor = createCodeAnchor(tmpDir, {
        kind: "symbol",
        filePath: "src/stale_mod.ts",
        symbolName: "initialFn",
      });

      save(store, {
        id: "m_anchor_mem",
        title: "Initial Function Contract",
        content: "Anchored to `initialFn`",
        project: "test",
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["contract"],
        anchors: [anchor],
      });

      // Mutate to create drift
      writeFileSync(fileB, `export function initialFn(x: number) { return x * 2; }\n`);

      const debtReport = analyzeTechnicalDebt(store, tmpDir);

      expect(debtReport.total_debt_items).toBeGreaterThanOrEqual(4);
      expect(debtReport.debt_score).toBeGreaterThan(20);
      expect(debtReport.hotspot_files.length).toBeGreaterThanOrEqual(1);
      expect(debtReport.hotspot_files[0].file_path).toContain("processor.ts");

      // Verify FIXME has high severity
      const fixmeItem = debtReport.items.find((i) => i.snippet.includes("FIXME"));
      expect(fixmeItem).toBeDefined();
      expect(fixmeItem?.severity).toBe("high");

      // Verify 'as any' type assertion item
      const castItem = debtReport.items.find((i) => i.type === "type_assertion");
      expect(castItem).toBeDefined();
      expect(castItem?.severity).toBe("medium");

      // Verify drifted anchor item
      const driftItem = debtReport.items.find((i) => i.type === "drifted_anchor");
      expect(driftItem).toBeDefined();
      expect(driftItem?.severity).toBe("high");

      expect(debtReport.refactoring_recommendations.length).toBeGreaterThan(0);
    });
  });

  describe("MCP Tool Execution for Cognition Tools", () => {
    it("executes muse_why, muse_bug_clusters, and muse_tech_debt via tool/call", async () => {
      const server = createServer(tmpDir, "full");
      const callHandler = (server as any)._requestHandlers.get("tools/call");

      const helperFile = join(codeDir, "helper.ts");
      writeFileSync(
        helperFile,
        `// FIXME: Hot path allocation\nexport function calculateTax() { return 0.1; }\n`
      );

      // Save a fix memory
      save(store, {
        id: "m_tax_fix",
        title: "Fix rounding error in calculateTax",
        content: "Corrected IEEE 754 floating point precision bug in calculateTax.",
        project: "billing",
        status: "confirmed",
        type: "fix",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: ["billing", "fix"],
        anchors: [
          createCodeAnchor(tmpDir, {
            kind: "symbol",
            filePath: "src/helper.ts",
            symbolName: "calculateTax",
          }),
        ],
      });

      // 1. muse_why
      const whyRes = await callHandler({
        method: "tools/call",
        params: {
          name: "muse_why",
          arguments: {
            target: "calculateTax",
            file_path: "src/helper.ts",
            symbol_name: "calculateTax",
            dir: tmpDir,
          },
        },
      });

      expect(whyRes.isError).toBeFalsy();
      const whyData = JSON.parse(whyRes.content[0].text);
      expect(whyData.target).toBe("calculateTax");
      expect(whyData.timeline.length).toBe(1);
      expect(whyData.timeline[0].type).toBe("fix");

      // 2. muse_bug_clusters
      const clusterRes = await callHandler({
        method: "tools/call",
        params: {
          name: "muse_bug_clusters",
          arguments: {
            dir: tmpDir,
          },
        },
      });

      expect(clusterRes.isError).toBeFalsy();
      const clusterData = JSON.parse(clusterRes.content[0].text);
      expect(clusterData.total_clusters).toBeGreaterThanOrEqual(1);

      // 3. muse_tech_debt
      const debtRes = await callHandler({
        method: "tools/call",
        params: {
          name: "muse_tech_debt",
          arguments: {
            dir: tmpDir,
          },
        },
      });

      expect(debtRes.isError).toBeFalsy();
      const debtData = JSON.parse(debtRes.content[0].text);
      expect(debtData.total_debt_items).toBeGreaterThanOrEqual(1);
      expect(debtData.debt_score).toBeGreaterThan(0);
    });
  });
});
