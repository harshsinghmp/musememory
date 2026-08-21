import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findProjectRoot, findOrCreateProjectRoot } from "../src/root.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "root-test-"));
}

describe("hierarchical root detection", () => {
  test("marker .muse-memory wins over .git and manifest, resolves from nested path", () => {
    const root = temp();
    mkdirSync(join(root, "proj", ".muse-memory", "memories"), { recursive: true });
    mkdirSync(join(root, "proj", ".git"), { recursive: true });
    writeFileSync(join(root, "proj", "package.json"), "{}");
    mkdirSync(join(root, "proj", "sub", "deep"), { recursive: true });
    const res = findProjectRoot(join(root, "proj", "sub", "deep"));
    expect(res).toEqual({ root: join(root, "proj"), marker: "memory", memoryDirName: ".muse-memory" });
    rmSync(root, { recursive: true, force: true });
  });

  test(".muse-memory at higher level beats .git at lower level", () => {
    const root = temp();
    mkdirSync(join(root, ".muse-memory", "memories"), { recursive: true });
    mkdirSync(join(root, "subproj", ".git"), { recursive: true });
    mkdirSync(join(root, "subproj", "deep"), { recursive: true });
    const res = findProjectRoot(join(root, "subproj", "deep"));
    expect(res).toEqual({ root, marker: "memory", memoryDirName: ".muse-memory" });
    rmSync(root, { recursive: true, force: true });
  });

  test("findOrCreateProjectRoot defaults to .muse-memory and never .musememory", () => {
    const root = temp();
    const targetDir = join(root, "fresh-project");
    mkdirSync(targetDir, { recursive: true });
    const res = findOrCreateProjectRoot(targetDir);
    expect(res.memoryDir).toBe(join(targetDir, ".muse-memory"));
    expect(res.memoryDir).not.toContain(".musememory");
    rmSync(root, { recursive: true, force: true });
  });

  test("legacy .memory is supported for backward compatibility", () => {
    const root = temp();
    mkdirSync(join(root, "proj", ".memory", "memories"), { recursive: true });
    const res = findProjectRoot(join(root, "proj"));
    expect(res).toEqual({ root: join(root, "proj"), marker: "memory", memoryDirName: ".memory" });
    rmSync(root, { recursive: true, force: true });
  });

  test(".git wins over manifest", () => {
    const root = temp();
    mkdirSync(join(root, "gitproj", ".git"), { recursive: true });
    writeFileSync(join(root, "gitproj", "package.json"), "{}");
    const res = findProjectRoot(join(root, "gitproj"));
    expect(res.root).toBe(join(root, "gitproj"));
    expect(res.marker).toBe("git");
    rmSync(root, { recursive: true, force: true });
  });

  test("null when nothing found", () => {
    const root = temp();
    const res = findProjectRoot(root);
    expect(res).toEqual({ root: null, marker: null });
    rmSync(root, { recursive: true, force: true });
  });
});