import { describe, test, expect } from "bun:test";
import { checkTestClaims } from "../scripts/lib/claims-compare.ts";

const actual = { count: 1867, assertions: 10432, files: 280 };

describe("claims test-count comparison", () => {
  test("an exact match is clean", () => {
    const result = checkTestClaims(actual, actual);
    expect(result.stale).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  test("an under-claimed test count fails (the 3.4.6 regression)", () => {
    const result = checkTestClaims({ ...actual, count: 1826 }, actual);
    expect(result.stale).toBe(true);
    expect(result.errors[0]).toContain("1826 tests");
    expect(result.errors[0]).toContain("1867");
  });

  test("an over-claimed test count fails", () => {
    const result = checkTestClaims({ ...actual, count: 1900 }, actual);
    expect(result.stale).toBe(true);
  });

  test("a file-count mismatch fails in either direction", () => {
    expect(checkTestClaims({ ...actual, files: 279 }, actual).stale).toBe(true);
    expect(checkTestClaims({ ...actual, files: 281 }, actual).stale).toBe(true);
  });

  test("an over-claimed assertion total fails", () => {
    const result = checkTestClaims({ ...actual, assertions: 10433 }, actual);
    expect(result.stale).toBe(true);
  });

  test("an under-claimed assertion total is a note, not a failure", () => {
    const result = checkTestClaims({ ...actual, assertions: 10430 }, actual);
    expect(result.stale).toBe(false);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain("10430");
  });
});
