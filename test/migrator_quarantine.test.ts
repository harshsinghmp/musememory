import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, list } from "../src/store.ts";
import { validateMigratedRecord, normalizeMemoryStatus, normalizeMemoryType } from "../src/migrator/types.ts";
import { AgentMemoryAdapter } from "../src/migrator/adapters/agentmemory.ts";
import { GenericAdapter } from "../src/migrator/adapters/generic.ts";
import { runMigration, detectProviders } from "../src/migrator/index.ts";
import { expandPath } from "../src/migrator/detect.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "migrator-quarantine-test-"));
}

describe("T-366: Migrator Quarantine & Schema Intake Validation", () => {
  test("validateMigratedRecord validates intake schema and strips self-certified verification", () => {
    // 1. Rejects invalid input
    expect(validateMigratedRecord(null)).toBeNull();
    expect(validateMigratedRecord(undefined)).toBeNull();
    expect(validateMigratedRecord("string")).toBeNull();
    expect(validateMigratedRecord({ content: "" })).toBeNull();
    expect(validateMigratedRecord({ content: "   " })).toBeNull();

    // 2. Synthesizes title from content when missing
    const withGeneratedTitle = validateMigratedRecord({
      content: "This is a detailed architectural note about SQLite storage.",
    });
    expect(withGeneratedTitle).not.toBeNull();
    expect(withGeneratedTitle?.title).toBe("This is a detailed architectural note about SQLite storage.");
    expect(withGeneratedTitle?.status).toBe("candidate");

    // 3. Normalizes invalid status to candidate
    const withInvalidStatus = validateMigratedRecord({
      title: "Valid Title",
      content: "Valid Content",
      status: "invalid-status" as any,
    });
    expect(withInvalidStatus?.status).toBe("candidate");

    // 4. Strips self-certified independently-verified level to undefined
    const withSelfCertified = validateMigratedRecord({
      title: "Unverified Claim",
      content: "Some claim without proof",
      status: "confirmed",
      verification: {
        level: "independently-verified",
        verified_by: "migrator:agentmemory",
      },
    });
    expect(withSelfCertified?.verification).toBeUndefined();
  });

  test("AgentMemoryAdapter does not self-certify with verification metadata", () => {
    const root = temp();
    const jsonPath = join(root, "standalone.json");
    writeFileSync(
      jsonPath,
      JSON.stringify({
        "mem:memories": {
          "m_1": {
            id: "mem_1",
            type: "fact",
            title: "Database Setting",
            content: "Using WAL mode with SQLite.",
            isLatest: true,
          },
        },
      }),
      "utf8"
    );

    const records = AgentMemoryAdapter.extract(jsonPath);
    expect(records.length).toBe(1);
    expect(records[0].verification).toBeUndefined();

    rmSync(root, { recursive: true, force: true });
  });

  test("GenericAdapter never writes status: confirmed", () => {
    const root = temp();

    // Test JSON extraction
    const jsonPath = join(root, "notes.json");
    writeFileSync(
      jsonPath,
      JSON.stringify([
        { title: "Note 1", content: "Generic JSON note 1" },
        { title: "Note 2", content: "Generic JSON note 2", status: "confirmed" },
      ]),
      "utf8"
    );
    const jsonRecords = GenericAdapter.extract(jsonPath);
    expect(jsonRecords.length).toBe(2);
    for (const r of jsonRecords) {
      expect(r.status).toBe("candidate");
    }

    // Test Markdown extraction
    const mdPath = join(root, "guide.md");
    writeFileSync(mdPath, "# Architecture Guide\n\nSome guidelines.", "utf8");
    const mdRecords = GenericAdapter.extract(mdPath);
    expect(mdRecords.length).toBe(1);
    expect(mdRecords[0].status).toBe("candidate");

    // Test YAML extraction
    const yamlPath = join(root, "entry.yaml");
    writeFileSync(
      yamlPath,
      "title: YAML Entry\ncontent: Some YAML content\nstatus: confirmed\n",
      "utf8"
    );
    const yamlRecords = GenericAdapter.extract(yamlPath);
    expect(yamlRecords.length).toBe(1);
    expect(yamlRecords[0].status).toBe("candidate");

    rmSync(root, { recursive: true, force: true });
  });

  test("runMigration quaratines generic imports as candidate in store", async () => {
    const root = temp();
    const memoryDir = join(root, ".memory");
    const store = openStore(memoryDir);

    const docDir = join(root, "docs");
    mkdirSync(docDir, { recursive: true });
    writeFileSync(join(docDir, "readme.txt"), "External plain text imported doc with enough characters", "utf8");

    // Run migration using generic fallback on custom path
    const recs = GenericAdapter.extract(join(docDir, "readme.txt"));
    expect(recs.length).toBe(1);
    expect(recs[0].status).toBe("candidate");

    rmSync(root, { recursive: true, force: true });
  });

  test("T-340: GenericAdapter ignores package.json and arbitrary JSON config objects", () => {
    const root = temp();

    // 1. package.json must be completely ignored
    const pkgPath = join(root, "package.json");
    writeFileSync(
      pkgPath,
      JSON.stringify({
        name: "my-package",
        version: "1.0.0",
        description: "A library",
        scripts: { build: "tsc", test: "bun test" },
      }),
      "utf8"
    );
    const pkgRecords = GenericAdapter.extract(pkgPath);
    expect(pkgRecords.length).toBe(0);

    // 2. Arbitrary JSON config without memory fields must NOT convert Object.values to memories
    const configPath = join(root, "random_settings.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        theme: "dark",
        fontSize: 14,
        telemetry: false,
        port: 8080,
      }),
      "utf8"
    );
    const configRecords = GenericAdapter.extract(configPath);
    expect(configRecords.length).toBe(0);

    // 3. Single memory object with content is accepted
    const singleMemPath = join(root, "single_memory.json");
    writeFileSync(
      singleMemPath,
      JSON.stringify({
        title: "Architecture Design Note",
        content: "Using SQLite WAL mode with 64KB page size for persistent local storage.",
      }),
      "utf8"
    );
    const singleRecords = GenericAdapter.extract(singleMemPath);
    expect(singleRecords.length).toBe(1);
    expect(singleRecords[0].title).toBe("Architecture Design Note");
    expect(singleRecords[0].status).toBe("candidate");

    // 4. Oversized text file is capped at 10000 chars
    const largeDocPath = join(root, "big_doc.txt");
    const largeContent = "A".repeat(15000);
    writeFileSync(largeDocPath, largeContent, "utf8");
    const largeRecords = GenericAdapter.extract(largeDocPath);
    expect(largeRecords.length).toBe(1);
    expect(largeRecords[0].content.length).toBeLessThanOrEqual(10050);
    expect(largeRecords[0].content).toContain("[TRUNCATED_DOC_MIGRATION]");

    rmSync(root, { recursive: true, force: true });
  });

  test("T-348: detectProviders ignores empty directories and runMigration marks missing as skipped", async () => {
    const root = temp();
    const memoryDir = join(root, ".memory");
    const store = openStore(memoryDir);

    // 1. Create empty .beads directory
    const emptyBeads = join(root, ".beads");
    mkdirSync(emptyBeads, { recursive: true });

    // Empty directory must NOT trigger detection
    const detected = detectProviders(root);
    const beads = detected.find((d) => d.id === "beads");
    expect(beads?.detected).toBe(false);

    // 2. Running migration on provider without existing files must mark it as skipped
    const report = await runMigration(store, memoryDir, { provider: "beads" });
    expect(report.providers.length).toBe(1);
    expect(report.providers[0].status).toBe("skipped");

    rmSync(root, { recursive: true, force: true });
  });

  test("T-349: dry-run deduplicates batch-internal duplicates identically to actual run and reports counts", async () => {
    const root = temp();
    const memoryDir = join(root, ".memory");
    const store = openStore(memoryDir);

    // Create a provider file containing 3 items with identical title
    const beadsDir = join(root, ".beads");
    mkdirSync(beadsDir, { recursive: true });
    writeFileSync(
      join(beadsDir, "beads.json"),
      JSON.stringify([
        {
          id: "b1",
          title: "Duplicate Architecture Rule",
          description: "Rule content 1",
          status: "open",
        },
        {
          id: "b2",
          title: "Duplicate Architecture Rule",
          description: "Rule content 2",
          status: "open",
        },
        {
          id: "b3",
          title: "Duplicate Architecture Rule",
          description: "Rule content 3",
          status: "open",
        },
      ]),
      "utf8"
    );

    // 1. Dry run
    const dryReport = await runMigration(store, memoryDir, { provider: "beads", dryRun: true });
    expect(dryReport.totalMigrated).toBe(1);
    expect(dryReport.totalDeduplicated).toBe(2);
    expect(dryReport.providers[0].deduplicatedCount).toBe(2);

    // 2. Real run
    const realReport = await runMigration(store, memoryDir, { provider: "beads", dryRun: false });
    expect(realReport.totalMigrated).toBe(1);
    expect(realReport.totalDeduplicated).toBe(2);
    expect(realReport.providers[0].deduplicatedCount).toBe(2);

    rmSync(root, { recursive: true, force: true });
  });

  test("T-357: normalizeMemoryStatus normalizes statuses safely and agentmemory defaults to candidate when isLatest omitted", () => {
    // 1. normalizeMemoryStatus behavior
    expect(normalizeMemoryStatus("CLOSED")).toBe("superseded");
    expect(normalizeMemoryStatus("archived")).toBe("superseded");
    expect(normalizeMemoryStatus("deprecated")).toBe("superseded");
    expect(normalizeMemoryStatus("stale")).toBe("stale");
    expect(normalizeMemoryStatus("DRAFT")).toBe("candidate");
    expect(normalizeMemoryStatus("proposed")).toBe("candidate");
    expect(normalizeMemoryStatus("open")).toBe("candidate");
    expect(normalizeMemoryStatus("CONFIRMED")).toBe("confirmed");
    expect(normalizeMemoryStatus("ACTIVE")).toBe("confirmed");
    expect(normalizeMemoryStatus("unknown-status-val")).toBe("candidate");
    expect(normalizeMemoryStatus(undefined)).toBe("candidate");
    expect(normalizeMemoryStatus("active", true)).toBe("superseded"); // isArchived overrides

    // 2. AgentMemoryAdapter defaults to candidate when isLatest is omitted
    const root = temp();
    const jsonPath = join(root, "standalone.json");
    writeFileSync(
      jsonPath,
      JSON.stringify({
        "mem:memories": {
          "m_1": {
            id: "mem_1",
            title: "Omitted isLatest",
            content: "Content with isLatest omitted",
          },
          "m_2": {
            id: "mem_2",
            title: "Explicit isLatest true",
            content: "Content with isLatest true",
            isLatest: true,
          },
          "m_3": {
            id: "mem_3",
            title: "Explicit isLatest false",
            content: "Content with isLatest false",
            isLatest: false,
          },
        },
      }),
      "utf8"
    );

    const records = AgentMemoryAdapter.extract(jsonPath);
    expect(records.length).toBe(3);

    const omitted = records.find((r) => r.title === "Omitted isLatest");
    expect(omitted?.status).toBe("candidate");

    const confirmed = records.find((r) => r.title === "Explicit isLatest true");
    expect(confirmed?.status).toBe("confirmed");

    const superseded = records.find((r) => r.title === "Explicit isLatest false");
    expect(superseded?.status).toBe("superseded");

    rmSync(root, { recursive: true, force: true });
  });

  test("T-362: normalizeMemoryType does not misclassify loop, topic, propose, or option as operation", () => {
    // 1. Terms containing substring 'op' must NOT be misclassified as operation
    expect(normalizeMemoryType("loop")).toBe("discovery");
    expect(normalizeMemoryType("open_loop")).toBe("discovery");
    expect(normalizeMemoryType("topic")).toBe("discovery");
    expect(normalizeMemoryType("propose")).toBe("discovery");
    expect(normalizeMemoryType("option")).toBe("discovery");
    expect(normalizeMemoryType("scope")).toBe("discovery");
    expect(normalizeMemoryType("opinion")).toBe("discovery");

    // 2. Legitimate operation terms must be classified as operation
    expect(normalizeMemoryType("operation")).toBe("operation");
    expect(normalizeMemoryType("operations")).toBe("operation");
    expect(normalizeMemoryType("ops")).toBe("operation");
    expect(normalizeMemoryType("op_procedure")).toBe("operation");
    expect(normalizeMemoryType("task")).toBe("operation");
    expect(normalizeMemoryType("procedure")).toBe("operation");
    expect(normalizeMemoryType("skill")).toBe("operation");
    expect(normalizeMemoryType("runbook")).toBe("operation");
    expect(normalizeMemoryType("playbook")).toBe("operation");
  });
});
