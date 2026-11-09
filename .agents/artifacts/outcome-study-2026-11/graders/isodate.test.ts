import { expect, test } from "bun:test";
import { toIsoDate } from "./solution";
test("toIsoDate", () => {
  expect(toIsoDate(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))).toBe("2026-01-01");
  expect(toIsoDate(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)))).toBe("2026-12-31");
  expect(toIsoDate(new Date(Date.UTC(2026, 2, 5, 12, 0, 0)))).toBe("2026-03-05");
});
