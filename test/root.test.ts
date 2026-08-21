import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findProjectRoot, findOrCreateProjectRoot } from "../src/root.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "root-test-"));
}

describe("hierarchical root detection", () => {
  test("marker .musememory wins over .git and manifest, resolves from nested path", () => {
    const root = temp();
    mkdirSync(join(root, "proj", ".musememory", "memories"), { recursive: true });
    mkdirSync(join(root, "proj", ".git"), { recursive: true });
    writeFileSync(join(root, "proj", "package.json"), "{}");
    mkdirSync(join(root, "proj", "sub", "deep"), { recursive: true });
    const res = findProjectRoot(join(root, "proj", "sub", "deep"));
    expect(res).toEqual({ root: join(root, "proj"), marker: "memory", memoryDirName: ".musememory" });
    rmSync(root, { recursive: true, force: true });
  });

  test(".musememory at higher level beats .git at lower level", () => {
    const root = temp();
    mkdirSync(join(root, ".musememory", "memories"), { recursive: true });
    mkdirSync(join(root, "subproj", ".git"), { recursive: true });
    mkdirSync(join(root, "subproj", "deep"), { recursive: true });
    const res = findProjectRoot(join(root, "subproj", "deep"));
    expect(res).toEqual({ root, marker: "memory", memoryDirName: ".musememory" });
    rmSync(root, { recursive: true, force: true });
  });

  test("findOrCreateProjectRoot defaults to .memory", () => {
    const root = temp();
    const targetDir = join(root, "fresh-project");
    mkdirSync(targetDir, { recursive: true });
    const res = findOrCreateProjectRoot(targetDir);
    expect(res.memoryDir).toBe(join(targetDir, ".memory"));
    rmSync(root, { recursive: true, force: true });
  });

  test("legacy .musememory and .muse-memory are supported for backward compatibility", () => {
    const root = temp();
    mkdirSync(join(root, "proj1", ".muse-memory", "memories"), { recursive: true });
    const res1 = findProjectRoot(join(root, "proj1"));
    expect(res1).toEqual({ root: join(root, "proj1"), marker: "memory", memoryDirName: ".muse-memory" });

    mkdirSync(join(root, "proj2", ".musememory", "memories"), { recursive: true });
    const res2 = findProjectRoot(join(root, "proj2"));
    expect(res2).toEqual({ root: join(root, "proj2"), marker: "memory", memoryDirName: ".musememory" });

    mkdirSync(join(root, "proj3", ".memory", "memories"), { recursive: true });
    const res3 = findProjectRoot(join(root, "proj3"));
    expect(res3).toEqual({ root: join(root, "proj3"), marker: "memory", memoryDirName: ".memory" });

    rmSync(root, { recursive: true, force: true });
  });

  test("global path resolution with options.global", () => {
    const root = temp();
    const res = findOrCreateProjectRoot(root, { global: true });
    expect(res.marker).toBe("global");
    expect(res.memoryDir.endsWith(".memory")).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  test(".git wins over manifest and defaults to .memory", () => {
    const root = temp();
    mkdirSync(join(root, "gitproj", ".git"), { recursive: true });
    writeFileSync(join(root, "gitproj", "package.json"), "{}");
    const res = findProjectRoot(join(root, "gitproj"));
    expect(res.root).toBe(join(root, "gitproj"));
    expect(res.marker).toBe("git");
    expect(res.memoryDirName).toBe(".memory");
    rmSync(root, { recursive: true, force: true });
  });

  test("null when nothing found", () => {
    const root = temp();
    const res = findProjectRoot(root);
    expect(res).toEqual({ root: null, marker: null });
    rmSync(root, { recursive: true, force: true });
  });
});