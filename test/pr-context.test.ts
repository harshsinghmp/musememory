import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, save } from "../src/store.ts";
import { recordAdr } from "../src/adrs/engine.ts";
import { generatePrContext } from "../src/compaction/pr-context.ts";
import type { MemoryEntry } from "../src/types.ts";

describe("PR & Change Context Generator", () => {
  let tempDir: string;
  let storeDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "muse-pr-test-"));
    storeDir = join(tempDir, ".memory");
    mkdirSync(storeDir, { recursive: true });
    mkdirSync(join(storeDir, "memories"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("generates markdown PR description incorporating active constraints and touched files", async () => {
    const store = openStore(storeDir);

    // 1. Create a dummy file
    const srcDir = join(tempDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "auth.ts"), "export function verifyToken() {}\n", "utf8");

    // 2. Create an ADR
    recordAdr(store, tempDir, {
      title: "Use JWT v2 Architecture",
      project: "pr-test",
      decision: "Mandate JWT v2 tokens across all services.",
      context_and_drivers: ["Zero-trust network architecture"],
      consequences: { positive: ["Stateless validation"] },
      affected_files: ["src/auth.ts"],
    });

    // 3. Create active constraints
    writeFileSync(
      join(storeDir, "CURRENT.md"),
      "# Active Working Invariants\n\n- [ ] Zero secret exposure in git history\n- [ ] Backward compatibility with v1 API\n",
      "utf8"
    );

    // 4. Generate PR Context with fallback changed files
    const pr = await generatePrContext(store, {
      baseBranch: "main",
      workspaceRoot: tempDir,
    });

    expect(pr.title).toContain("Update");
    expect(pr.bodyMarkdown).toContain("## 📋 Summary & Purpose");
    expect(pr.bodyMarkdown).toContain("## 🏛️ Architecture Decision Records (ADRs) Involved");
    expect(pr.bodyMarkdown).toContain("## 🛡️ Invariants & Negative Lessons Respected");
    expect(pr.bodyMarkdown).toContain("Zero secret exposure in git history");
    expect(pr.bodyMarkdown).toContain("## 💥 Blast Radius & Risk Assessment");
    expect(pr.bodyMarkdown).toContain("## 🧪 Verification & Evidence");
    expect(pr.bodyMarkdown).toContain("## 💡 Proposed Knowledge for Merge Promotion");
  });

  it("handles clean repositories with zero git diff without errors", async () => {
    const store = openStore(storeDir);
    const pr = await generatePrContext(store, {
      baseBranch: "main",
      workspaceRoot: tempDir,
    });

    expect(pr.changedFiles.length).toBe(0);
    expect(pr.bodyMarkdown).toContain("No changed files detected.");
    expect(pr.highestRisk).toBe("LOW");
  });
});
