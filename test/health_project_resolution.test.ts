import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, save, type Store } from "../src/store.ts";
import { createServer } from "../src/mcp.ts";
import { startUiServer } from "../src/ui.ts";
import { handleHealthCommand } from "../src/cli/health.ts";
import { resolveProjectName } from "../src/health/index.ts";
import type { MemoryEntry } from "../src/types.ts";

/**
 * T-406 / issue #314 — `memory health --project P` matched project names
 * case-sensitively and silently: `--project ALPHA` against a store holding
 * `alpha` returned an empty report labelled with the caller's casing. This
 * diff introduces one resolution helper (`resolveProjectName`, owned in
 * src/health/resolve.ts) and wires all three surfaces (CLI, MCP `muse_health`,
 * Studio `/api/health`) to resolve first and fail loud second.
 *
 * The gate itself (`evaluateProjectHealth`) stays a pure reporting function —
 * its compare remains exact-canonical, so the existing
 * `test/health_project_scope.test.ts` behaviour ("empty scope for a project
 * that does not exist") is untouched.
 */
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

function seedStore(projects: string[]): { store: Store; memoryDir: string; tmpDir: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), "muse-t406-"));
  const memoryDir = join(tmpDir, ".memory");
  const store = openStore(memoryDir);
  for (const project of projects) {
    save(store, entry({ id: `m_${project}_1`, project, type: "discovery" }));
  }
  return { store, memoryDir, tmpDir };
}

describe("T-406: resolveProjectName resolution helper", () => {
  it("returns the canonical name for a case-insensitive unique match", () => {
    const { store, tmpDir } = seedStore(["alpha", "beta"]);
    try {
      expect(resolveProjectName(store, "ALPHA")).toBe("alpha");
      expect(resolveProjectName(store, "  alpha  ")).toBe("alpha");
      expect(resolveProjectName(store, "alpha")).toBe("alpha");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns undefined for unknown and for ambiguous requests", () => {
    const { store, tmpDir } = seedStore(["alpha", "beta"]);
    try {
      expect(resolveProjectName(store, "nonexistent")).toBeUndefined();
      expect(resolveProjectName(store, undefined)).toBeUndefined();
      expect(resolveProjectName(store, "   ")).toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }

    const ambiguous = mkdtempSync(join(tmpdir(), "muse-t406-amb-"));
    const ambMemoryDir = join(ambiguous, ".memory");
    const ambStore = openStore(ambMemoryDir);
    save(ambStore, entry({ id: "m_a_low", project: "alpha", type: "discovery" }));
    save(ambStore, entry({ id: "m_a_up", project: "ALPHA", type: "discovery" }));
    try {
      // Exact request wins even in an ambiguous store.
      expect(resolveProjectName(ambStore, "ALPHA")).toBe("ALPHA");
      expect(resolveProjectName(ambStore, "alpha")).toBe("alpha");
      // A request matching two projects that differ only in case is unresolved.
      expect(resolveProjectName(ambStore, "alpHa")).toBeUndefined();
    } finally {
      rmSync(ambiguous, { recursive: true, force: true });
    }
  });
});

describe("T-406: CLI surface is loud and canonical", () => {
  let harness: ReturnType<typeof seedStore>;

  beforeEach(() => {
    harness = seedStore(["alpha", "beta"]);
  });

  afterEach(() => {
    rmSync(harness.tmpDir, { recursive: true, force: true });
  });

  it("exits 1 with an explicit line when the project matches nothing", async () => {
    const logs: string[] = [];
    const errs: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => errs.push(args.map(String).join(" "));
    let exitCode = 0;
    try {
      exitCode = await handleHealthCommand({
        positional: [],
        flags: { dir: harness.tmpDir, project: "nonexistent" },
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    expect(exitCode).toBe(1);
    const errText = errs.join("\n");
    expect(errText).toContain('no memories for project "nonexistent"');
    expect(errText).toContain("alpha");
    expect(errText).toContain("beta");
  });

  it("labels the report with the canonical name and notes the requested form", async () => {
    const logs: string[] = [];
    const errs: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => errs.push(args.map(String).join(" "));
    try {
      await handleHealthCommand({
        positional: [],
        flags: { dir: harness.tmpDir, project: "ALPHA" },
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    // The note rides the error stream so --json stdout stays parseable.
    expect(errs.join("\n")).toContain('(requested "ALPHA")');
    expect(errs.join("\n")).not.toContain("Error:");
    // The report itself never echoes the caller's casing (no more lying label).
    expect(logs.join("\n")).not.toContain("ALPHA");
    expect(logs.join("\n")).toContain("alpha");
  });
});

describe("T-406: MCP muse_health resolves and fails loud", () => {
  let harness: ReturnType<typeof seedStore>;

  beforeEach(() => {
    harness = seedStore(["alpha", "beta"]);
  });

  afterEach(() => {
    rmSync(harness.tmpDir, { recursive: true, force: true });
  });

  const getCallHandler = () => {
    const server = createServer(harness.tmpDir, "full");
    return (server as any)._requestHandlers.get("tools/call") as (
      req: unknown,
    ) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;
  };

  it("serves the canonical report for a case-insensitive request", async () => {
    const callHandler = getCallHandler();
    const res = await callHandler({
      method: "tools/call",
      params: {
        name: "muse_health",
        arguments: { dir: harness.tmpDir, project: "ALPHA" },
      },
    });

    expect(res.isError).toBeFalsy();
    const report = JSON.parse(res.content[0].text) as { project: string; scope: { entry_count: number } };
    expect(report.project).toBe("alpha");
    expect(report.scope.entry_count).toBe(1);
  });

  it("returns no memories-for-project error for an unknown project", async () => {
    const callHandler = getCallHandler();
    const res = await callHandler({
      method: "tools/call",
      params: {
        name: "muse_health",
        arguments: { dir: harness.tmpDir, project: "nonexistent" },
      },
    });

    expect(res.isError).toBe(true);
    const text = res.content[0].text;
    expect(text).toContain('no memories for project "nonexistent"');
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
  });
});

describe("T-406: Studio /api/health resolves and fails loud", () => {
  let harness: ReturnType<typeof seedStore>;

  beforeEach(() => {
    harness = seedStore(["alpha", "beta"]);
  });

  afterEach(() => {
    rmSync(harness.tmpDir, { recursive: true, force: true });
  });

  it("returns the canonical report for a case-insensitive query param", async () => {
    const srv = await startUiServer({ port: 0, memoryDir: harness.memoryDir, store: harness.store });
    try {
      const res = await fetch(`http://localhost:${srv.port}/api/health?project=ALPHA`);
      const report = (await res.json()) as { project: string; scope: { entry_count: number } };
      expect(report.project).toBe("alpha");
      expect(report.scope.entry_count).toBe(1);
    } finally {
      srv.close();
    }
  });

  it("returns 404 with an explicit error for an unknown project", async () => {
    const srv = await startUiServer({ port: 0, memoryDir: harness.memoryDir, store: harness.store });
    try {
      const res = await fetch(`http://localhost:${srv.port}/api/health?project=nonexistent`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain('no memories for project "nonexistent"');
      expect(body.error).toContain("alpha");
      expect(body.error).toContain("beta");
    } finally {
      srv.close();
    }
  });
});
