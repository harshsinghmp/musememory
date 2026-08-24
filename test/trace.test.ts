import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { openStore, propose, link, supersede } from "../src/store.ts";
import { traceGraph, renderTrace } from "../src/trace.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

function setup() {
  const root = makeTempRoot();
  const memoryDir = join(root, ".memory");
  const store = openStore(memoryDir);
  return { root, memoryDir, store };
}

/** decision -> failure -> fix -> superseded chain via related + supersede edges */
function seedChain(store: ReturnType<typeof openStore>) {
  const decision = propose(store, { title: "Adopt Redis for caching", content: "decision: use redis", project: "aria", type: "decision", confirmed: true });
  const failure = propose(store, { title: "Cache stampede outage", content: "failure: unbounded cache misses", project: "aria", type: "failure" });
  const fix = propose(store, { title: "Add request coalescing", content: "fix: coalesce duplicate loads", project: "aria", type: "fix", confirmed: true });
  const oldFix = propose(store, { title: "Naive TTL bump", content: "fix: raise ttl to 600s", project: "aria", type: "fix", confirmed: true });
  supersede(store, oldFix.id, fix.id);
  link(store, decision.id, [failure.id]);
  link(store, failure.id, [fix.id]);
  return { decision, failure, fix, oldFix };
}

describe("multi-hop causality tracer", () => {
  test("walks supersedes and related edges across multiple hops", () => {
    const { root, memoryDir, store } = setup();
    const { decision, failure, fix, oldFix } = seedChain(store);

    const node = traceGraph(store, decision.id);
    expect(node).not.toBeNull();
    expect(node!.id).toBe(decision.id);
    expect(node!.relation).toBe("root");

    // depth 1: failure (related)
    expect(node!.children.map((c) => c.id)).toEqual([failure.id]);
    expect(node!.children[0].relation).toBe("related");

    // depth 2: fix (related), depth 3: oldFix (supersedes)
    const fixNode = node!.children[0].children;
    expect(fixNode.map((c) => c.id)).toEqual([fix.id]);
    expect(fixNode[0].children.map((c) => c.id)).toEqual([oldFix.id]);
    expect(fixNode[0].children[0].relation).toBe("supersedes");

    cleanup(root);
  });

  test("depth cutoff stops expansion beyond maxDepth", () => {
    const { root, memoryDir, store } = setup();
    const { decision, failure } = seedChain(store);

    const node = traceGraph(store, decision.id, 1)!;
    expect(node.children.map((c) => c.id)).toEqual([failure.id]);
    expect(node.children[0].children.length).toBe(0);

    cleanup(root);
  });

  test("cycle-safe: mutual related links are visited once", () => {
    const { root, memoryDir, store } = setup();
    const a = propose(store, { title: "Loop A", content: "a", project: "aria", confirmed: true });
    const b = propose(store, { title: "Loop B", content: "b", project: "aria", confirmed: true });
    link(store, a.id, [b.id]);
    link(store, b.id, [a.id]);

    const node = traceGraph(store, a.id)!;
    const lines = renderTrace(node);
    const occurrences = lines.filter((l) => l.includes(b.id)).length;
    expect(occurrences).toBe(1);

    cleanup(root);
  });

  test("returns null for unknown ids and renders status/type/age per hop", () => {
    const { root, memoryDir, store } = setup();
    expect(traceGraph(store, "m_123_nope")).toBeNull();

    const { decision } = seedChain(store);
    const lines = renderTrace(traceGraph(store, decision.id)!);
    expect(lines[0]).toMatch(/^\* m_[0-9]+_[a-z0-9_-]+ \[confirmed\/decision\] \(\d+d\) /);
    expect(lines[1]).toContain("<-related-");
    expect(lines[1]).toMatch(/\[candidate\/failure\] \(\d+d\)/);

    cleanup(root);
  });
});
