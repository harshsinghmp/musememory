/**
 * Comparison rules for `claims.json --check`.
 *
 * The suite is measured, not declared, so the comparison has to distinguish
 * "the manifest is stale" from "the assertion total wobbles between runs".
 * Test and file counts are structural: any difference means the manifest no
 * longer describes the suite. Assertion totals vary by a run (±2 JUnit
 * artefacts), so only over-claiming is an error there; an under-claim is a
 * precision note.
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
  if (published.assertions > actual.assertions) {
    errors.push(
      `claims.json publishes ${published.assertions} assertions but the suite makes ${actual.assertions}`,
    );
  } else if (published.assertions < actual.assertions) {
    notes.push(
      `claims.json reports ${published.assertions} assertions; the suite now makes ${actual.assertions}. ` +
        `Run "bun run claims:generate" to publish the exact figure.`,
    );
  }

  return { stale: errors.length > 0, errors, notes };
}
