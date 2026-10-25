import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, save } from "../src/store.ts";
import { createCodeAnchor } from "../src/anchors/index.ts";
import { createServer } from "../src/mcp.ts";
import { startUiServer } from "../src/ui.ts";
import type { MemoryEntry } from "../src/types.ts";

/**
 * Issue #327 — T-406 fan-out: the audit surfaces that gained a project scope
 * (T-321) still passed the caller's string straight into their gate, so a
 * case-mismatched request silently produced an empty report and an unknown
 * project silently produced one too. This diff wires the single resolution
 * owner (resolveProjectName, src/health/resolve.ts) into the four MCP tools
 * (muse_tech_debt, memory_anchor_audit, memory_drift_audit, muse_bug_clusters)
 * and the three studio routes (/api/drift, /api/cognition/clusters,
 * /api/cognition/debt): a mixed-case request resolves to the canonical store
 * spelling; an unknown project fails loud instead of reporting empty.
 *
 * The gates themselves stay pure exact-canonical reporters —
 * test/health_project_scope_surfaces.test.ts and health_project_scope.test.ts
 * pass unmodified. muse_health / CLI health / /api/health were already wired
 * by T-406 (test/health_project_resolution.test.ts) and are not re-tested here.
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

const FANOUT_MCP_TOOLS = [
  "muse_tech_debt",
  "memory_anchor_audit",
  "memory_drift_audit",
  "muse_bug_clusters",
] as const;

const FANOUT_ROUTES = ["/api/drift", "/api/cognition/clusters", "/api/cognition/debt"] as const;

describe("T-406 fan-out (issue #327): audit surfaces resolve and fail loud", () => {
  let tmpDir: string;
  let memoryDir: string;
  let store: ReturnType<typeof openStore>;
  let codeDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-t406-fanout-"));
    memoryDir = join(tmpDir, ".memory");
    store = openStore(memoryDir);
    codeDir = join(tmpDir, "src");
    mkdirSync(codeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * alpha owns one VALID anchor and one DRIFTED anchor, beta owns one DRIFTED
   * anchor; both projects record one bug-tagged fix entry. Every audited gate
   * therefore has alpha-shaped data: anchors see alpha's two anchors, drift
   * and debt see alpha's drifted anchor, and clusters see alpha's fix entry.
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

    saveEntry({ id: "m_alpha_anchored", project: "alpha", type: "fix", tags: ["bug"], anchors: [alphaAnchor, alphaDriftedAnchor] });
    saveEntry({ id: "m_beta_anchored", project: "beta", type: "fix", tags: ["bug"], anchors: [betaAnchor] });

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

  function saveEntry(partial: Partial<MemoryEntry> & { id: string; project: string }): void {
    save(store, entry(partial));
  }

  describe("MCP tools", () => {
    const getCallHandler = () => {
      const server = createServer(tmpDir, "full");
      return (server as any)._requestHandlers.get("tools/call") as (
        req: unknown,
      ) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;
    };

    for (const tool of FANOUT_MCP_TOOLS) {
      it(`${tool}: a mixed-case project argument resolves to the canonical scope`, async () => {
        seedTwoProjects();
        const callHandler = getCallHandler();
        const canonical = await callHandler({
          method: "tools/call",
          params: { name: tool, arguments: { project: "alpha" } },
        });
        const requested = await callHandler({
          method: "tools/call",
          params: { name: tool, arguments: { project: "ALPHA" } },
        });

        expect(canonical.isError).toBeFalsy();
        expect(requested.isError).toBeFalsy();
        // Case-insensitive resolution: the caller's casing cannot change the
        // report compared to the canonical request.
        const canonicalReport = JSON.parse(canonical.content[0].text);
        expect(JSON.parse(requested.content[0].text)).toEqual(canonicalReport);
      });

      it(`${tool}: an unknown project fails loud with the available names`, async () => {
        seedTwoProjects();
        const callHandler = getCallHandler();
        const res = await callHandler({
          method: "tools/call",
          params: { name: tool, arguments: { project: "nonexistent" } },
        });

        expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain('no memories for project "nonexistent"');
        expect(res.content[0].text).toContain("alpha");
        expect(res.content[0].text).toContain("beta");
      });
    }

    it("muse_tech_debt scoped to alpha reports alpha's debt only", async () => {
      seedTwoProjects();
      const callHandler = getCallHandler();
      const res = await callHandler({
        method: "tools/call",
        params: { name: "muse_tech_debt", arguments: { project: "alpha" } },
      });
      const report = JSON.parse(res.content[0].text) as { items: Array<{ id: string }> };
      const ids = report.items.map((i) => String(i.id));
      expect(ids.some((id) => id.includes("m_alpha_anchored"))).toBe(true);
      expect(ids.some((id) => id.includes("m_beta_anchored"))).toBe(false);
    });

    it("memory_drift_audit scoped to alpha reports alpha's drift only", async () => {
      seedTwoProjects();
      const callHandler = getCallHandler();
      const res = await callHandler({
        method: "tools/call",
        params: { name: "memory_drift_audit", arguments: { project: "alpha" } },
      });
      const report = JSON.parse(res.content[0].text) as { items: Array<{ id: string }> };
      const ids = report.items.map((i) => String(i.id));
      expect(ids.some((id) => id.includes("m_alpha_anchored"))).toBe(true);
      expect(ids.some((id) => id.includes("m_beta_anchored"))).toBe(false);
    });

    it("muse_bug_clusters scoped to alpha keeps alpha's fix entry", async () => {
      seedTwoProjects();
      const callHandler = getCallHandler();
      const res = await callHandler({
        method: "tools/call",
        params: { name: "muse_bug_clusters", arguments: { project: "alpha" } },
      });
      const report = JSON.parse(res.content[0].text) as { total_clusters: number };
      expect(report.total_clusters).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Studio API endpoints", () => {
    for (const route of FANOUT_ROUTES) {
      it(`GET ${route}: a mixed-case project param resolves to the canonical payload`, async () => {
        seedTwoProjects();
        const srv = await startUiServer({ port: 0, memoryDir, store });
        try {
          const canonicalRes = await fetch(`http://localhost:${srv.port}${route}?project=alpha`);
          expect(canonicalRes.status).toBe(200);
          const canonicalPayload = await canonicalRes.json();
          const requestedRes = await fetch(`http://localhost:${srv.port}${route}?project=ALPHA`);
          expect(requestedRes.status).toBe(200);
          // Case-insensitive resolution: the caller's casing cannot change
          // the payload compared to the canonical request.
          expect(await requestedRes.json()).toEqual(canonicalPayload);
        } finally {
          srv.close();
        }
      });

      it(`GET ${route}: an unknown project answers 404 with the available names`, async () => {
        seedTwoProjects();
        const srv = await startUiServer({ port: 0, memoryDir, store });
        try {
          const res = await fetch(`http://localhost:${srv.port}${route}?project=nonexistent`);
          expect(res.status).toBe(404);
          const body = (await res.json()) as { error?: string };
          expect(body.error).toContain('no memories for project "nonexistent"');
          expect(body.error).toContain("alpha");
          expect(body.error).toContain("beta");
        } finally {
          srv.close();
        }
      });
    }
  });
});
