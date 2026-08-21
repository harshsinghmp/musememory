import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findProjectRoot } from "../src/root.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "root-test-"));
}

describe("hierarchical root detection", () => {
  test("marker .memory wins over .git and manifest, resolves from nested path", () => {
    const root = temp();
    mkdirSync(join(root, "proj", ".memory", "memories"), { recursive: true });
    mkdirSync(join(root, "proj", ".git"), { recursive: true });
    writeFileSync(join(root, "proj", "package.json"), "{}");
    mkdirSync(join(root, "proj", "sub", "deep"), { recursive: true });
    const res = findProjectRoot(join(root, "proj", "sub", "deep"));
    expect(res).toEqual({ root: join(root, "proj"), marker: "memory" });
    rmSync(root, { recursive: true, force: true });
  });

  test(".memory at higher level beats .git at lower level", () => {
    const root = temp();
    mkdirSync(join(root, ".memory", "memories"), { recursive: true });
    mkdirSync(join(root, "subproj", ".git"), { recursive: true });
    mkdirSync(join(root, "subproj", "deep"), { recursive: true });
    const res = findProjectRoot(join(root, "subproj", "deep"));
    expect(res).toEqual({ root, marker: "memory" });
    rmSync(root, { recursive: true, force: true });
  });

  test(".git wins over manifest", () => {
    const root = temp();
    mkdirSync(join(root, "gitproj", ".git"), { recursive: true });
    writeFileSync(join(root, "gitproj", "package.json"), "{}");
    const res = findProjectRoot(join(root, "gitproj"));
    expect(res).toEqual({ root: join(root, "gitproj"), marker: "git" });
    rmSync(root, { recursive: true, force: true });
  });

  test("null when nothing found", () => {
    const root = temp();
    const res = findProjectRoot(root);
    expect(res).toEqual({ root: null, marker: null });
    rmSync(root, { recursive: true, force: true });
  });
});