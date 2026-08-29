import { describe, test, expect } from "bun:test";
import { openStore, propose } from "../src/store.ts";
import { WorkspaceGovernor } from "../src/governor.ts";
import { setupFixtureRoot, cleanup } from "./helpers.ts";

describe("WorkspaceGovernor Engine", () => {
  test("manages in-flight session checkpoints and handoff state atomically", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    WorkspaceGovernor.checkpointSession(memoryDir, {
      status: "IN-PROGRESS",
      agent: "Antigravity",
      task: "Refactor core memory architecture",
      progress: ["[x] Consolidated compounding engine", "[x] Unified retrieval engine"],
      discoveries: ["Zero daemon architecture scales seamlessly"],
    });

    const state = WorkspaceGovernor.getActiveState(store, memoryDir);
    expect(state.handoff?.status).toBe("IN-PROGRESS");
    expect(state.handoff?.agent).toBe("Antigravity");
    expect(state.handoff?.task).toBe("Refactor core memory architecture");
    expect(state.handoff?.progress?.length).toBe(2);

    WorkspaceGovernor.completeSession(memoryDir, "All 4 architecture candidates completed");
    const completed = WorkspaceGovernor.getActiveState(store, memoryDir);
    expect(completed.handoff?.status).toBe("COMPLETED");

    cleanup(root);
  });

  test("evaluates ambient attention horizons in a single pass", () => {
    const { root, memoryDir } = setupFixtureRoot();
    const store = openStore(memoryDir);

    propose(store, {
      title: "Overdue task obligation",
      content: "Must finish DB index optimization",
      project: "backend",
      type: "fix",
      confirmed: true,
      due_at: new Date(Date.now() - 86_400_000 * 2).toISOString(), // 2 days overdue
    });

    const report = WorkspaceGovernor.evaluateAttention(store, root, memoryDir);
    expect(report.items.some((i) => i.severity === "overdue")).toBe(true);
    expect(report.items.length).toBeGreaterThan(0);

    cleanup(root);
  });
});
