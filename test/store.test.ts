import { describe, test, expect } from "bun:test";
import { openStore, propose, confirm, supersede, markStale, reject, get, list, save, makeId, link } from "../src/store.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

describe("store graph", () => {
  test("propose -> confirm -> supersede graph", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const a = propose(store, { content: "old fact", project: "aria" });
    expect(get(store, a.id)!.status).toBe("candidate");
    confirm(store, a.id);
    expect(get(store, a.id)!.status).toBe("confirmed");
    expect(get(store, a.id)!.disputed_by).toBeUndefined();
    expect(get(store, a.id)!.last_confirmed_at).toBeDefined();
    const b = propose(store, { content: "new fact", project: "aria", confirmed: true });
    supersede(store, a.id, b.id);
    expect(get(store, a.id)!.status).toBe("superseded");
    expect(get(store, a.id)!.superseded_by).toEqual([b.id]);
    expect(get(store, b.id)!.supersedes).toEqual([a.id]);
    cleanup(root);
  });

  test("makeId produces valid id even with non-alphanumeric input", () => {
    const id = makeId("!@#$%^&*()_+");
    expect(id).toMatch(/^m_[0-9]+_[a-z0-9_-]+$/);
    expect(id).toContain("_entry");
  });

  test("propose throws on detected secrets", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    expect(() => {
      propose(store, { content: "secret key is sk-proj-12345678901234567890123456", project: "aria" });
    }).toThrow(/Probable secret detected/);
    cleanup(root);
  });

  test("supersede requires confirmed target", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const a = propose(store, { content: "old fact", project: "aria", confirmed: true });
    const b = propose(store, { content: "new fact", project: "aria" }); // candidate
    expect(supersede(store, a.id, b.id)).toBeNull();
    expect(get(store, a.id)!.status).toBe("confirmed");
    cleanup(root);
  });

  test("supersede self-guard and append semantics", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const a = propose(store, { content: "old fact", project: "aria", confirmed: true });
    expect(supersede(store, a.id, a.id)).toBeNull();
    const b = propose(store, { content: "new fact", project: "aria", confirmed: true });
    const c = propose(store, { content: "newer fact", project: "aria", confirmed: true });
    supersede(store, a.id, b.id);
    supersede(store, a.id, c.id);
    expect(get(store, a.id)!.superseded_by).toEqual([b.id, c.id]);
    expect(get(store, b.id)!.supersedes).toEqual([a.id]);
    expect(get(store, c.id)!.supersedes).toEqual([a.id]);
    cleanup(root);
  });

  test("supersede appends to string-form superseded_by without char-split", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const a = propose(store, { content: "old fact", project: "aria", confirmed: true });
    const b = propose(store, { content: "new fact", project: "aria", confirmed: true });
    const raw = get(store, a.id)!;
    raw.superseded_by = "m_prev" as never; // legacy string form
    save(store, raw);
    supersede(store, a.id, b.id);
    expect(get(store, a.id)!.superseded_by).toEqual(["m_prev", b.id]);
    cleanup(root);
  });

  test("markStale and reject", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const s = propose(store, { content: "stale fact", project: "aria" });
    markStale(store, s.id, "superseded by docs");
    expect(get(store, s.id)!.status).toBe("stale");
    expect(get(store, s.id)!.content).toContain("Stale: superseded by docs");
    const r = propose(store, { content: "bad fact", project: "aria" });
    reject(store, r.id);
    expect(get(store, r.id)!.status).toBe("rejected");
    cleanup(root);
  });

  test("CRUD roundtrip", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const before = list(store).length;
    const e = {
      id: makeId("roundtrip"),
      title: "T",
      content: "C",
      project: "p",
      status: "active" as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: "manual",
      tags: ["test"],
    };
    save(store, e);
    expect(list(store).length).toBe(before + 1);
    expect(get(store, e.id)!.content).toBe("C");
    cleanup(root);
  });

  test("link writes related_memory_ids both ways", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const a = propose(store, { content: "a", project: "aria" });
    const b = propose(store, { content: "b", project: "aria" });
    const c = propose(store, { content: "c", project: "aria" });
    link(store, a.id, [b.id, c.id]);
    expect(get(store, a.id)!.related_memory_ids).toEqual([b.id, c.id]);
    expect(get(store, b.id)!.related_memory_ids).toEqual([a.id]);
    expect(get(store, c.id)!.related_memory_ids).toEqual([a.id]);
    // no dupes on second link
    link(store, a.id, [b.id]);
    expect(get(store, a.id)!.related_memory_ids).toEqual([b.id, c.id]);
    expect(get(store, b.id)!.related_memory_ids).toEqual([a.id]);
    cleanup(root);
  });

  test("link returns null on missing id", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const a = propose(store, { content: "a", project: "aria" });
    expect(link(store, "m_missing", [a.id])).toBeNull();
    expect(link(store, a.id, ["m_missing"])).toBeNull();
    cleanup(root);
  });

  test("link ignores self-reference", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const a = propose(store, { content: "a", project: "aria" });
    const b = propose(store, { content: "b", project: "aria" });
    link(store, a.id, [a.id, b.id]);
    expect(get(store, a.id)!.related_memory_ids).toEqual([b.id]);
    expect(get(store, b.id)!.related_memory_ids).toEqual([a.id]);
    cleanup(root);
  });
});