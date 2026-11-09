import { expect, test } from "bun:test";
import { truncateText } from "./solution";
test("truncateText", () => {
  expect(truncateText("short", 10)).toBe("short");
  expect(truncateText("hello world", 8)).toBe("hello w…");
  expect(truncateText("abcdef", 1)).toBe("…");
  expect(truncateText("abcdef", 6)).toBe("abcdef");
  expect(truncateText("😀😀😀", 2)).toBe("😀…");
  expect(truncateText("hello world", 8).length).toBe(8);
});
