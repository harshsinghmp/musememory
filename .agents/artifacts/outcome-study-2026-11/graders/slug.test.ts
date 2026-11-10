import { expect, test } from "bun:test";
import { slugify } from "./solution";
test("slugify", () => {
  expect(slugify("Héllo, World!")).toBe("hello-world");
  expect(slugify("  A  B  ")).toBe("a-b");
  expect(slugify("foo_bar")).toBe("foo-bar");
  expect(slugify("Café Déjà Vu")).toBe("cafe-deja-vu");
  expect(slugify("---")).toBe("");
  const long = slugify("a".repeat(80));
  expect(long.length).toBe(60);
  expect(long.endsWith("-")).toBe(false);
});
