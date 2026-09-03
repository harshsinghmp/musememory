import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, save } from "../src/store.ts";
import { recordAdr } from "../src/adrs/engine.ts";
import { analyzeMemoryCodeImpact, formatImpactReport } from "../src/intelligence/impact.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("Unified Memory & Code Impact Analysis", () => {
  let tempDir: string;
  let storeDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "muse-impact-test-"));
    storeDir = join(tempDir, ".memory");
    mkdirSync(storeDir, { recursive: true });
    mkdirSync(join(storeDir, "memories"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("evaluates impact and elevates risk when ADRs, negative lessons, and constraints exist", async () => {
    const store = openStore(storeDir);

    // 1. Create a dummy source file
    const srcDir = join(tempDir, "src");
    mkdirSync(srcDir, { recursive: true });
    const targetFile = join(srcDir, "auth.ts");
    writeFileSync(targetFile, "export function authenticateUser(token: string) { return true; }\n", "utf8");

    // 2. Create an ADR governing auth.ts
    recordAdr(store, tempDir, {
      title: "Mandate JWT v2 Tokens with 15-Minute Expiry",
      project: "impact-test",
      decision: "All user authentication must use JWT v2 tokens.",
      context_and_drivers: ["Token replay defense"],
      consequences: {
        positive: ["Eliminates replay attacks"],
        negative: ["Requires client refresh token rotation"],
      },
      affected_files: ["src/auth.ts"],
      affected_symbols: ["authenticateUser"],
    });

    // 3. Create a negative memory warning against auth.ts
    const negEntry: MemoryEntry = {
      id: "m_neg_auth_1",
      title: "DO NOT bypass JWT verification in tests or handlers",
      content: "Bypassing JWT verification caused silent privilege escalation bugs in production.",
      project: "impact-test",
      status: "confirmed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      temporal_mode: "timeless",
      negative: {
        failed_approach: "Bypassing JWT verification with test query parameter",
        failure_reason: "Privilege escalation vulnerability",
        severity: "critical",
      },
      tags: ["negative", "auth", "security"],
      anchors: [{ id: "anc_auth", kind: "file", file_path: "src/auth.ts" }],
    };
    save(store, negEntry);

    // 4. Create an active constraint in CURRENT.md
    writeFileSync(
      join(storeDir, "CURRENT.md"),
      "# Active Constraints\n\n- [ ] Never log authentication tokens\n- [ ] Enforce 15-minute token expiry\n",
      "utf8"
    );

    // Run impact analysis
    const result = await analyzeMemoryCodeImpact(store, {
      filePath: "src/auth.ts",
      symbolName: "authenticateUser",
      workspaceRoot: tempDir,
    });

    expect(result.target.file).toBe("src/auth.ts");
    expect(result.target.symbol).toBe("authenticateUser");
    expect(result.riskScore).toBeGreaterThanOrEqual(40);
    expect(["MEDIUM", "HIGH", "CRITICAL"]).toContain(result.risk);

    // Verify governing ADR was detected
    expect(result.memory.adrs.length).toBeGreaterThan(0);
    expect(result.memory.adrs[0].title).toContain("Mandate JWT v2 Tokens");

    // Verify negative warning was detected
    expect(result.memory.negativeWarnings.length).toBeGreaterThan(0);
    expect(result.memory.negativeWarnings[0].pattern).toContain("Bypassing JWT verification");

    // Verify active constraints detected
    expect(result.memory.activeConstraints.length).toBeGreaterThan(0);

    // Verify recommendations
    expect(result.recommendations.some((r) => r.includes("ADR"))).toBe(true);
    expect(result.recommendations.some((r) => r.includes("negative pattern") || r.includes("Avoid"))).toBe(true);

    // Verify formatted report output
    const reportText = formatImpactReport(result);
    expect(reportText).toContain("UNIFIED CODE & MEMORY IMPACT ANALYSIS");
    expect(reportText).toContain("src/auth.ts");
    expect(reportText).toContain("Governing ADRs:");
    expect(reportText).toContain("Negative Warnings:");
  });

  it("reports LOW risk for isolated files with zero ADRs or negative warnings", async () => {
    const store = openStore(storeDir);
    const result = await analyzeMemoryCodeImpact(store, {
      filePath: "src/isolated_util.ts",
      workspaceRoot: tempDir,
    });

    expect(result.risk).toBe("LOW");
    expect(result.riskScore).toBeLessThan(30);
    expect(result.memory.adrs.length).toBe(0);
    expect(result.memory.negativeWarnings.length).toBe(0);
  });
});
