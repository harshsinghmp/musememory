import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, list } from "../src/store.ts";
import {
  recordObservation,
  listObservations,
  markObservationProcessed,
  observationsFilePath,
  rotateObservationsIfNeeded,
  MAX_OBSERVATIONS_FILE_BYTES,
} from "../src/learning/observation.ts";
import {
  distillObservationsToCandidates,
  capDistillationBody,
  MAX_DISTILLATION_BODY_CHARS,
} from "../src/learning/distill.ts";

describe("Wave 4 - Task 1: Observation Hardening & Distillation Protection", () => {
  let testDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "musememory-wave4-obs-test-"));
    memoryDir = join(testDir, ".memory");
    store = openStore(memoryDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("T-305: Distillation body cap", () => {
    test("capDistillationBody preserves small text without truncation", () => {
      const shortText = "Fixed null reference in user profile handler.";
      expect(capDistillationBody(shortText, 500)).toBe(shortText);
    });

    test("capDistillationBody truncates oversized text and attaches truncation notice", () => {
      const hugeLog = "A".repeat(3000);
      const capped = capDistillationBody(hugeLog, 1000);
      expect(capped.length).toBeLessThan(1200);
      expect(capped).toContain("[truncated 2000 characters from raw observation]");
    });

    test("distillObservationsToCandidates caps body of fix and architecture candidates", () => {
      const massiveLog = [
        "Error: database connection timeout during connection pool acquisition.",
        "Resolved by configuring pool min 2 max 10 and keepalive 30000ms.",
        ...Array.from({ length: 100 }, (_, i) => `at Module.queryWorker${i} (src/db/worker${i}.ts:${i * 10}:15) with query payload id=${i}`),
      ].join("\n");
      
      recordObservation(store, {
        source: "test",
        project: "core",
        raw: massiveLog,
        summary: "Database connection timeout fix",
      });

      const result = distillObservationsToCandidates(store, "core", { maxBodyChars: 800 });
      expect(result.proposedCandidates.length).toBe(1);
      const fixCandidate = result.proposedCandidates[0];
      expect(fixCandidate.content.length).toBeLessThan(1000);
      expect(fixCandidate.content).toContain("[truncated");
    });

    test("distillObservationsToCandidates caps negative lesson bodies", () => {
      const massiveAntiPattern = [
        "DO NOT USE raw sql concatenation in repository query builder.",
        "Caused SQL injection vulnerability and broke prepared statement caching.",
        ...Array.from({ length: 80 }, (_, i) => `Vulnerability trace in controllerHandler${i} handling request${i} from endpoint /api/user/${i}`),
      ].join("\n");

      recordObservation(store, {
        source: "review",
        project: "core",
        raw: massiveAntiPattern,
        summary: "Avoid raw sql concatenation",
      });

      const result = distillObservationsToCandidates(store, "core", { maxBodyChars: 600 });
      expect(result.negativeLessons.length).toBe(1);
      const neg = result.negativeLessons[0];
      expect(neg.negative?.failure_reason.length).toBeLessThan(750);
      expect(neg.content).toContain("[truncated");
    });
  });

  describe("T-306: Observation log atomic rotation and size cap", () => {
    test("markObservationProcessed writes atomically without leaving corrupt temp files", () => {
      const obs = recordObservation(store, {
        source: "tool",
        project: "test",
        raw: "sample observation",
        summary: "sample",
      });

      const marked = markObservationProcessed(store, obs.id, "cand-123");
      expect(marked).toBe(true);

      const filePath = observationsFilePath(memoryDir);
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf8");
      expect(content).toContain("cand-123");
      expect(content).toContain('"processed":true');
    });

    test("rotates observations log when file exceeds size cap while preserving unprocessed items", () => {
      const filePath = observationsFilePath(memoryDir);

      // Record several processed items and one unprocessed item with large payloads
      for (let i = 0; i < 20; i++) {
        const obs = recordObservation(store, {
          source: "test",
          project: "test",
          raw: `Processed item ${i}: ` + "X".repeat(500),
          summary: `Summary ${i}`,
        });
        markObservationProcessed(store, obs.id);
      }

      const unreadObs = recordObservation(store, {
        source: "test",
        project: "test",
        raw: "MUST KEEP UNPROCESSED: " + "Y".repeat(200),
        summary: "Important unread item",
      });

      // Force rotation with a small threshold (e.g. 2000 bytes)
      rotateObservationsIfNeeded(memoryDir, 2000);

      const rotatedPath = join(memoryDir, "observations.1.jsonl");
      expect(existsSync(rotatedPath)).toBe(true);

      // Current active observations should still contain the unprocessed observation
      const activeUnprocessed = listObservations(store, { processed: false });
      expect(activeUnprocessed.length).toBe(1);
      expect(activeUnprocessed[0].id).toBe(unreadObs.id);

      // Active file size should be reduced
      const activeSize = statSync(filePath).size;
      expect(activeSize).toBeLessThan(2000);
    });
  });
});
