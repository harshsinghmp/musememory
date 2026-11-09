import { describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleMerge3Command } from "../src/cli/merge3.ts";
import { handleEnclaveCommand } from "../src/cli/enclave.ts";
import { handleOverlayCommand } from "../src/cli/branch.ts";
import { openStore, propose } from "../src/store.ts";
import { loadBranchOverlay } from "../src/store/branch.ts";

function entry(id: string, content: string) {
  return { id, title: id, content, project: "p", type: "discovery", status: "confirmed", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", tags: [] };
}

function snapshots(root: string) {
  const base = join(root, "base.json");
  const ours = join(root, "ours.json");
  const theirs = join(root, "theirs.json");
  writeFileSync(base, JSON.stringify([entry("m_1_a", "base")]));
  writeFileSync(ours, JSON.stringify([entry("m_1_a", "ours")]));
  writeFileSync(theirs, JSON.stringify([entry("m_1_a", "theirs")]));
  return [base, ours, theirs];
}

describe("Wave 27 CLI contracts", () => {
  test("merge3 fails closed on unresolved conflicts unless allowed", async () => {
    const root = mkdtempSync(join(tmpdir(), "muse-cli-merge3-"));
    mkdirSync(join(root, ".memory"), { recursive: true });
    try {
      const [base, ours, theirs] = snapshots(root);
      const blocked = await handleMerge3Command({ positional: [base, ours, theirs], flags: { dir: root, strategy: "semantic" } } as any);
      expect(blocked).toBe(1);
      const allowed = await handleMerge3Command({ positional: [base, ours, theirs], flags: { dir: root, strategy: "semantic", "allow-conflicts": "true" } } as any);
      expect(allowed).toBe(0);
      const manual = await handleMerge3Command({ positional: [base, ours, theirs], flags: { dir: root, strategy: "manual" } } as any);
      expect(manual).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("overlay set and rm give the CLI a write surface", async () => {
    const root = mkdtempSync(join(tmpdir(), "muse-cli-overlay-"));
    mkdirSync(join(root, ".memory"), { recursive: true });
    const store = openStore(join(root, ".memory"));
    const entry = propose(store, { content: "base", project: "p", confirmed: true });
    try {
      expect(await handleOverlayCommand({ positional: ["create", "feat/cli"], flags: { dir: root } } as any)).toBe(0);
      expect(await handleOverlayCommand({ positional: ["set", "feat/cli", entry.id], flags: { dir: root, content: "overlay content" } } as any)).toBe(0);
      expect(loadBranchOverlay(join(root, ".memory"), "feat/cli")?.entries[0]?.content).toBe("overlay content");
      expect(await handleOverlayCommand({ positional: ["rm", "feat/cli", entry.id], flags: { dir: root } } as any)).toBe(0);
      expect(loadBranchOverlay(join(root, ".memory"), "feat/cli")?.entries.length).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("enclave rejects invalid types and traversal names", async () => {
    const root = mkdtempSync(join(tmpdir(), "muse-cli-enclave-"));
    mkdirSync(join(root, ".memory"), { recursive: true });
    try {
      const badType = await handleEnclaveCommand({ positional: ["put", "acme", "content"], flags: { dir: root, type: "bogus" } } as any);
      expect(badType).toBe(2);
      const traversal = await handleEnclaveCommand({ positional: ["put", "..", "content"], flags: { dir: root } } as any);
      expect(traversal).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
