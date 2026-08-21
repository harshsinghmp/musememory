import { describe, test, expect } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectProvider, getGraphStatus, graphSymbolOverlapBonus, createGraphMetadata } from "../src/graph.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";
import type { MemoryEntry } from "../src/types.ts";

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

  test("calculates capped graph symbol overlap bonus", () => {
    const entry: MemoryEntry = {
      id: "m_1_test",
      title: "Test",
      content: "Content",
      project: "aria",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      graph: {
        provider: "codegraph",
        symbol_names: ["UserService", "authMiddleware", "verifyToken"],
      },
    };

    const bonus = graphSymbolOverlapBonus(entry, ["userservice", "auth"]);
    expect(bonus).toBeGreaterThan(0);
    expect(bonus).toBeLessThanOrEqual(0.1);

    const zeroBonus = graphSymbolOverlapBonus(entry, ["database", "migration"]);
    expect(zeroBonus).toBe(0);
  });

  test("creates valid GraphMetadata", () => {
    const meta = createGraphMetadata("codegraph", {
      symbol_names: ["Foo"],
      node_ids: ["n_1"],
    });
    expect(meta.provider).toBe("codegraph");
    expect(meta.symbol_names).toEqual(["Foo"]);
    expect(meta.graph_verified_at).toBeDefined();
  });
});
