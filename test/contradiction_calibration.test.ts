import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, list } from "../src/store.ts";
import {
  detectConflict,
  scanPotentialConflicts,
  MIN_CONFLICT_CONFIDENCE,
} from "../src/quality/contradiction.ts";
import { extractPolarityClaims } from "../src/quality/polarity.ts";
import { scopesAreCompatible, extractTrailingScope } from "../src/quality/scope.ts";
import calibration from "./calibration/contradiction_calibration.json";

interface CalibrationCase {
  id: string;
  expect: "conflict" | "no_conflict";
  note?: string;
  a: { title: string; content: string };
  b: { title: string; content: string };
}

const CASES = (calibration as { cases: CalibrationCase[] }).cases;

describe("T-320: contradiction engine calibration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "t320-contradiction-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("fixture is well-formed", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
    for (const testCase of CASES) {
      expect(typeof testCase.id).toBe("string");
      expect(["conflict", "no_conflict"]).toContain(testCase.expect);
      expect(testCase.a.title.length).toBeGreaterThan(0);
      expect(testCase.b.title.length).toBeGreaterThan(0);
    }
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every labelled pair reaches the expected verdict", () => {
    const store = openStore(dir);
    const failures: string[] = [];

    for (const testCase of CASES) {
      // Each case runs in its own project so that cases cannot interfere with
      // one another through the shared store.
      const project = `calibration-${testCase.id}`;
      propose(store, {
        title: testCase.a.title,
        content: testCase.a.content,
        type: "operation",
        project,
        confirmed: true,
      });
      const detection = detectConflict(store, {
        title: testCase.b.title,
        content: testCase.b.content,
        type: "operation",
        project,
        id: `candidate-${testCase.id}`,
      });

      const actual = detection.conflicted ? "conflict" : "no_conflict";
      if (actual !== testCase.expect) {
        failures.push(
          `${testCase.id}: expected ${testCase.expect}, got ${actual}` +
            (detection.reason ? ` (${detection.reason})` : ""),
        );
      }
    }

    expect(failures).toEqual([]);
  });

  test("precision and recall clear the calibration gate", () => {
    const store = openStore(dir);
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;

    for (const testCase of CASES) {
      const project = `calibration-${testCase.id}`;
      propose(store, {
        title: testCase.a.title,
        content: testCase.a.content,
        type: "operation",
        project,
        confirmed: true,
      });
      const detection = detectConflict(store, {
        title: testCase.b.title,
        content: testCase.b.content,
        type: "operation",
        project,
        id: `candidate-${testCase.id}`,
      });

      if (testCase.expect === "conflict") {
        if (detection.conflicted) truePositives++;
        else falseNegatives++;
      } else {
        if (detection.conflicted) falsePositives++;
      }
    }

    const precision = truePositives / (truePositives + falsePositives);
    const recall = truePositives / (truePositives + falseNegatives);

    // A false positive poisons two memories (25 health points each, removed
    // from every future sync broadcast), so precision is held to a high bar.
    expect(precision).toBeGreaterThanOrEqual(0.9);
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });

  test("detected conflicts always clear the minimum confidence bar", () => {
    const store = openStore(dir);
    propose(store, {
      title: "The wiki recompile gate is enabled",
      content: "The wiki recompile gate is enabled so the wiki stays in sync.",
      type: "operation",
      project: "calibration",
      confirmed: true,
    });
    const detection = detectConflict(store, {
      title: "The wiki recompile gate is disabled",
      content: "The wiki recompile gate is disabled to avoid rewriting on every save.",
      type: "operation",
      project: "calibration",
      id: "candidate-confidence",
    });
    expect(detection.conflicted).toBe(true);
    expect(detection.confidence).toBeGreaterThanOrEqual(MIN_CONFLICT_CONFIDENCE);
  });

  test("dry-run detection reports without mutating the store", () => {
    const store = openStore(dir);
    const entry = propose(store, {
      title: "The wiki recompile gate is enabled",
      content: "The wiki recompile gate is enabled so the wiki stays in sync.",
      type: "operation",
      project: "calibration",
      confirmed: true,
    });

    const detection = detectConflict(
      store,
      {
        title: "The wiki recompile gate is disabled",
        content: "The wiki recompile gate is disabled to avoid rewriting on every save.",
        type: "operation",
        project: "calibration",
        id: "candidate-dry-run",
      },
      { dryRun: true },
    );

    expect(detection.conflicted).toBe(true);
    expect(detection.dryRun).toBe(true);

    // Nothing was flagged: the existing memory is untouched.
    const stored = list(store, { project: "calibration" }).find((e) => e.id === entry.id);
    expect(stored?.status).toBe("confirmed");
    expect(stored?.conflict_ids ?? []).toEqual([]);
  });

  test("propose with conflictDryRun audits the detection but does not flag", () => {
    const store = openStore(dir);
    propose(store, {
      title: "The wiki recompile gate is enabled",
      content: "The wiki recompile gate is enabled so the wiki stays in sync.",
      type: "operation",
      project: "calibration",
      confirmed: true,
    });

    const candidate = propose(store, {
      title: "The wiki recompile gate is disabled",
      content: "The wiki recompile gate is disabled to avoid rewriting on every save.",
      type: "operation",
      project: "calibration",
      checkConflict: true,
      conflictDryRun: true,
    });

    expect(candidate.status).toBe("candidate");
    expect(candidate.quality).not.toBe("CONFLICTED");

    const all = list(store, { project: "calibration" });
    expect(all.every((e) => e.status !== "conflicted")).toBe(true);
  });

  test("propose with checkConflict flags both sides of a genuine contradiction", () => {
    const store = openStore(dir);
    propose(store, {
      title: "The wiki recompile gate is enabled",
      content: "The wiki recompile gate is enabled so the wiki stays in sync.",
      type: "operation",
      project: "calibration",
      confirmed: true,
    });

    const candidate = propose(store, {
      title: "The wiki recompile gate is disabled",
      content: "The wiki recompile gate is disabled to avoid rewriting on every save.",
      type: "operation",
      project: "calibration",
      checkConflict: true,
    });

    expect(candidate.status).toBe("conflicted");
    expect(candidate.quality).toBe("CONFLICTED");
    expect(candidate.conflict_ids?.length).toBe(1);
  });

  test("scanPotentialConflicts finds a pair without flagging it", () => {
    const store = openStore(dir);
    propose(store, {
      title: "The wiki recompile gate is enabled",
      content: "The wiki recompile gate is enabled so the wiki stays in sync.",
      type: "operation",
      project: "calibration",
      confirmed: true,
    });
    propose(store, {
      title: "The wiki recompile gate is disabled",
      content: "The wiki recompile gate is disabled to avoid rewriting on every save.",
      type: "operation",
      project: "calibration",
      confirmed: true,
    });

    const found = scanPotentialConflicts(store, { project: "calibration" });
    expect(found.length).toBe(1);
    expect(found[0].confidence).toBeGreaterThanOrEqual(MIN_CONFLICT_CONFIDENCE);

    // The scan is read-only.
    const all = list(store, { project: "calibration" });
    expect(all.every((e) => e.status !== "conflicted")).toBe(true);
  });
});

describe("T-320: scope extraction", () => {
  test("extracts trailing qualifiers", () => {
    expect(extractTrailingScope("is enabled in production", "is enabled".length)).toBe("production");
    expect(extractTrailingScope("is disabled on localhost", "is disabled".length)).toBe("local");
    expect(extractTrailingScope("is enabled at tier 2", "is enabled".length)).toBe("tier 2");
    expect(extractTrailingScope("is enabled for legacy stores", "is enabled".length)).toBe("legacy stores");
    expect(extractTrailingScope("is enabled by default", "is enabled".length)).toBe("default");
    expect(extractTrailingScope("has no qualifier here", "has no qualifier".length)).toBeUndefined();
  });

  test("scope compatibility distinguishes distinct contexts", () => {
    expect(scopesAreCompatible(undefined, undefined)).toBe(true);
    expect(scopesAreCompatible("production", "production")).toBe(true);
    expect(scopesAreCompatible("production", "localhost")).toBe(false);
    expect(scopesAreCompatible("production", undefined)).toBe(false);
  });
});

describe("T-320: polarity claim extraction", () => {
  test("anchors status claims to their subject", () => {
    const claims = extractPolarityClaims("Postgres connection pooling is enabled in production");
    const status = claims.find((c) => c.relation === "status");
    expect(status).toBeDefined();
    expect(status?.target).toBe("enabled");
    expect(status?.scope).toBe("production");
    expect(status?.entity).toContain("pooling");
  });

  test("binds verbal status claims to their object", () => {
    const claims = extractPolarityClaims("The build enables the wiki recompile gate by default");
    const status = claims.find((c) => c.relation === "status");
    expect(status?.target).toBe("enabled");
    expect(status?.entity).toBe("wiki recompile gate");
    expect(status?.scope).toBe("default");
  });

  test("drops claims that cannot be bound to a subject", () => {
    const claims = extractPolarityClaims("Enabled.");
    expect(claims.filter((c) => c.relation === "status")).toHaveLength(0);
  });

  test("does not treat a migration mention as a current-state claim", () => {
    const claims = extractPolarityClaims("Migrated from MySQL to PostgreSQL during the v3 rewrite");
    expect(claims.filter((c) => c.relation === "database")).toHaveLength(0);
  });
});
