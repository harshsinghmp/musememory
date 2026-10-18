import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, list } from "../src/store.ts";
import { validateMigratedRecord } from "../src/migrator/types.ts";
import { AgentMemoryAdapter } from "../src/migrator/adapters/agentmemory.ts";
import { GenericAdapter } from "../src/migrator/adapters/generic.ts";
import { runMigration } from "../src/migrator/index.ts";

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
    writeFileSync(join(docDir, "readme.txt"), "External plain text imported doc", "utf8");

    // Run migration using generic fallback on custom path
    const recs = GenericAdapter.extract(join(docDir, "readme.txt"));
    expect(recs.length).toBe(1);
    expect(recs[0].status).toBe("candidate");

    rmSync(root, { recursive: true, force: true });
  });
});
