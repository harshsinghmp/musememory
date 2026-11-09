import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, get, list } from "../src/store.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "muse-yaml-mirror-"));
}

describe("R29: YAML mirror opt-out", () => {
  test("writes the mirror by default", () => {
    const root = temp();
    try {
      const store = openStore(root);
      expect(store.yamlMirror).toBe(true);
      const entry = propose(store, { content: "mirror on", project: "p", confirmed: true });
      expect(existsSync(join(store.dir, `${entry.id}.yaml`))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("yamlMirror:false skips the mirror and SQLite stays authoritative", () => {
    const root = temp();
    try {
      const store = openStore(root, { yamlMirror: false });
      expect(store.yamlMirror).toBe(false);
      const entry = propose(store, { content: "db only", project: "p", confirmed: true });

      expect(existsSync(join(store.dir, `${entry.id}.yaml`))).toBe(false);
      const row = store.db!.query<{ content: string }>("SELECT content FROM memories WHERE id = ?").get([entry.id]);
      expect(row?.content).toBe("db only");
      expect(get(store, entry.id)?.content).toBe("db only");
      expect(list(store).map((e) => e.id)).toContain(entry.id);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("MUSE_YAML_MIRROR=0 opts out unless the caller explicitly re-enables", () => {
    const root = temp();
    try {
      process.env.MUSE_YAML_MIRROR = "0";
      const off = openStore(root);
      expect(off.yamlMirror).toBe(false);
      const entry = propose(off, { content: "env off", project: "p", confirmed: true });
      expect(existsSync(join(off.dir, `${entry.id}.yaml`))).toBe(false);
    } finally {
      delete process.env.MUSE_YAML_MIRROR;
      rmSync(root, { recursive: true, force: true });
    }

    const second = temp();
    try {
      process.env.MUSE_YAML_MIRROR = "0";
      const on = openStore(second, { yamlMirror: true });
      expect(on.yamlMirror).toBe(true);
    } finally {
      delete process.env.MUSE_YAML_MIRROR;
      rmSync(second, { recursive: true, force: true });
    }
  });

  test("WAL is bounded by autocheckpoint and journal size limit", () => {
    const root = temp();
    try {
      const store = openStore(root);
      const checkpoint = store.db!.query<{ wal_autocheckpoint: number }>("PRAGMA wal_autocheckpoint").get();
      expect(checkpoint?.wal_autocheckpoint).toBe(512);
      const limit = store.db!.query<{ journal_size_limit: number }>("PRAGMA journal_size_limit").get();
      expect(limit?.journal_size_limit).toBe(67108864);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
