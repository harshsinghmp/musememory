import { describe, expect, it } from "bun:test";
import { verifyMutationSafety, MutationSafetyError } from "../src/quality/guards.ts";

describe("verifyMutationSafety (T-050 / T-324)", () => {
  it("allows safe modifications and additions", () => {
    expect(() => verifyMutationSafety(10, 12, 3)).not.toThrow();
    expect(() => verifyMutationSafety(10, 10, 1)).not.toThrow();
    expect(() => verifyMutationSafety(10, 9, 1)).not.toThrow();
    expect(() => verifyMutationSafety(2, 2, 0)).not.toThrow();
  });

  it("throws ESUSPECT_SHRINK when dropping below floor without bypass", () => {
    expect(() => verifyMutationSafety(5, 2, 0)).toThrow(MutationSafetyError);
    try {
      verifyMutationSafety(5, 2, 0);
    } catch (err) {
      expect(err).toBeInstanceOf(MutationSafetyError);
      expect((err as MutationSafetyError).code).toBe("ESUSPECT_SHRINK");
    }
  });

  it("throws ESUSPECT_SHRINK when dropping >50% entries with zero additions", () => {
    expect(() => verifyMutationSafety(20, 9, 0)).toThrow(MutationSafetyError);
  });

  it("throws ESUSPECT_EROSION when net-dropping 2 or more entries with zero additions", () => {
    expect(() => verifyMutationSafety(10, 8, 0)).toThrow(MutationSafetyError);
    try {
      verifyMutationSafety(10, 8, 0);
    } catch (err) {
      expect(err).toBeInstanceOf(MutationSafetyError);
      expect((err as MutationSafetyError).code).toBe("ESUSPECT_EROSION");
    }
  });

  it("permits 1-entry drop with zero additions without error", () => {
    expect(() => verifyMutationSafety(10, 9, 0)).not.toThrow();
  });

  it("bypasses all checks when allowDrastic is true", () => {
    expect(() => verifyMutationSafety(20, 1, 0, { allowDrastic: true })).not.toThrow();
    expect(() => verifyMutationSafety(5, 1, 0, { allowDrastic: true })).not.toThrow();
  });
});
