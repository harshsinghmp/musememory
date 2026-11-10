import { expect, test } from "bun:test";
import { compareSemver } from "./solution";
test("compareSemver", () => {
  expect(compareSemver("1.0.0", "1.0.1")).toBe(-1);
  expect(compareSemver("1.0.0-alpha", "1.0.0")).toBe(-1);
  expect(compareSemver("1.0.0", "1.0.0-alpha")).toBe(1);
  expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.2")).toBe(-1);
  expect(compareSemver("1.0.0-alpha.10", "1.0.0-alpha.2")).toBe(1);
  expect(compareSemver("1.0.0+build1", "1.0.0+build2")).toBe(0);
  expect(compareSemver("2.0.0", "10.0.0")).toBe(-1);
  expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
});
