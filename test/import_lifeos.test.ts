import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importLifeos, parseLifeosUserTree } from "../src/cli/import_lifeos.ts";

describe("T-444: Sovereign LifeOS Ingestion Engine", () => {
  let tempBase: string;
  let mockLifeosDir: string;
  let mockTargetDir: string;

  beforeEach(() => {
    tempBase = join(tmpdir(), `muse-lifeos-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    mockLifeosDir = join(tempBase, "LIFEOS", "USER");
    mockTargetDir = join(tempBase, ".memory");

    mkdirSync(join(mockLifeosDir, "PRINCIPAL"), { recursive: true });
    mkdirSync(join(mockLifeosDir, "TELOS"), { recursive: true });
    mkdirSync(join(mockLifeosDir, "DIGITAL_ASSISTANT"), { recursive: true });
    mkdirSync(join(mockLifeosDir, "CONFIG"), { recursive: true });
    mkdirSync(join(mockLifeosDir, "WORK"), { recursive: true });
    mkdirSync(mockTargetDir, { recursive: true });

    // Seed mock files
    writeFileSync(
      join(mockLifeosDir, "PRINCIPAL", "PRINCIPAL_IDENTITY.md"),
      `# Principal Identity\n\nName: Harsh\nRole: Founder & Technical Architect\nBio: Principal at LifeOS.\n`,
      "utf8",
    );

    writeFileSync(
      join(mockLifeosDir, "TELOS", "PRINCIPAL_TELOS.md"),
      `# Principal Telos\n\n## Vision\nBuild sovereign autonomous agency networks.\n\n## Core Values\n- Evidence before claims\n- Zero daemon architecture\n`,
      "utf8",
    );

    writeFileSync(
      join(mockLifeosDir, "DIGITAL_ASSISTANT", "DA_IDENTITY.md"),
      `# Digital Assistant Identity\n\nName: Muse\nRole: Chief Agency Orchestrator\nDivisions: Sol, Jasper, Crew, Nexus.\n`,
      "utf8",
    );

    writeFileSync(
      join(mockLifeosDir, "CONFIG", "OPERATIONAL_RULES.md"),
      `# Operational Rules\n\n- Strict TDD gate\n- Zero secrets committed\n`,
      "utf8",
    );

    writeFileSync(
      join(mockLifeosDir, "PROJECTS.md"),
      `# Active Projects\n\n- Muse Memory (Active)\n- Client Alpha (Maintenance)\n`,
      "utf8",
    );

    writeFileSync(
      join(mockLifeosDir, "WORK", "CLIENT_ALPHA.md"),
      `# Client Alpha Architecture\n\nStack: Next.js + Astro. Secret: sk-ant-12345678901234567890123456\n`,
      "utf8",
    );

    writeFileSync(
      join(mockLifeosDir, "DEFINITIONS.md"),
      `# Key Definitions\n\n- AS3: Autonomous System Level 3.\n`,
      "utf8",
    );

    // Target dir initialized
  });

  afterEach(() => {
    try {
      rmSync(tempBase, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("parses LifeOS user tree into structured sections and documents", () => {
    const parsed = parseLifeosUserTree(mockLifeosDir);
    expect(parsed.principal).toContain("Harsh");
    expect(parsed.telos).toContain("sovereign autonomous");
    expect(parsed.da).toContain("Chief Agency Orchestrator");
    expect(parsed.rules).toContain("Strict TDD gate");
    expect(parsed.projects).toContain("Client Alpha");
    expect(parsed.notes.length).toBeGreaterThanOrEqual(2); // CLIENT_ALPHA and DEFINITIONS
  });

  it("compiles sovereign USER.md and ingests notes into memory store", async () => {
    const result = await importLifeos({
      fromDir: mockLifeosDir,
      targetDir: mockTargetDir,
      dryRun: false,
    });

    expect(result.filesFound).toBeGreaterThanOrEqual(7);
    expect(result.memoriesImported).toBeGreaterThanOrEqual(2);
    expect(result.userMdUpdated).toBe(true);
    expect(result.sanitizedSecretsCount).toBeGreaterThanOrEqual(1);

    // Verify USER.md was generated
    const userMdPath = join(mockTargetDir, "USER.md");
    expect(existsSync(userMdPath)).toBe(true);
    const userMdContent = readFileSync(userMdPath, "utf8");
    expect(userMdContent).toContain("Harsh");
    expect(userMdContent).toContain("Muse");
    expect(userMdContent).toContain("Evidence before claims");

    // Verify secret in CLIENT_ALPHA was sanitized
    expect(userMdContent).not.toContain("sk-ant-12345678901234567890123456");
  });

  it("supports dry-run mode without modifying store or writing files", async () => {
    const result = await importLifeos({
      fromDir: mockLifeosDir,
      targetDir: mockTargetDir,
      dryRun: true,
    });

    expect(result.filesFound).toBeGreaterThanOrEqual(7);
    expect(result.memoriesImported).toBeGreaterThanOrEqual(2);
    expect(result.userMdUpdated).toBe(true);

    const userMdPath = join(mockTargetDir, "USER.md");
    expect(existsSync(userMdPath)).toBe(false);
  });

  it("deduplicates notes on subsequent runs", async () => {
    const run1 = await importLifeos({
      fromDir: mockLifeosDir,
      targetDir: mockTargetDir,
      dryRun: false,
    });
    expect(run1.memoriesImported).toBeGreaterThanOrEqual(2);

    const run2 = await importLifeos({
      fromDir: mockLifeosDir,
      targetDir: mockTargetDir,
      dryRun: false,
    });
    expect(run2.memoriesImported).toBe(0); // All already imported
  });
});
