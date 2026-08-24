import { describe, test, expect, afterEach } from "bun:test";
import { openStore, propose, get, save } from "../src/store.ts";
import { collectNudges, renderNudges } from "../src/nudge.ts";
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

/** Backdate an entry's timestamps so staleness policy / candidate-age checks trigger. */
function backdate(store: ReturnType<typeof openStore>, id: string, daysAgo: number) {
  const e = get(store, id)!;
  const old = new Date(Date.now() - daysAgo * DAY).toISOString();
  e.created_at = old;
  e.valid_from = old;
  e.updated_at = old;
  save(store, e);
}

describe("SOW-101 memory nudge", () => {
  test("flags overdue and due-soon entries with correct severity ordering", () => {
    const { root, store } = setup();
    propose(store, { content: "rotate credentials", project: "p", dueAt: new Date(Date.now() - 2 * DAY).toISOString(), confirmed: true });
    propose(store, { content: "verify CORS fix", project: "p", dueAt: new Date(Date.now() + 3 * DAY).toISOString(), confirmed: true });
    propose(store, { content: "no deadline note", project: "p", confirmed: true });

    const report = collectNudges(store, root, `${root}/.memory`);
    const dueItems = report.items.filter((i) => i.severity === "overdue" || i.severity === "due-soon");
    expect(dueItems.length).toBe(2);
    // overdue ranks before due-soon
    expect(report.items[0].severity).toBe("overdue");
    expect(report.items.some((i) => i.severity === "due-soon" && i.detail?.includes("CORS"))).toBe(true);
    // no-deadline entry not flagged
    expect(report.items.some((i) => i.detail?.includes("no deadline note"))).toBe(false);
  });

  test("flags confirmed entries past their per-type staleness policy", () => {
    const { root, store } = setup();
    const fix = propose(store, { content: "auth workaround", project: "p", type: "fix", confirmed: true });
    backdate(store, fix.id, 100); // fix policy = 90d
    const arch = propose(store, { content: "system design", project: "p", type: "architecture", confirmed: true });
    backdate(store, arch.id, 100); // arch policy = 365d — still fresh

    const report = collectNudges(store, root, `${root}/.memory`);
    const stale = report.items.filter((i) => i.severity === "stale-policy");
    expect(stale.length).toBe(1);
    expect(stale[0].detail).toContain("auth workaround");
    expect(stale[0].detail).toContain("90d limit");
  });

  test("permanent types (preference) never go stale by policy", () => {
    const { root, store } = setup();
    const pref = propose(store, { content: "always use bun", project: "p", type: "preference", confirmed: true });
    backdate(store, pref.id, 400);
    const report = collectNudges(store, root, `${root}/.memory`);
    expect(report.items.filter((i) => i.severity === "stale-policy").length).toBe(0);
  });

  test("includes memory-side open loops and constraints from the ambient tracker", () => {
    const { root, store } = setup();
    const cand = propose(store, { content: "never confirmed idea", project: "p" });
    backdate(store, cand.id, 10); // candidate > 7d -> loop

    const report = collectNudges(store, root, `${root}/.memory`);
    expect(report.items.some((i) => i.severity === "loop" && i.label.includes("stale candidate"))).toBe(true);
  });

  test("superseded/rejected entries are never nudged", () => {
    const { root, store } = setup();
    const e = propose(store, { content: "old way", project: "p", type: "fix", confirmed: true, dueAt: new Date(Date.now() - DAY).toISOString() });
    const stored = get(store, e.id)!;
    stored.status = "superseded";
    save(store, stored);

    const report = collectNudges(store, root, `${root}/.memory`);
    expect(report.items.length).toBe(0);
  });

  test("renderNudges reports count and all-clear line", () => {
    expect(renderNudges({ items: [] })).toEqual(["Nudges: 0", "(all clear)"]);
    const lines = renderNudges({ items: [{ severity: "overdue", label: "overdue: m_1", detail: "x" }] });
    expect(lines[0]).toBe("Nudges: 1");
    expect(lines[1]).toContain("[overdue]");
  });
});
