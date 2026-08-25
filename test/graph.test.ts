import { describe, test, expect } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectProvider, getGraphStatus } from "../src/graph.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

describe("graph integration adapter", () => {
  test("detects none when no graph directory exists", () => {
    const { root } = setupFixtureRoot();
    expect(detectProvider(root)).toBe("none");
    const status = getGraphStatus(root);
    expect(status.provider).toBe("none");
    expect(status.available).toBe(false);
    cleanup(root);
  });

  test("detects codegraph when .codegraph exists", () => {
    const { root } = setupFixtureRoot();
    const codegraphDir = join(root, ".codegraph");
    mkdirSync(codegraphDir, { recursive: true });
    writeFileSync(join(codegraphDir, "meta.json"), JSON.stringify({ revision: "rev-123" }));

    expect(detectProvider(root)).toBe("codegraph");
    const status = getGraphStatus(root);
    expect(status.provider).toBe("codegraph");
    expect(status.available).toBe(true);
    expect(status.graphRevision).toBe("rev-123");
    cleanup(root);
  });
});
