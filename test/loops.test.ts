import { describe, test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { openStore, propose, save, list } from "../src/store.ts";
import { setCurrent } from "../src/current.ts";
import { collectLoops, renderLoops } from "../src/loops.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

function setup(withGit: boolean) {
  const root = makeTempRoot();
  const memoryDir = join(root, ".memory");
  mkdirSync(memoryDir, { recursive: true });
  const store = openStore(memoryDir);
  if (withGit) {
    const g = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    g(["init", "-b", "main"]);
    g(["config", "user.email", "test@example.com"]);
    g(["config", "user.name", "Test"]);
    writeFileSync(join(root, "base.txt"), "base\n");
    g(["add", "."]);
    g(["commit", "-m", "base"]);
    // unmerged branch with its own commit
    g(["checkout", "-b", "feature/unmerged"]);
    writeFileSync(join(root, "feat.txt"), "feat\n");
    g(["add", "."]);
    g(["commit", "-m", "feat"]);
    g(["checkout", "main"]);
    // dirty working tree
    writeFileSync(join(root, "dirty.txt"), "uncommitted\n");
  }
  return { root, memoryDir, store };
}

function backdate(store: ReturnType<typeof openStore>, id: string, daysAgo: number) {
  const entry = list(store).find((e) => e.id === id)!;
  entry.created_at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  save(store, entry);
}

describe("ambient open-loop tracker", () => {
  test("surfaces git state, stale candidates, disputed entries, and constraints", () => {
    const { root, memoryDir, store } = setup(true);

    const oldCandidate = propose(store, { title: "Old hypothesis", content: "never confirmed", project: "aria" });
    backdate(store, oldCandidate.id, 10);
    propose(store, { title: "Fresh idea", content: "recent candidate", project: "aria" }); // <7d, not flagged
    const disputed = propose(store, { title: "Contested claim", content: "disputed fact", project: "aria" });
    disputed.status = "disputed";
    save(store, disputed);
    setCurrent(memoryDir, "Freeze deploys until Monday.", "aria");

    const report = collectLoops(store, root, memoryDir);

    expect(report.git.some((i) => i.label.includes("uncommitted change(s)"))).toBe(true);
    expect(report.git.some((i) => i.label === "unmerged branch: feature/unmerged")).toBe(true);

    expect(report.memories.some((i) => i.label.includes(oldCandidate.id))).toBe(true);
    expect(report.memories.find((i) => i.label.includes(oldCandidate.id))!.ageDays).toBe(10);
    expect(report.memories.some((i) => i.label.includes(disputed.id))).toBe(true);
    expect(report.memories.some((i) => i.detail === "Fresh idea")).toBe(false);

    expect(report.constraints).toEqual([{ source: "constraints", label: expect.stringContaining("Freeze deploys") }]);

    const lines = renderLoops(report);
    expect(lines[0]).toContain(`Open loops: ${report.git.length + report.memories.length + report.constraints.length}`);
    expect(lines).toContain("=== Git Workspace ===");

    cleanup(root);
  });

  test("prioritizes memory loops by age descending", () => {
    const { root, memoryDir, store } = setup(false);
    const a = propose(store, { title: "Older candidate", content: "x", project: "aria" });
    backdate(store, a.id, 20);
    const b = propose(store, { title: "Newer candidate", content: "y", project: "aria" });
    backdate(store, b.id, 8);

    const report = collectLoops(store, root, memoryDir);
    const ages = report.memories.map((i) => i.ageDays!);
    expect(ages).toEqual([...ages].sort((x, y) => y - x));
    expect(ages[0]).toBe(20);

    cleanup(root);
  });

  test("tolerates non-git directories without crashing", () => {
    const { root, memoryDir, store } = setup(false);
    const report = collectLoops(store, root, memoryDir);
    expect(report.git).toEqual([]);
    expect(renderLoops(report)[0]).toContain("Open loops:");
    cleanup(root);
  });
});
