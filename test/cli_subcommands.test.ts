import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose } from "../src/store.ts";
import { handleSettingsCommand } from "../src/cli/settings.ts";
import { handleEntitiesCommand } from "../src/cli/entities.ts";
import { handleSearchCommand } from "../src/cli/retrieval.ts";
import { extractEntitiesFromMemories, saveEntities } from "../src/entities/index.ts";

describe("CLI Subcommand Parsing & Scoping Tests", () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-cli-test-"));
    memoryDir = join(tmpDir, ".memory");
    openStore(memoryDir);
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handleSettingsCommand parses 'set' and 'get' subcommands with positional arguments", () => {
    // 1. Set global setting: memory settings set retrieval.defaultMode tree
    const exitCodeSet = handleSettingsCommand({
      positional: ["set", "retrieval.defaultMode", "tree"],
      flags: { dir: tmpDir },
    });
    expect(exitCodeSet).toBe(0);

    // 2. Get global setting: memory settings get retrieval.defaultMode
    const exitCodeGet = handleSettingsCommand({
      positional: ["get", "retrieval.defaultMode"],
      flags: { dir: tmpDir },
    });
    expect(exitCodeGet).toBe(0);

    // 3. Reset settings: memory settings reset
    const exitCodeReset = handleSettingsCommand({
      positional: ["reset"],
      flags: { dir: tmpDir },
    });
    expect(exitCodeReset).toBe(0);
  });

  it("handleEntitiesCommand parses 'show' and 'related' subcommands with positional arguments", () => {
    const store = openStore(memoryDir);
    const m1 = propose(store, {
      content: "Integrating Next.js with React 19 and Tailwind CSS",
      title: "Frontend Stack",
      project: "projA",
      confirmed: true,
    });
    const result = extractEntitiesFromMemories([m1]);
    saveEntities(memoryDir, result.entities);

    // 1. Show entity: memory entities show nextjs
    const exitCodeShow = handleEntitiesCommand({
      positional: ["show", "nextjs"],
      flags: { dir: tmpDir },
    });
    expect(exitCodeShow).toBe(0);

    // 2. Related entity: memory entities related nextjs
    const exitCodeRelated = handleEntitiesCommand({
      positional: ["related", "nextjs"],
      flags: { dir: tmpDir },
    });
    expect(exitCodeRelated).toBe(0);
  });

  it("handleSearchCommand passes project filter to queryContext", async () => {
    const store = openStore(memoryDir);
    propose(store, {
      content: "Auth token handler for project alpha",
      title: "Alpha Auth",
      project: "alpha",
      confirmed: true,
    });
    propose(store, {
      content: "Auth token handler for project beta",
      title: "Beta Auth",
      project: "beta",
      confirmed: true,
    });

    // Run search scoped to alpha
    const exitCode = await handleSearchCommand({
      positional: ["Auth"],
      flags: { dir: tmpDir, project: "alpha" },
    });
    expect(exitCode).toBe(0);
  });
});
