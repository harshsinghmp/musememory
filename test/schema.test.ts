import { describe, test, expect } from "bun:test";
import { validateEntry } from "../src/schema.ts";
import { openStore, list } from "../src/store.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

const valid = {
  id: "m_123_foo",
  title: "Title",
  content: "Content",
  project: "p",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  source: "s",
  tags: ["a"],
};

describe("schema validation", () => {
  test("valid entry passes", () => {
    expect(validateEntry(valid).valid).toBe(true);
  });

  test("missing id fails", () => {
    const { id, ...rest } = valid;
    expect(validateEntry(rest).valid).toBe(false);
  });

  test("bad status fails", () => {
    expect(validateEntry({ ...valid, status: "bogus" }).valid).toBe(false);
  });

  test("unknown key fails", () => {
    expect(validateEntry({ ...valid, extra: 1 }).valid).toBe(false);
  });

  test("missing source and tags fails", () => {
    const { source, tags, ...rest } = valid;
    expect(validateEntry(rest).valid).toBe(false);
  });

  test("new statuses are valid", () => {
    for (const status of ["candidate", "confirmed", "stale", "rejected"]) {
      expect(validateEntry({ ...valid, status }).valid).toBe(true);
    }
  });

  test("bad type fails", () => {
    expect(validateEntry({ ...valid, type: "bogus" }).valid).toBe(false);
  });

  test("verification object validates", () => {
    expect(
      validateEntry({
        ...valid,
        verification: { level: "user-confirmed", verified_at: "2026-01-01T00:00:00Z" },
        last_confirmed_at: "2026-01-01T00:00:00Z",
      }).valid,
    ).toBe(true);
  });

  test("bad verification level fails", () => {
    expect(validateEntry({ ...valid, verification: { level: "bogus" } }).valid).toBe(false);
  });

  test("graph object validates", () => {
    expect(
      validateEntry({
        ...valid,
        graph: {
          provider: "codegraph",
          symbol_names: ["AuthMiddleware"],
          node_ids: ["n_1"],
          affected_paths: ["src/auth.ts"],
          graph_verified_at: "2026-01-01T00:00:00Z",
        },
      }).valid,
    ).toBe(true);
  });

  test("bad graph object without required provider fails", () => {
    expect(
      validateEntry({
        ...valid,
        graph: {
          symbol_names: ["AuthMiddleware"],
        },
      }).valid,
    ).toBe(false);
  });

  test("real fixture YAML validates (js-yaml Date roundtrip)", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const entries = list(store);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(validateEntry(e).valid).toBe(true);
    cleanup(root);
  });
});