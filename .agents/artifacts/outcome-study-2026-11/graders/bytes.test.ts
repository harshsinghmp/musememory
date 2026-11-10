import { expect, test } from "bun:test";
import { formatBytes } from "./solution";
test("formatBytes", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1024)).toBe("1.0 KiB");
  expect(formatBytes(1536)).toBe("1.5 KiB");
  expect(formatBytes(1048576)).toBe("1.0 MiB");
  expect(formatBytes(1073741824)).toBe("1.0 GiB");
  expect(formatBytes(1500000)).toBe("1.4 MiB");
  expect(formatBytes(1023)).toBe("1023 B");
});
