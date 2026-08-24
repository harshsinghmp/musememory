import { describe, test, expect, afterEach } from "bun:test";
import { openStore } from "../src/store.ts";
import { propose } from "../src/store.ts";
import { queryContext, scoreEntry, dueDateBonus, isExpired } from "../src/retrieval.ts";
import { validateEntry } from "../src/schema.ts";
import type { MemoryEntry } from "../src/types.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

let roots: string[] = [];
afterEach(() => {
  for (const r of roots) cleanup(r);
  roots = [];
});

function setup() {
  const root = makeTempRoot();
  roots.push(root);
  const store = openStore(`${root}/.memory`);
  return { root, store };
}

const DAY = 86_400_000;

function baseEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = new Date().toISOString();
  return {
    id: "m_1700000000000_test",
    title: "Test entry",
    content: "rotate staging credentials",
    project: "p",
    status: "confirmed",
    created_at: now,
    updated_at: now,
    source: "manual",
    tags: [],
    ...overrides,
  } as MemoryEntry;
}

describe("SOW-104 due_at / expires_at", () => {
  test("schema validates entries carrying due_at and expires_at", () => {
    const report = validateEntry(baseEntry({ due_at: new Date().toISOString(), expires_at: new Date(Date.now() + DAY).toISOString() }));
    expect(report.valid).toBe(true);
  });

  test("propose stores dueAt/expiresAt", () => {
    const { store } = setup();
    const due = new Date(Date.now() + 3 * DAY).toISOString();
    const entry = propose(store, { content: "check migration settled", project: "p", dueAt: due });
    expect(entry.due_at).toBe(due);
    expect(entry.expires_at).toBeUndefined();
  });

  test("expired entries are excluded from default context but kept with includeExpired", () => {
    const { store } = setup();
    propose(store, { content: "stale credential note", project: "p", expiresAt: new Date(Date.now() - DAY).toISOString() });
    propose(store, { content: "live credential note", project: "p" });

    const def = queryContext(store, "credential note");
    expect(def.results.map((r) => r.entry.content)).toEqual(["live credential note"]);

    const all = queryContext(store, "credential note", { includeExpired: true });
    expect(all.results.length).toBe(2);
  });

  test("unparseable expires_at never expires", () => {
    expect(isExpired(baseEntry({ expires_at: "not-a-date" }), Date.now())).toBe(false);
    expect(isExpired(baseEntry({ expires_at: new Date(Date.now() - DAY).toISOString() }), Date.now())).toBe(true);
    expect(isExpired(baseEntry(), Date.now())).toBe(false);
  });

  test("due-date bonus: overdue > due-soon > far-future > none", () => {
    const now = Date.now();
    const overdue = baseEntry({ due_at: new Date(now - DAY).toISOString() });
    const soon = baseEntry({ due_at: new Date(now + 3 * DAY).toISOString() });
    const far = baseEntry({ due_at: new Date(now + 30 * DAY).toISOString() });
    const none = baseEntry();

    expect(dueDateBonus(overdue, now)).toBe(0.35);
    expect(dueDateBonus(soon, now)).toBe(0.25);
    expect(dueDateBonus(far, now)).toBe(0);
    expect(dueDateBonus(none, now)).toBe(0);

    const tokens = ["rotate", "staging", "credentials"];
    expect(scoreEntry(overdue, tokens, now)).toBeGreaterThan(scoreEntry(soon, tokens, now));
    expect(scoreEntry(soon, tokens, now)).toBeGreaterThan(scoreEntry(none, tokens, now));
  });

  test("invalid due_at scores no bonus without throwing", () => {
    expect(dueDateBonus(baseEntry({ due_at: "garbage" }), Date.now())).toBe(0);
  });
});
