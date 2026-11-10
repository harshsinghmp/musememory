import { expect, test } from "bun:test";
import { cloneValue } from "./solution";
test("cloneValue", () => {
  const d = new Date(1700000000000);
  const cd = cloneValue(d);
  expect(cd).toBeInstanceOf(Date);
  expect(cd.getTime()).toBe(d.getTime());
  expect(cd).not.toBe(d);

  const m = new Map<string, number>([["a", 1]]);
  const cm = cloneValue(m);
  expect(cm).toBeInstanceOf(Map);
  expect(cm.get("a")).toBe(1);
  expect(cm).not.toBe(m);

  const s = new Set([1, 2]);
  const cs = cloneValue(s);
  expect(cs).toBeInstanceOf(Set);
  expect(cs.has(2)).toBe(true);

  const obj = { a: { b: [1, 2] }, n: null as null | number };
  const co = cloneValue(obj);
  expect(co).toEqual(obj);
  co.a.b.push(3);
  expect(obj.a.b.length).toBe(2);
});
