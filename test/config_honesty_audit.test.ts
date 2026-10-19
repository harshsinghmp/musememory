import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import {
  auditConfigHonesty,
  enforceConfigHonesty,
  extractConfigPaths,
  ConfigHonestyError,
} from "../src/quality/config_honesty.ts";

describe("T-129: config-honesty AST audit (WIRED/DORMANT/UNREAD, build-failing)", () => {
  it("extracts all declared configuration paths from DEFAULT_SETTINGS", () => {
    const paths = extractConfigPaths();
    expect(paths.length).toBeGreaterThan(40);

    const pathStrings = paths.map((p) => p.path);
    expect(pathStrings).toContain("retrieval.defaultMode");
    expect(pathStrings).toContain("retrieval.embedderUrl");
    expect(pathStrings).toContain("mcp.bearerToken");
    expect(pathStrings).toContain("mcp.allowedPeers");
    expect(pathStrings).toContain("imports.secretScanEnabled");
    expect(pathStrings).toContain("ui.theme");
  });

  it("audits the repository and classifies configuration keys accurately", () => {
    const report = auditConfigHonesty();

    expect(report.totalKeys).toBeGreaterThan(40);
    expect(report.wiredCount).toBeGreaterThan(0);
    expect(report.entries.length).toBe(report.totalKeys);
    expect(report.honestyScore).toBeGreaterThan(0);
    expect(report.honestyScore).toBeLessThanOrEqual(1);

    // Verify key known wired settings
    expect(report.wiredKeys).toContain("mcp.bearerToken");
    expect(report.wiredKeys).toContain("mcp.allowedPeers");
    expect(report.wiredKeys).toContain("retrieval.embedderUrl");
    expect(report.wiredKeys).toContain("imports.secretScanEnabled");

    const embedderEntry = report.entries.find((e) => e.path === "retrieval.embedderUrl");
    expect(embedderEntry).toBeDefined();
    expect(embedderEntry!.status).toBe("WIRED");
    expect(embedderEntry!.referencesCount).toBeGreaterThan(0);
    expect(embedderEntry!.usageSites.length).toBeGreaterThan(0);
    expect(embedderEntry!.usageSites[0].file).toBeDefined();
    expect(embedderEntry!.usageSites[0].line).toBeGreaterThan(0);
  });

  it("identifies dormant keys and allows exemption lists", () => {
    const report = auditConfigHonesty(join(process.cwd(), "src"), {
      allowedDormant: ["retrieval.treeMaxDepth", "wiki.autoCompile"],
    });

    expect(report.dormantKeys).toContain("retrieval.treeMaxDepth");
    expect(report.dormantKeys).toContain("wiki.autoCompile");

    const treeEntry = report.entries.find((e) => e.path === "retrieval.treeMaxDepth");
    expect(treeEntry).toBeDefined();
    expect(treeEntry!.status).toBe("DORMANT");
  });

  it("enforces minimum honesty score requirement and fails when threshold is unmet", () => {
    const report = auditConfigHonesty(join(process.cwd(), "src"), {
      minHonestyScore: 0.99, // Unattainably high score to verify gate failure
    });

    expect(report.passed).toBe(false);
    expect(report.errors).toBeDefined();
    expect(report.errors![0]).toContain("is below minimum requirement of 0.99");

    expect(() => enforceConfigHonesty(report)).toThrow(ConfigHonestyError);
  });

  it("enforceConfigHonesty passes cleanly when requirements are satisfied", () => {
    const report = auditConfigHonesty(join(process.cwd(), "src"), {
      minHonestyScore: 0.1,
      strict: false,
    });

    expect(report.passed).toBe(true);
    expect(() => enforceConfigHonesty(report)).not.toThrow();
  });

  it("enforces strict mode with build-failing error on unallowed unread keys", () => {
    const report = auditConfigHonesty(join(process.cwd(), "src"), {
      strict: true,
      allowedUnread: [], // No exemptions
    });

    if (report.unreadCount > 0) {
      expect(report.passed).toBe(false);
      expect(report.errors).toBeDefined();
      expect(report.errors![0]).toContain("Config honesty audit failed in strict mode");
      expect(() => enforceConfigHonesty(report)).toThrow(ConfigHonestyError);
    }
  });

  it("passes strict mode when unread keys are explicitly allowlisted", () => {
    const baseReport = auditConfigHonesty();
    const report = auditConfigHonesty(join(process.cwd(), "src"), {
      strict: true,
      allowedUnread: baseReport.unreadKeys,
    });

    expect(report.passed).toBe(true);
    expect(() => enforceConfigHonesty(report)).not.toThrow();
  });
});
