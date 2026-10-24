import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, save } from "../src/store.ts";
import { evaluateProjectHealth } from "../src/health/index.ts";
import { clusterRecurringBugsAndFriction } from "../src/cognition/clustering.ts";
import { analyzeTechnicalDebt } from "../src/cognition/tech-debt.ts";
import { handleHealthCommand } from "../src/cli/health.ts";
import { createCodeAnchor } from "../src/anchors/index.ts";
import type { MemoryEntry } from "../src/types.ts";

function entry(partial: Partial<MemoryEntry> & { id: string; project: string }): MemoryEntry {
  return {
    title: partial.id,
    content: `${partial.id} content`,
    status: "confirmed",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags: [],
    ...partial,
  } as MemoryEntry;
}

describe("T-321: per-project health gate scope", () => {
  let tmpDir: string;
  let store: ReturnType<typeof openStore>;
  let codeDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-t321-test-"));
    store = openStore(join(tmpDir, ".memory"));
    codeDir = join(tmpDir, "src");
    mkdirSync(codeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Two projects:
   *   alpha — one conflicted memory (a health defect)
   *   beta  — clean
   * A store-wide report must not be attributed to either one.
   */
  function seedTwoProjects(): void {
    writeFileSync(join(codeDir, "api.ts"), `export function handleRequest() { return "ok"; }\n`);

    save(store, entry({ id: "m_alpha_conflicted", project: "alpha", status: "conflicted" }));
    save(store, entry({ id: "m_alpha_clean", project: "alpha" }));
    save(store, entry({ id: "m_beta_clean", project: "beta" }));
  }

  it("attributes a store-wide report to the whole store, not to whichever memory sorts first", () => {
    seedTwoProjects();

    const report = evaluateProjectHealth(store, tmpDir);

    // The old implementation used `entries[0].project`, so the number was
    // labelled with one arbitrary project.
    expect(report.project).toBe("all");
    expect(report.scope.filter).toBeNull();
    expect(report.scope.projects).toEqual(["alpha", "beta"]);
    expect(report.scope.entry_count).toBe(3);
  });

  it("keeps naming the project when the store holds exactly one", () => {
    save(store, entry({ id: "m_solo", project: "solo" }));

    const report = evaluateProjectHealth(store, tmpDir);

    expect(report.project).toBe("solo");
    expect(report.scope.filter).toBeNull();
    expect(report.scope.projects).toEqual(["solo"]);
    expect(report.scope.entry_count).toBe(1);
  });

  it("scopes the memory-side pillars to the requested project", () => {
    seedTwoProjects();

    const alpha = evaluateProjectHealth(store, tmpDir, { project: "alpha" });
    const beta = evaluateProjectHealth(store, tmpDir, { project: "beta" });

    expect(alpha.project).toBe("alpha");
    expect(alpha.scope.filter).toBe("alpha");
    expect(alpha.scope.projects).toEqual(["alpha"]);
    expect(alpha.scope.entry_count).toBe(2);

    // The conflicted memory belongs to alpha, so only alpha's report sees it.
    expect(alpha.pillars.store_integrity.metrics.conflicted_memories).toBe(1);
    expect(alpha.pillars.store_integrity.metrics.total_memories).toBe(2);
    expect(alpha.pillars.store_integrity.score).toBeLessThan(100);

    expect(beta.pillars.store_integrity.metrics.conflicted_memories).toBe(0);
    expect(beta.pillars.store_integrity.metrics.total_memories).toBe(1);
    expect(beta.pillars.store_integrity.score).toBe(100);
  });

  it("does not leak another project's memories into a filtered report", () => {
    seedTwoProjects();

    const beta = evaluateProjectHealth(store, tmpDir, { project: "beta" });

    expect(beta.pillars.store_integrity.metrics.total_memories).toBe(1);
    expect(beta.scope.entry_count).toBe(1);
    // The summary states the scope instead of leaving the reader to guess.
    expect(beta.summary).toContain('project "beta"');
  });

  it("states that code-side metrics stay workspace-wide", () => {
    seedTwoProjects();

    const report = evaluateProjectHealth(store, tmpDir, { project: "alpha" });

    expect(report.scope.code_scope).toBe("workspace");
    expect(report.summary).toContain("code-side metrics cover the workspace");
  });

  it("scopes bug clustering to the requested project", () => {
    save(store, entry({ id: "m_alpha_bug", project: "alpha", type: "fix", tags: ["bug"] }));
    save(store, entry({ id: "m_beta_bug", project: "beta", type: "fix", tags: ["bug"] }));

    const all = clusterRecurringBugsAndFriction(store);
    const alpha = clusterRecurringBugsAndFriction(store, { project: "alpha" });
    const beta = clusterRecurringBugsAndFriction(store, { project: "beta" });

    const alphaIds = alpha.flatMap((c) => c.sample_fixes.map((e) => e.id));
    const betaIds = beta.flatMap((c) => c.sample_fixes.map((e) => e.id));

    expect(all.length).toBeGreaterThan(0);
    expect(alphaIds).toContain("m_alpha_bug");
    expect(alphaIds).not.toContain("m_beta_bug");
    expect(betaIds).toContain("m_beta_bug");
    expect(betaIds).not.toContain("m_alpha_bug");
  });

  it("scopes memory-derived technical debt to the requested project", () => {
    const driftedFile = join(codeDir, "drifted.ts");
    writeFileSync(driftedFile, `export function handleThing() { return 1; }\n`);

    // A real anchor, then the source changes so the anchor drifts.
    const anchor = createCodeAnchor(tmpDir, {
      kind: "symbol",
      filePath: "src/drifted.ts",
      symbolName: "handleThing",
    });

    save(
      store,
      entry({
        id: "m_alpha_drifted",
        project: "alpha",
        anchors: [anchor],
      }),
    );
    save(store, entry({ id: "m_beta_plain", project: "beta" }));

    // Mutate the file so the anchor drifts.
    writeFileSync(driftedFile, `export function handleThing(arg: string) { return arg; }\n`);

    const alpha = analyzeTechnicalDebt(store, tmpDir, { project: "alpha" });
    const beta = analyzeTechnicalDebt(store, tmpDir, { project: "beta" });

    const alphaIds = alpha.items.map((d) => d.id);
    const betaIds = beta.items.map((d) => d.id);

    expect(alphaIds.some((id) => id.includes("m_alpha_drifted"))).toBe(true);
    expect(betaIds.some((id) => id.includes("m_alpha_drifted"))).toBe(false);
  });

  it("returns an empty scope for a project that does not exist", () => {
    seedTwoProjects();

    const report = evaluateProjectHealth(store, tmpDir, { project: "nonexistent" });

    expect(report.project).toBe("nonexistent");
    expect(report.scope.entry_count).toBe(0);
    expect(report.scope.projects).toEqual([]);
  });

  it("CLI --project scopes the report", async () => {
    seedTwoProjects();

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    let exitCode = 0;
    try {
      exitCode = await handleHealthCommand({
        positional: [],
        flags: { dir: tmpDir, project: "beta" },
      });
    } finally {
      console.log = originalLog;
    }

    const output = lines.join("\n");
    expect(exitCode).toBe(0);
    expect(output).toContain("Project:");
    expect(output).toContain("beta");
    expect(output).toContain("Scope:");
  });
});
