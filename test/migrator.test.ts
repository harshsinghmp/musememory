import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, list } from "../src/store.ts";
import { getCurrent } from "../src/current.ts";
import { getAuditTrail } from "../src/audit.ts";
import { detectProviders, runMigration } from "../src/migrator/index.ts";
import { AgentMemoryAdapter } from "../src/migrator/adapters/agentmemory.ts";
import { BeadsAdapter } from "../src/migrator/adapters/beads.ts";
import { LettaAdapter } from "../src/migrator/adapters/letta.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "migrator-test-"));
}

describe("universal memory migrator & auto-detection", () => {
  test("detectProviders discovers active providers in local workspace", () => {
    const root = temp();
    mkdirSync(join(root, ".beads"), { recursive: true });
    writeFileSync(join(root, ".beads", "beads.json"), JSON.stringify([]), "utf8");

    const detected = detectProviders(root);
    const beads = detected.find((d) => d.id === "beads");
    expect(beads).toBeDefined();
    expect(beads?.detected).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });

  test("AgentMemoryAdapter extracts memories and preserves active vs superseded states", () => {
    const root = temp();
    const jsonPath = join(root, "standalone.json");
    writeFileSync(
      jsonPath,
      JSON.stringify({
        "mem:memories": {
          "m_1": {
            id: "mem_1",
            type: "fact",
            title: "Database Architecture",
            content: "Using SQLite WAL mode with 64KB page size.",
            isLatest: true,
            createdAt: "2026-08-01T00:00:00Z",
          },
          "m_2": {
            id: "mem_2",
            type: "decision",
            title: "Legacy Caching Engine",
            content: "Old in-memory cache replaced by Redis cluster.",
            isLatest: false,
            createdAt: "2026-07-01T00:00:00Z",
          },
        },
      }),
      "utf8"
    );

    const records = AgentMemoryAdapter.extract(jsonPath, { defaultProject: "my-proj" });
    expect(records.length).toBe(2);

    const active = records.find((r) => r.title === "Database Architecture");
    expect(active?.status).toBe("confirmed");
    expect(active?.type).toBe("discovery");

    const superseded = records.find((r) => r.title === "Legacy Caching Engine");
    expect(superseded?.status).toBe("superseded");
    expect(superseded?.type).toBe("decision");

    rmSync(root, { recursive: true, force: true });
  });

  test("BeadsAdapter maps open tasks to confirmed/constraint and closed tasks to superseded", () => {
    const root = temp();
    const beadsPath = join(root, "beads.json");
    writeFileSync(
      beadsPath,
      JSON.stringify([
        {
          id: "bead-101",
          title: "Implement OAuth Refresh Flow",
          description: "Must handle 401 error and retry with refreshed bearer token.",
          status: "in_progress",
          priority: "high",
        },
        {
          id: "bead-102",
          title: "Deprecated Basic Auth Setup",
          description: "Basic authentication endpoint removed.",
          status: "closed",
        },
      ]),
      "utf8"
    );

    const records = BeadsAdapter.extract(beadsPath, { defaultProject: "auth" });
    expect(records.length).toBe(2);

    const active = records.find((r) => r.title.includes("OAuth"));
    expect(active?.status).toBe("confirmed");
    expect(active?.isConstraint).toBe(true);

    const closed = records.find((r) => r.title.includes("Basic Auth"));
    expect(closed?.status).toBe("superseded");

    rmSync(root, { recursive: true, force: true });
  });

  test("LettaAdapter routes core memory (human/persona) to constraints", () => {
    const root = temp();
    const lettaPath = join(root, "letta_agent.json");
    writeFileSync(
      lettaPath,
      JSON.stringify({
        memory: {
          human: "Principal: Lead Architect & Developer.",
          persona: "AI Assistant: Autonomous Coding Agent.",
        },
        archival_memory: [
          "Archival fact 1: SQLite WAL mode enabled for zero-lock concurrency.",
        ],
      }),
      "utf8"
    );

    const recs = LettaAdapter.extract(lettaPath);
    expect(recs.length).toBe(3);

    const constraints = recs.filter((r) => r.isConstraint);
    expect(constraints.length).toBe(2);
    expect(constraints.some((c) => c.title.includes("Human"))).toBe(true);
    expect(constraints.some((c) => c.title.includes("Persona"))).toBe(true);

    const archival = recs.find((r) => !r.isConstraint);
    expect(archival?.status).toBe("confirmed");

    rmSync(root, { recursive: true, force: true });
  });

  test("runMigration integrates all components, redacts secrets, and seeds CURRENT.md", async () => {
    const root = temp();
    const memoryDir = join(root, ".memory");
    const store = openStore(memoryDir);

    // Setup dummy provider file in root with a secret
    const beadsDir = join(root, ".beads");
    mkdirSync(beadsDir, { recursive: true });
    writeFileSync(
      join(beadsDir, "beads.json"),
      JSON.stringify([
        {
          id: "b1",
          title: "API Secret Configuration",
          description: "Use api key sk-proj-1234567890abcdef1234567890 for provider.",
          status: "in_progress",
          priority: "high",
        },
        {
          id: "b2",
          title: "Production Database Strategy",
          description: "Postgres connection pooling with 20 max connections.",
          status: "open",
        },
        {
          id: "b3",
          title: "Legacy Monolith Architecture",
          description: "Deprecated PHP monolith architecture.",
          status: "closed",
        },
      ]),
      "utf8"
    );

    // 1. Dry run
    const dryReport = await runMigration(store, memoryDir, { provider: "beads", dryRun: true });
    expect(dryReport.dryRun).toBe(true);
    expect(dryReport.totalMigrated).toBe(2);
    expect(dryReport.totalConstraints).toBe(1);
    expect(dryReport.totalSecretsRedacted).toBe(1);
    expect(list(store).length).toBe(0);

    // 2. Real Migration
    const report = await runMigration(store, memoryDir, { provider: "beads", dryRun: false });
    expect(report.totalMigrated).toBe(2);
    expect(report.totalSuperseded).toBe(1);
    expect(report.totalConstraints).toBe(1);
    expect(report.totalSecretsRedacted).toBe(1);

    // Verify memories in store
    const memories = list(store);
    expect(memories.length).toBe(2);

    const activeMem = memories.find((m) => m.title.includes("Database Strategy"));
    expect(activeMem?.status).toBe("confirmed");

    const supersededMem = memories.find((m) => m.title.includes("Legacy Monolith"));
    expect(supersededMem?.status).toBe("superseded");

    // Verify CURRENT.md constraints seeded with redacted secret
    const currentLines = getCurrent(memoryDir);
    expect(currentLines.length).toBeGreaterThan(0);
    const constraintLine = currentLines.find((l) => l.includes("API Secret Configuration"));
    expect(constraintLine).toBeDefined();
    expect(constraintLine).toContain("[REDACTED_SECRET]");
    expect(constraintLine).not.toContain("sk-proj-1234567890abcdef1234567890");

    // Verify audit event recorded
    const auditTrail = getAuditTrail(memoryDir);
    expect(auditTrail.length).toBeGreaterThanOrEqual(1);
    expect(auditTrail[0].operation).toBe("import");
    expect(auditTrail[0].actor).toBe("migrator");

    rmSync(root, { recursive: true, force: true });
  });
});
