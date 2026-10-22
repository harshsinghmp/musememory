import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, save } from "../src/store.ts";
import { createCodeAnchor } from "../src/anchors/index.ts";
import { createServer } from "../src/mcp.ts";
import { startUiServer } from "../src/ui.ts";
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

/**
 * T-321 follow-up: the audit surfaces that still ignored the project filter.
 *
 * The health gate, bug clusters and technical debt already accepted
 * `options.project`, but five surfaces that expose those functions never
 * plumbed it through: the MCP `memory_anchor_audit` / `memory_drift_audit`
 * tools and the Studio `/api/drift`, `/api/cognition/clusters` and
 * `/api/cognition/debt` endpoints. These tests pin the plumbing so a user
 * can actually scope an audit to one memory project.
 */
describe("T-321 follow-up: project scope on the remaining audit surfaces", () => {
  let tmpDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;
  let codeDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-t321-surfaces-"));
    memoryDir = join(tmpDir, ".memory");
    store = openStore(memoryDir);
    codeDir = join(tmpDir, "src");
    mkdirSync(codeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * alpha owns one VALID anchor and one DRIFTED anchor, beta owns one
   * DRIFTED anchor. All three are recorded as bug fixes so they also show up
   * in the bug-cluster audit.
   *
   * A whole-store audit therefore sees three anchors (two of them drifted)
   * and both projects' bug clusters. A project-scoped audit to "alpha" must
   * see alpha's two anchors, alpha's drift items and alpha's clusters only.
   */
  function seedTwoProjects(): void {
    writeFileSync(join(codeDir, "alpha.ts"), `export function alphaHandler() { return "alpha"; }\n`);
    writeFileSync(
      join(codeDir, "alpha_legacy.ts"),
      `export function alphaLegacy() { return "legacy"; }\n`
    );
    writeFileSync(join(codeDir, "beta.ts"), `export function betaHandler() { return "beta"; }\n`);

    const alphaAnchor = createCodeAnchor(tmpDir, {
      kind: "symbol",
      filePath: "src/alpha.ts",
      symbolName: "alphaHandler",
    });
    const alphaDriftedAnchor = createCodeAnchor(tmpDir, {
      kind: "symbol",
      filePath: "src/alpha_legacy.ts",
      symbolName: "alphaLegacy",
    });
    const betaAnchor = createCodeAnchor(tmpDir, {
      kind: "symbol",
      filePath: "src/beta.ts",
      symbolName: "betaHandler",
    });

    save(
      store,
      entry({
        id: "m_alpha_anchored",
        project: "alpha",
        type: "fix",
        tags: ["bug"],
        anchors: [alphaAnchor, alphaDriftedAnchor],
      })
    );
    save(
      store,
      entry({
        id: "m_beta_anchored",
        project: "beta",
        type: "fix",
        tags: ["bug"],
        anchors: [betaAnchor],
      })
    );

    // Mutate the legacy and beta sources so those anchors drift.
    writeFileSync(
      join(codeDir, "alpha_legacy.ts"),
      `export function alphaLegacy(flag: boolean) { return flag ? "legacy" : "none"; }\n`
    );
    writeFileSync(
      join(codeDir, "beta.ts"),
      `export function betaHandler(flag: boolean) { return flag ? "beta" : "none"; }\n`
    );
  }

  function mcpCallHandler(tmpDirPath: string) {
    const server = createServer(tmpDirPath, "full");
    return (server as any)._requestHandlers.get("tools/call");
  }

  describe("MCP tools", () => {
    it("memory_anchor_audit scopes the anchor audit to the requested project", async () => {
      seedTwoProjects();
      const callHandler = mcpCallHandler(tmpDir);

      const scopedRes = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_anchor_audit",
          arguments: { dir: tmpDir, project: "alpha" },
        },
      });

      expect(scopedRes.isError).toBeFalsy();
      const scoped = JSON.parse(scopedRes.content[0].text);

      // Only alpha's anchors are audited — beta's drifted anchor is out of scope.
      expect(scoped.total_anchors).toBe(2);
      expect(scoped.valid_anchors).toBe(1);
      expect(scoped.drifted_anchors).toBe(1);
      expect(scoped.details.length).toBe(2);
      expect(scoped.details.every((d: any) => d.memory_id === "m_alpha_anchored")).toBe(true);

      const allRes = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_anchor_audit",
          arguments: { dir: tmpDir },
        },
      });

      expect(allRes.isError).toBeFalsy();
      const all = JSON.parse(allRes.content[0].text);

      // Without a project filter the audit still covers the whole store.
      expect(all.total_anchors).toBe(3);
      expect(all.drifted_anchors).toBe(2);
      const memoryIds = all.details.map((d: any) => d.memory_id);
      expect(memoryIds).toContain("m_alpha_anchored");
      expect(memoryIds).toContain("m_beta_anchored");
    });

    it("memory_drift_audit scopes the drift audit to the requested project", async () => {
      seedTwoProjects();
      const callHandler = mcpCallHandler(tmpDir);

      const scopedRes = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_drift_audit",
          arguments: { dir: tmpDir, project: "alpha" },
        },
      });

      expect(scopedRes.isError).toBeFalsy();
      const scoped = JSON.parse(scopedRes.content[0].text);
      const scopedItemIds = scoped.items.map((i: any) => i.id as string);

      expect(scopedItemIds.some((id: string) => id.includes("m_alpha_anchored"))).toBe(true);
      expect(scopedItemIds.some((id: string) => id.includes("m_beta_anchored"))).toBe(false);

      const allRes = await callHandler({
        method: "tools/call",
        params: {
          name: "memory_drift_audit",
          arguments: { dir: tmpDir },
        },
      });

      expect(allRes.isError).toBeFalsy();
      const all = JSON.parse(allRes.content[0].text);
      const allItemIds = all.items.map((i: any) => i.id as string);

      expect(allItemIds.some((id: string) => id.includes("m_alpha_anchored"))).toBe(true);
      expect(allItemIds.some((id: string) => id.includes("m_beta_anchored"))).toBe(true);
    });

    it("exposes a `project` property on both audit tool schemas", async () => {
      const server = createServer(tmpDir, "full");
      const listHandler = (server as any)._requestHandlers.get("tools/list");

      const response = await listHandler({ method: "tools/list", params: {} });
      const tools = response.tools as Array<{
        name: string;
        inputSchema: { properties?: Record<string, { type?: string; description?: string }> };
      }>;

      for (const name of ["memory_anchor_audit", "memory_drift_audit"]) {
        const tool = tools.find((t) => t.name === name);
        expect(tool).toBeDefined();
        const project = tool!.inputSchema.properties?.project;
        expect(project).toBeDefined();
        expect(project!.type).toBe("string");
        // Same wording as muse_health / muse_tech_debt / muse_bug_clusters.
        expect(project!.description).toBe("Optional memory project scope filter");
      }
    });
  });

  describe("Studio API endpoints", () => {
    it("GET /api/drift scopes the drift result to the requested project", async () => {
      seedTwoProjects();
      const srv = await startUiServer({ port: 0, memoryDir, store });

      try {
        const scoped = (await (
          await fetch(`http://localhost:${srv.port}/api/drift?project=alpha`)
        ).json()) as any;
        const scopedItemIds = scoped.items.map((i: any) => i.id as string);

        expect(scopedItemIds.some((id: string) => id.includes("m_alpha_anchored"))).toBe(true);
        expect(scopedItemIds.some((id: string) => id.includes("m_beta_anchored"))).toBe(false);

        const all = (await (await fetch(`http://localhost:${srv.port}/api/drift`)).json()) as any;
        const allItemIds = all.items.map((i: any) => i.id as string);

        expect(allItemIds.some((id: string) => id.includes("m_alpha_anchored"))).toBe(true);
        expect(allItemIds.some((id: string) => id.includes("m_beta_anchored"))).toBe(true);
      } finally {
        srv.close();
      }
    });

    it("GET /api/cognition/clusters scopes the clusters result to the requested project", async () => {
      seedTwoProjects();
      const srv = await startUiServer({ port: 0, memoryDir, store });

      try {
        const scoped = (await (
          await fetch(`http://localhost:${srv.port}/api/cognition/clusters?project=alpha`)
        ).json()) as any;
        const scopedIds = scoped.clusters.flatMap((c: any) =>
          c.sample_fixes.map((f: any) => f.id as string)
        );

        expect(scopedIds).toContain("m_alpha_anchored");
        expect(scopedIds).not.toContain("m_beta_anchored");

        const all = (await (
          await fetch(`http://localhost:${srv.port}/api/cognition/clusters`)
        ).json()) as any;
        const allIds = all.clusters.flatMap((c: any) => c.sample_fixes.map((f: any) => f.id as string));

        expect(allIds).toContain("m_alpha_anchored");
        expect(allIds).toContain("m_beta_anchored");
      } finally {
        srv.close();
      }
    });

    it("GET /api/cognition/debt scopes the debt result to the requested project", async () => {
      seedTwoProjects();
      const srv = await startUiServer({ port: 0, memoryDir, store });

      try {
        const scoped = (await (
          await fetch(`http://localhost:${srv.port}/api/cognition/debt?project=alpha`)
        ).json()) as any;
        const scopedIds = scoped.items.map((i: any) => i.id as string);

        // Alpha's own drifted anchor is reported as memory-derived debt.
        expect(scopedIds.some((id: string) => id.includes("m_alpha_anchored"))).toBe(true);
        // Beta's debt is out of scope.
        expect(scopedIds.some((id: string) => id.includes("m_beta_anchored"))).toBe(false);

        const all = (await (await fetch(`http://localhost:${srv.port}/api/cognition/debt`)).json()) as any;
        const allIds = all.items.map((i: any) => i.id as string);

        // Beta's anchor drifted, so it is reported as memory-derived debt.
        expect(allIds.some((id: string) => id.includes("m_beta_anchored"))).toBe(true);
        expect(allIds.some((id: string) => id.includes("m_alpha_anchored"))).toBe(true);
      } finally {
        srv.close();
      }
    });
  });

  describe("Studio project scope control", () => {
    it("serves a labelled project control that drives the scoped fetches", async () => {
      const srv = await startUiServer({ port: 0, memoryDir, store });

      try {
        const html = await (await fetch(`http://localhost:${srv.port}/`)).text();

        // A real <label for="..."> — a placeholder is not a label (WCAG 2.2 AA).
        expect(html).toMatch(/<label[^>]*\sfor="projectFilter"/);
        expect(html).toMatch(/<input[^>]*\sid="projectFilter"/);

        // The control drives the scoped query string.
        expect(html).toContain("projectScopeQuery");
        expect(html).toContain("encodeURIComponent");
        expect(html).toContain("'/api/health' + projectScopeQuery()");
        expect(html).toContain("'/api/drift' + projectScopeQuery()");
        expect(html).toContain("'/api/cognition/clusters' + projectScopeQuery()");
        expect(html).toContain("'/api/cognition/debt' + projectScopeQuery()");

        // The scope the user is looking at is surfaced back to them.
        expect(html).toContain('id="healthScope"');
        expect(html).toContain("formatHealthScope");
      } finally {
        srv.close();
      }
    });
  });
});
