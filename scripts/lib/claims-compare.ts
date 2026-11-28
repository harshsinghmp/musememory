/**
 * Comparison rules for `claims.json --check`.
 *
 * The suite is measured, not declared, so the comparison has to distinguish
 * "the manifest is stale" from "the assertion total wobbles between runs".
 * Test and file counts are structural: any difference means the manifest no
 * longer describes the suite. Assertion totals vary by a run (±4 observed), so
 * they are reported as a note and never fail the gate — a non-deterministic
 * number cannot be a release gate.
 *
 * Why any count mismatch is now an error: 3.4.6 merged a PR whose
 * `claims.json` had been generated on a conflicted tree (1826 vs 1867) and
 * CI stayed green because the old rule only rejected over-claiming. The
 * README badge then advertised a number that was never true.
 */

export interface TestCounts {
  count: number;
  assertions: number;
  files: number;
}

export interface ClaimCheckResult {
  stale: boolean;
  errors: string[];
  notes: string[];
}

export function checkTestClaims(published: TestCounts, actual: TestCounts): ClaimCheckResult {
  const errors: string[] = [];
  const notes: string[] = [];

  if (published.count !== actual.count) {
    errors.push(
      `claims.json publishes ${published.count} tests but the suite contains ${actual.count}`,
    );
  }
  if (published.files !== actual.files) {
    errors.push(
      `claims.json publishes ${published.files} test files but the suite contains ${actual.files}`,
    );
  }
  if (published.assertions !== actual.assertions) {
    // The assertion total is not stable across runs — Bun's own count moves by
    // a few depending on which conditional assertions execute. It is published
    // for information, never as a gate: 3.5.1's staging failed because a run
    // made four more than the recorded figure. Count and files are structural
    // and carry the signal.
    notes.push(
      `claims.json reports ${published.assertions} assertions; this run made ${actual.assertions}.`,
    );
  }

  return { stale: errors.length > 0, errors, notes };
}
