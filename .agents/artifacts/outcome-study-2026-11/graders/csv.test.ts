import { expect, test } from "bun:test";
import { csvField } from "./solution";
test("csvField", () => {
  expect(csvField("abc")).toBe("abc");
  expect(csvField("")).toBe("");
  expect(csvField("a,b")).toBe('"a,b"');
  expect(csvField('he said "hi"')).toBe('"he said ""hi"""');
  expect(csvField("line\nbreak")).toBe('"line\nbreak"');
  expect(csvField(" padded ")).toBe('" padded "');
  expect(csvField('a"b')).toBe('"a""b"');
});
