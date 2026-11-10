import { expect, test } from "bun:test";
import { parseDuration } from "./solution";
test("parseDuration", () => {
  expect(parseDuration("500ms")).toBe(0.5);
  expect(parseDuration("30s")).toBe(30);
  expect(parseDuration("5m")).toBe(300);
  expect(parseDuration("2h")).toBe(7200);
  expect(parseDuration("45")).toBe(45);
  expect(parseDuration("1.5h")).toBe(5400);
  expect(parseDuration("10S")).toBe(10);
  expect(() => parseDuration("banana")).toThrow();
});
