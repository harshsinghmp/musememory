import { describe, test, expect, afterEach } from "bun:test";
import { openStore } from "../src/store.ts";
import { list } from "../src/store.ts";
import { importTranscript, extractCommitments, openLoopId } from "../src/harvest.ts";
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

describe("SOW-103 open-loop extraction", () => {
  test("extractCommitments detects commitment phrasing deterministically", () => {
    const text = [
      "I'll fix the flaky test later",
      "TODO: update the API docs",
      "we need to migrate off the old endpoint",
      "the build is green", // no commitment
      "I'll fix the flaky test later", // duplicate — dropped
    ].join("\n");
    const found = extractCommitments(text);
    expect(found.length).toBe(3);
    expect(found.some((c) => c.toLowerCase().includes("flaky test"))).toBe(true);
    expect(found.some((c) => c.toLowerCase().startsWith("todo"))).toBe(true);
    expect(found.some((c) => c.toLowerCase().includes("migrate off"))).toBe(true);
  });

  test("extractCommitments strips speaker prefixes and ignores empty input", () => {
    expect(extractCommitments("assistant: I'll verify the CORS fix tomorrow")).toHaveLength(1);
    expect(extractCommitments("")).toEqual([]);
    expect(extractCommitments(undefined as never)).toEqual([]);
  });

  test("openLoopId is stable across whitespace/case normalization", () => {
    expect(openLoopId("I'll fix X")).toBe(openLoopId("i'll   FIX x"));
    expect(openLoopId("a")).not.toBe(openLoopId("b"));
    expect(openLoopId("valid")).toMatch(/^m_[0-9]+_[a-z0-9_-]+$/);
  });

  test("importTranscript proposes open-loop candidates tagged open-loop", () => {
    const { store } = setup();
    const transcript = `user: can you look at the rate limiting?\nassistant: I'll add a retry with backoff to the client\n`;
    const result = importTranscript(store, transcript, { project: "p" });
    expect(result.openLoops.length).toBeGreaterThanOrEqual(1);
    const loop = result.openLoops[0];
    expect(loop.status).toBe("candidate");
    expect(loop.tags).toContain("open-loop");
    expect(loop.type).toBe("operation");
  });

  test("re-ingesting the same transcript never duplicates open loops", () => {
    const { store } = setup();
    const transcript = `assistant: I'll update the migration script\n`;
    const first = importTranscript(store, transcript, { project: "p" });
    const second = importTranscript(store, transcript, { project: "p" });
    expect(first.openLoops.length).toBe(1);
    expect(second.openLoops.length).toBe(0);
    const loopsInStore = list(store).filter((e) => e.tags?.includes("open-loop"));
    expect(loopsInStore.length).toBe(1);
  });

  test("session_id binds to open-loop entries when provided", () => {
    const { store } = setup();
    const result = importTranscript(store, "TODO: rotate keys", {
      project: "p",
      sessionId: "ses_123",
    });
    expect(result.openLoops[0].session_id).toBe("ses_123");
  });

  test("openLoops option can be disabled", () => {
    const { store } = setup();
    const result = importTranscript(store, "I'll do the thing", { project: "p", openLoops: false });
    expect(result.openLoops.length).toBe(0);
  });
});
