import { describe, test, expect } from "bun:test";
import { openStore, propose, confirm, supersede, markStale, reject, get } from "../src/store.ts";
import { scoreEntry } from "../src/retrieval.ts";
import { validateEntry } from "../src/schema.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

describe("bi-temporal validity & reinforcement", () => {
  test("propose persists validFrom/validTo valid-time stamps", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const entry = propose(store, {
      content: "Rate limit was 10 rpm until v2",
      project: "aria",
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2026-06-01T00:00:00.000Z",
    });
    expect(entry.valid_from).toBe("2026-01-01T00:00:00.000Z");
    expect(entry.valid_to).toBe("2026-06-01T00:00:00.000Z");
    expect(get(store, entry.id)!.valid_from).toBe("2026-01-01T00:00:00.000Z");
    cleanup(root);
  });

  test("confirm bumps reinforcement +1", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);
    const a = propose(store, { content: "fact", project: "aria" });
    expect(a.reinforcement).toBeUndefined();
    confirm(store, a.id);
    expect(get(store, a.id)!.reinforcement).toBe(1);
    // stale -> confirmed re-promotion reinforces again
    markStale(store, a.id);
    confirm(store, a.id);
    expect(get(store, a.id)!.reinforcement).toBe(1);
    cleanup(root);
  });

  test("markStale/reject/supersede stamp valid_to once and decrement reinforcement", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    const s = propose(store, { content: "old way", project: "aria", confirmed: true });
    const n = propose(store, { content: "new way", project: "aria", confirmed: true });
    supersede(store, s.id, n.id);
    const oldEntry = get(store, s.id)!;
    expect(oldEntry.status).toBe("superseded");
    expect(oldEntry.valid_to).toBeTruthy();
    expect(oldEntry.reinforcement).toBe(-1);
    // New replacement is untouched
    expect(get(store, n.id)!.valid_to).toBeUndefined();

    const r = propose(store, { content: "bad guess", project: "aria" });
    reject(store, r.id);
    expect(get(store, r.id)!.valid_to).toBeTruthy();
    expect(get(store, r.id)!.reinforcement).toBe(-1);

    // Existing valid_to is never overwritten
    const st = propose(store, {
      content: "expired fact",
      project: "aria",
      validTo: "2026-05-01T00:00:00.000Z",
    });
    markStale(store, st.id);
    expect(get(store, st.id)!.valid_to).toBe("2026-05-01T00:00:00.000Z");

    cleanup(root);
  });

  test("scoring decays on valid_from when present and applies reinforcement bonus/penalty", () => {
    const now = Date.now();
    const q = ["caching"];

    // Same system recency, different valid-time starts -> older valid time scores lower
    const freshValid = scoreEntry(
      { id: "m_1_a", title: "Caching", content: "caching", project: "p", status: "confirmed", created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-20T00:00:00.000Z", valid_from: "2026-08-20T00:00:00.000Z" },
      q,
      now,
    );
    const oldValid = scoreEntry(
      { id: "m_2_b", title: "Caching", content: "caching", project: "p", status: "confirmed", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-08-20T00:00:00.000Z", valid_from: "2026-01-01T00:00:00.000Z" },
      q,
      now,
    );
    expect(oldValid).toBeLessThan(freshValid);

    // Reinforcement bonus: +0.05 per confirm capped at 5
    const base = scoreEntry(
      { id: "m_3_c", title: "Caching", content: "caching", project: "p", status: "confirmed", created_at: "2026-08-20T00:00:00.000Z", updated_at: "2026-08-20T00:00:00.000Z" },
      q,
      now,
    );
    const reinforced = scoreEntry(
      { id: "m_4_d", title: "Caching", content: "caching", project: "p", status: "confirmed", created_at: "2026-08-20T00:00:00.000Z", updated_at: "2026-08-20T00:00:00.000Z", reinforcement: 3 },
      q,
      now,
    );
    const capped = scoreEntry(
      { id: "m_5_e", title: "Caching", content: "caching", project: "p", status: "confirmed", created_at: "2026-08-20T00:00:00.000Z", updated_at: "2026-08-20T00:00:00.000Z", reinforcement: 12 },
      q,
      now,
    );
    expect(reinforced).toBeCloseTo(base + 0.15, 6);
    expect(capped).toBeCloseTo(base + 0.25, 6);

    // Negative reinforcement penalizes symmetrically
    const punished = scoreEntry(
      { id: "m_6_f", title: "Caching", content: "caching", project: "p", status: "confirmed", created_at: "2026-08-20T00:00:00.000Z", updated_at: "2026-08-20T00:00:00.000Z", reinforcement: -2 },
      q,
      now,
    );
    expect(punished).toBeCloseTo(base - 0.1, 6);
  });

  test("schema validation accepts bi-temporal fields and rejects bad types", () => {
    const ok = validateEntry({
      id: "m_1700000001000_auth",
      title: "t",
      content: "c",
      project: "p",
      status: "candidate",
      created_at: "2026-08-20T00:00:00.000Z",
      updated_at: "2026-08-20T00:00:00.000Z",
      source: "manual",
      tags: [],
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_to: "2026-06-01T00:00:00.000Z",
      reinforcement: 2,
    });
    expect(ok.valid).toBe(true);

    const bad = validateEntry({
      id: "m_1700000001000_auth",
      title: "t",
      content: "c",
      project: "p",
      status: "candidate",
      created_at: "2026-08-20T00:00:00.000Z",
      updated_at: "2026-08-20T00:00:00.000Z",
      source: "manual",
      tags: [],
      reinforcement: "many",
    });
    expect(bad.valid).toBe(false);
  });
});
