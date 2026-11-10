import { expect, test } from "bun:test";
import { formatPercent } from "./solution";
test("formatPercent", () => {
  expect(formatPercent(0.5)).toBe("50%");
  expect(formatPercent(0.125)).toBe("12.5%");
  expect(formatPercent(1)).toBe("100%");
  expect(formatPercent(0)).toBe("0%");
  expect(formatPercent(0.333)).toBe("33.3%");
  expect(formatPercent(-0.25)).toBe("-25%");
  expect(formatPercent(1).includes(".0")).toBe(false);
});
