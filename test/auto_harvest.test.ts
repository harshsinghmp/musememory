import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { openStore, list } from "../src/store.ts";
import {
  discoverAgentTranscripts,
  harvestAllAgentTranscripts,
  getHarvestedTranscriptLedger,
} from "../src/harvester.ts";
import { extractHarvestUnits } from "../src/harvest.ts";

describe("Universal Agent Transcript Harvester & Auto-Learner Engine", () => {
  const testDir = join(process.cwd(), ".tmp-test-harvester");
  const memoryDir = join(testDir, ".memory");

  beforeEach(() => {
    mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it("extracts natural language fixes and decisions without strict markdown headers", () => {
    const rawTranscript = `
User: We are getting an authentication error when connecting to PostgreSQL.
Assistant: I investigated the issue. We resolved the PostgreSQL connection error by configuring SSL mode to require and increasing connection timeout to 10s.
Decision: We decided to use connection pooling via pg-pool to prevent socket exhaustion.
Hard rule: You must never commit plaintext database credentials to git.
User: That worked perfectly!
`;

    const units = extractHarvestUnits(rawTranscript);
    expect(units.length).toBeGreaterThanOrEqual(3);

    const types = units.map((u) => u.type);
    expect(types).toContain("fix");
    expect(types).toContain("decision");
    expect(types).toContain("constraint");
  });

  it("discovers agent transcripts in mock platform directories", () => {
    const mockBrainDir = join(testDir, "mock-agent", "brain", "session-1", "logs");
    mkdirSync(mockBrainDir, { recursive: true });
    const transcriptFile = join(mockBrainDir, "transcript.jsonl");

    writeFileSync(
      transcriptFile,
      JSON.stringify({ content: "Fix: resolved CORS header issue by adding Access-Control-Allow-Origin" }) + "\n",
      "utf8",
    );

    const discovered = discoverAgentTranscripts({ searchRoots: [testDir] });
    expect(discovered).toContain(transcriptFile);
  });

  it("harvests discovered transcripts and stores distilled memories in SQLite and YAML", () => {
    const store = openStore(memoryDir);
    const mockLogDir = join(testDir, "agent-logs");
    mkdirSync(mockLogDir, { recursive: true });
    const transcriptFile = join(mockLogDir, "session.jsonl");

    writeFileSync(
      transcriptFile,
      JSON.stringify({ content: "User: Why is build failing?" }) + "\n" +
      JSON.stringify({ content: "Fix: updated tsconfig.json to enable moduleResolution bundler" }) + "\n" +
      JSON.stringify({ content: "Decision: standardize on Bun test runner for all unit tests" }) + "\n",
      "utf8",
    );

    const result = harvestAllAgentTranscripts(store, {
      searchRoots: [testDir],
      memoryDir,
      confirmed: true,
    });

    expect(result.harvestedFilesCount).toBe(1);
    expect(result.memoriesImported).toBeGreaterThanOrEqual(2);

    // Verify persistence in SQLite store
    const entries = list(store);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.some((e) => e.title.includes("tsconfig") || e.content.includes("tsconfig"))).toBe(true);

    // Verify ledger prevents duplicate re-harvesting
    const secondPass = harvestAllAgentTranscripts(store, {
      searchRoots: [testDir],
      memoryDir,
    });
    expect(secondPass.harvestedFilesCount).toBe(0);
    expect(secondPass.memoriesImported).toBe(0);
  });
});
