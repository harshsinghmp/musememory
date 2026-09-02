import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, get, list } from "../src/store.ts";
import {
  recordObservation,
  listObservations,
  markObservationProcessed,
  recordNegativeLesson,
  distillObservationsToCandidates,
  evaluateSessionOutcomes,
} from "../src/learning/index.ts";
import { getAuditTrail } from "../src/audit.ts";

describe("R3 Autonomous Learning: Observations, Negative Lessons & Feedback", () => {
  let testDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "musememory-learning-test-"));
    memoryDir = join(testDir, ".memory");
    store = openStore(memoryDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("Observation Tier (observations.jsonl)", () => {
    it("records raw observations to .memory/observations.jsonl", () => {
      const obs = recordObservation(store, {
        source: "test",
        project: "aria",
        raw: "Error: ECONNREFUSED 127.0.0.1:5432 at TCPConnectWrap.afterConnect",
        summary: "Database connection failed during integration tests",
        metadata: { exitCode: 1, command: "bun test" },
      });

      expect(obs.id).toBeDefined();
      expect(obs.processed).toBe(false);

      const all = listObservations(store);
      expect(all.length).toBe(1);
      expect(all[0].id).toBe(obs.id);
      expect(all[0].raw).toContain("ECONNREFUSED");
    });

    it("refuses observations containing secrets", () => {
      expect(() => {
        const fakeToken = "ghp_" + "123456789012345678901234567890123456";
        recordObservation(store, {
          source: "tool",
          project: "aria",
          raw: `API response: { token: '${fakeToken}' }`,
        });
      }).toThrow(/Probable secret detected/);
    });

    it("marks observations as processed and links candidate ID", () => {
      const obs = recordObservation(store, {
        source: "build",
        project: "frontend",
        raw: "Module not found: Can't resolve './components/Navbar'",
      });

      expect(listObservations(store, { processed: false }).length).toBe(1);

      markObservationProcessed(store, obs.id, "m_candidate_123");

      expect(listObservations(store, { processed: false }).length).toBe(0);
      const processed = listObservations(store, { processed: true });
      expect(processed.length).toBe(1);
      expect(processed[0].extracted_candidate_id).toBe("m_candidate_123");
    });
  });

  describe("First-Class Negative Lessons (negative.ts)", () => {
    it("captures structured negative memories with timeless mode and high salience", () => {
      const negative = recordNegativeLesson(store, {
        project: "infra",
        title: "Docker Host Network in Production",
        failed_approach: "Using --network host in production container deployment",
        failure_reason: "Bypasses Docker port isolation and conflicts with host ingress ports",
        alternative_recommended: "Use user-defined overlay or bridge networks with explicit port mapping",
        evidence_snippet: "docker run -d --network host nginx:alpine",
        severity: "high",
        tags: ["docker", "networking"],
      });

      expect(negative.type).toBe("negative");
      expect(negative.temporal_mode).toBe("timeless");
      expect(negative.salience).toBe(0.85);
      expect(negative.title).toContain("AVOID:");
      expect(negative.content).toContain("Failed Approach / Anti-Pattern");
      expect(negative.content).toContain("Recommended Alternative");
      expect(negative.negative).toBeDefined();
      expect(negative.negative?.severity).toBe("high");

      // Verify in audit trail
      const audit = getAuditTrail(memoryDir, { operation: "negative_capture" });
      expect(audit.length).toBe(1);
      expect(audit[0].entry_id).toBe(negative.id);
    });
  });

  describe("Autonomous Distillation Pipeline (distill.ts)", () => {
    it("distills bug fixes, architecture conventions, and anti-patterns from raw observations", () => {
      // 1. Observation of an explicit anti-pattern
      recordObservation(store, {
        source: "review",
        project: "core",
        raw: "DO NOT USE eval() for JSON parsing. It caused regression and code injection risk in API handler.\nUse JSON.parse instead.",
        summary: "Avoid eval for json parsing",
      });

      // 2. Observation of a build error
      recordObservation(store, {
        source: "build",
        project: "core",
        raw: "TypeScript error TS2322: Type 'null' is not assignable to type 'string'. Fixed by adding null check.",
        summary: "Type error fixed with null check",
      });

      // 3. Observation of architecture setup
      recordObservation(store, {
        source: "file_edit",
        project: "core",
        raw: "Architecture: configured Vite with react-compiler plugin for automatic memoization.",
        summary: "Vite react-compiler setup",
      });

      const result = distillObservationsToCandidates(store, "core");

      expect(result.processedCount).toBe(3);
      expect(result.negativeLessons.length).toBe(1);
      expect(result.negativeLessons[0].type).toBe("negative");
      expect(result.negativeLessons[0].title).toContain("eval");

      expect(result.proposedCandidates.length).toBe(2);
      const fixCandidate = result.proposedCandidates.find((c) => c.type === "fix");
      const archCandidate = result.proposedCandidates.find((c) => c.type === "architecture");

      expect(fixCandidate).toBeDefined();
      expect(archCandidate).toBeDefined();

      // Verify that all observations are now marked processed
      expect(listObservations(store, { processed: false }).length).toBe(0);
    });
  });

  describe("Outcome Tracking & Feedback Loops (feedback.ts)", () => {
    it("reinforces retrieved memories upon successful session command exit", () => {
      const mem = propose(store, {
        title: "Jest Memory Leak Workaround",
        content: "Run jest with --runInBand and --logHeapUsage.",
        project: "ci",
        confirmed: true,
      });

      const outcome = evaluateSessionOutcomes(store, {
        project: "ci",
        retrievedMemoryIds: [mem.id],
        exitCode: 0,
        command: "bun test",
      });

      expect(outcome.updatedMemories.length).toBe(1);
      const updated = get(store, mem.id)!;
      expect(updated.utility?.successful_applications).toBe(1);
      expect(updated.utility?.application_count).toBe(1);
      expect(updated.reinforcement).toBe(1);
      expect(outcome.observationRecorded).toBe(false);
    });

    it("penalizes memories and records raw failure observation upon failed session command", () => {
      const mem = propose(store, {
        title: "Flaky Test Bypass",
        content: "Increase timeout to 30000ms.",
        project: "ci",
        confirmed: true,
      });

      const outcome = evaluateSessionOutcomes(store, {
        project: "ci",
        retrievedMemoryIds: [mem.id],
        exitCode: 1,
        command: "bun test",
        logs: "FAIL test/e2e.test.ts: Timed out after 30000ms",
      });

      expect(outcome.updatedMemories.length).toBe(1);
      const updated = get(store, mem.id)!;
      expect(updated.utility?.regressions).toBe(1);
      expect(updated.utility?.failed_applications).toBe(1);
      expect(outcome.observationRecorded).toBe(true);

      // Observation was recorded to .memory/observations.jsonl
      const obs = listObservations(store, { processed: false });
      expect(obs.length).toBe(1);
      expect(obs[0].raw).toContain("Timed out after 30000ms");
    });
  });
});
