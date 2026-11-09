import { expect, test } from "bun:test";
import { formatMoney } from "./solution";
test("formatMoney", () => {
  expect(formatMoney(123456)).toBe("$1,234.56");
  expect(formatMoney(0)).toBe("$0.00");
  expect(formatMoney(5)).toBe("$0.05");
  expect(formatMoney(1234)).toBe("$12.34");
  expect(formatMoney(-123456)).toBe("-$1,234.56");
  expect(formatMoney(-5)).toBe("-$0.05");
  expect(formatMoney(123456789)).toBe("$1,234,567.89");
});
