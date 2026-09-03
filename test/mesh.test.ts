import { describe, test, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { openStore, propose, list } from "../src/store.ts";
import {
  discoverWorkspaceMesh,
  addMeshLink,
  removeMeshLink,
  listMeshLinks,
  resolveMeshMemories,
  propagateConstraintToMesh,
  auditMeshContracts,
} from "../src/mesh/index.ts";
import { createServer } from "../src/mcp.ts";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { handleMeshCommand } from "../src/cli/mesh.ts";
import type { ParsedArgs } from "../src/cli/shared.ts";

function setupMonorepoFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-mesh-monorepo-"));
  
  // 1. Root pnpm-workspace.yaml
  fs.writeFileSync(
    path.join(root, "pnpm-workspace.yaml"),
    "packages:\n  - 'packages/*'\n",
    "utf-8"
  );
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "my-monorepo-root", private: true }, null, 2),
    "utf-8"
  );

  // 2. packages/core
  const coreDir = path.join(root, "packages", "core");
  fs.mkdirSync(coreDir, { recursive: true });
  fs.writeFileSync(
    path.join(coreDir, "package.json"),
    JSON.stringify({
      name: "@mesh/core",
      version: "1.0.0",
      main: "./index.ts",
    }, null, 2),
    "utf-8"
  );
  fs.writeFileSync(path.join(coreDir, "index.ts"), "export function connectDb() { return 'connected'; }", "utf-8");
  const coreStore = openStore(path.join(coreDir, ".memory"));
  propose(coreStore, {
    title: "Database connection pool invariants",
    content: "Connection pool max is 50, idle timeout is 30s. Never bypass pooling.",
    project: "@mesh/core",
    type: "constraint",
    confirmed: true,
    tags: ["database", "pool", "mesh-test"],
  });

  // 3. packages/app
  const appDir = path.join(root, "packages", "app");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify({
      name: "@mesh/app",
      version: "1.0.0",
      main: "./index.ts",
      dependencies: {
        "@mesh/core": "1.0.0",
      },
    }, null, 2),
    "utf-8"
  );
  fs.writeFileSync(path.join(appDir, "index.ts"), "import { connectDb } from '@mesh/core';", "utf-8");
  const appStore = openStore(path.join(appDir, ".memory"));
  propose(appStore, {
    title: "Frontend auth middleware token validation",
    content: "Validates JWT tokens before forwarding to core service layer.",
    project: "@mesh/app",
    type: "architecture",
    confirmed: true,
    tags: ["auth", "token", "mesh-test"],
  });

  // 4. Standalone external repo
  const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-mesh-external-"));
  fs.writeFileSync(
    path.join(extDir, "package.json"),
    JSON.stringify({ name: "external-service", version: "1.0.0" }, null, 2),
    "utf-8"
  );
  const extStore = openStore(path.join(extDir, ".memory"));
  propose(extStore, {
    title: "External billing integration contract",
    content: "Stripe webhook signature validation must run with raw bytes body.",
    project: "external-service",
    type: "decision",
    confirmed: true,
    tags: ["billing", "stripe"],
  });

  const appMemoryDir = path.join(appDir, ".memory");
  const coreMemoryDir = path.join(coreDir, ".memory");
  return { root, coreDir, coreStore, coreMemoryDir, appDir, appStore, appMemoryDir, extDir, extStore };
}

describe("R16: Multi-Repo & Monorepo Cross-Project Mesh", () => {
  test("Workspace Monorepo Discovery detects workspace type and package nodes", () => {
    const fixture = setupMonorepoFixture();
    try {
      const topology = discoverWorkspaceMesh(fixture.appDir, fixture.appMemoryDir);

      expect(topology.isMonorepo).toBe(true);
      expect(topology.workspaceType).toBe("pnpm");
      expect(topology.rootPath).toBe(fixture.root);
      expect(topology.nodes.length).toBeGreaterThanOrEqual(3); // root, @mesh/core, @mesh/app

      const appNode = topology.nodes.find((n) => n.name === "@mesh/app");
      expect(appNode).toBeDefined();
      expect(appNode!.isCurrent).toBe(true);
      expect(appNode!.dependencies).toContain("@mesh/core");
      expect(appNode!.hasStore).toBe(true);

      const coreNode = topology.nodes.find((n) => n.name === "@mesh/core");
      expect(coreNode).toBeDefined();
      expect(coreNode!.hasStore).toBe(true);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
      fs.rmSync(fixture.extDir, { recursive: true, force: true });
    }
  });

  test("Explicit Mesh Linking links and unlinks external repository paths", () => {
    const fixture = setupMonorepoFixture();
    try {
      // Initially no external links
      expect(listMeshLinks(fixture.appMemoryDir)).toEqual([]);

      // Link external repo
      addMeshLink(fixture.appMemoryDir, fixture.extDir);
      expect(listMeshLinks(fixture.appMemoryDir)).toContain(path.resolve(fixture.extDir));

      // Re-run discovery: external repo should be included in topology
      const topology = discoverWorkspaceMesh(fixture.appDir, fixture.appMemoryDir);
      const extNode = topology.nodes.find((n) => n.path === path.resolve(fixture.extDir));
      expect(extNode).toBeDefined();
      expect(extNode!.nodeType).toBe("linked_repo");

      // Unlink external repo
      removeMeshLink(fixture.appMemoryDir, fixture.extDir);
      expect(listMeshLinks(fixture.appMemoryDir)).toEqual([]);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
      fs.rmSync(fixture.extDir, { recursive: true, force: true });
    }
  });

  test("resolveMeshMemories executes cross-project queries across monorepo packages", () => {
    const fixture = setupMonorepoFixture();
    try {
      const topology = discoverWorkspaceMesh(fixture.appDir, fixture.appMemoryDir);

      // Query from appStore: search for "connection pool"
      const results = resolveMeshMemories(fixture.appStore, topology, {
        query: "connection pool",
      });

      expect(results.length).toBeGreaterThan(0);
      const topMatch = results[0];
      expect(topMatch.originProject).toBe("@mesh/core");
      expect(topMatch.memory.title).toContain("Database connection pool");
      expect(topMatch.sourceNode.name).toBe("@mesh/core");

      // Filter by targetProjects: ["@mesh/app"]
      const appOnlyResults = resolveMeshMemories(fixture.appStore, topology, {
        query: "mesh-test",
        targetProjects: ["@mesh/app"],
      });
      expect(appOnlyResults.every((r) => r.originProject === "@mesh/app")).toBe(true);

      // Filter by type: ["architecture"]
      const archResults = resolveMeshMemories(fixture.appStore, topology, {
        types: ["architecture"],
      });
      expect(archResults.every((r) => r.memory.type === "architecture")).toBe(true);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
      fs.rmSync(fixture.extDir, { recursive: true, force: true });
    }
  });

  test("propagateConstraintToMesh broadcasts shared invariants across all package stores", () => {
    const fixture = setupMonorepoFixture();
    try {
      const topology = discoverWorkspaceMesh(fixture.appDir, fixture.appMemoryDir);

      const propReport = propagateConstraintToMesh(fixture.appStore, topology, {
        title: "Zero Secret Exposure (LifeOS Vibeguard)",
        content: "Never commit API keys, tokens or credentials in any package.",
        tags: ["security", "vibeguard"],
      });

      expect(propReport.propagatedNodes).toContain("@mesh/app");
      expect(propReport.propagatedNodes).toContain("@mesh/core");

      // Verify core store now contains the propagated constraint
      const coreEntries = list(fixture.coreStore);
      const foundInCore = coreEntries.find((e) => e.title.includes("Zero Secret Exposure"));
      expect(foundInCore).toBeDefined();
      expect(foundInCore!.type).toBe("constraint");
      expect(foundInCore!.tags).toContain("mesh-shared-constraint");
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
      fs.rmSync(fixture.extDir, { recursive: true, force: true });
    }
  });

  test("auditMeshContracts audits cross-package dependency contracts and flags drift", () => {
    const fixture = setupMonorepoFixture();
    try {
      const topology = discoverWorkspaceMesh(fixture.appDir, fixture.appMemoryDir);

      // 1. Initial valid audit: @mesh/app depends on @mesh/core (index.ts exists)
      const auditValid = auditMeshContracts(topology, fixture.appStore);
      expect(auditValid.total_contracts_checked).toBeGreaterThanOrEqual(1);
      expect(auditValid.broken_contracts).toBe(0);
      expect(auditValid.valid_contracts).toBeGreaterThanOrEqual(1);

      // 2. Introduce broken contract: remove index.ts in @mesh/core
      fs.unlinkSync(path.join(fixture.coreDir, "index.ts"));
      const auditBroken = auditMeshContracts(topology, fixture.appStore);
      expect(auditBroken.broken_contracts).toBeGreaterThan(0);
      const brokenItem = auditBroken.items.find((i) => i.status === "drifted" || i.status === "missing");
      expect(brokenItem).toBeDefined();
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
      fs.rmSync(fixture.extDir, { recursive: true, force: true });
    }
  });

  test("CLI memory mesh commands (overview, query, check, link, propagate)", async () => {
    const fixture = setupMonorepoFixture();
    try {
      const flags: Record<string, string> = {
        dir: fixture.appDir,
        json: "true",
      };

      // 1. Overview
      const capturedOverview: string[] = [];
      const origLog = console.log;
      console.log = (...args) => capturedOverview.push(args.join(" "));
      const overviewCode = await handleMeshCommand({
        positional: ["mesh"],
        flags,
      });
      console.log = origLog;
      expect(overviewCode).toBe(0);
      const parsedOverview = JSON.parse(capturedOverview[0]);
      expect(parsedOverview.isMonorepo).toBe(true);

      // 2. Query
      const capturedQuery: string[] = [];
      console.log = (...args) => capturedQuery.push(args.join(" "));
      const queryCode = await handleMeshCommand({
        positional: ["mesh", "query", "database"],
        flags,
      });
      console.log = origLog;
      expect(queryCode).toBe(0);
      const parsedQuery = JSON.parse(capturedQuery[0]);
      expect(Array.isArray(parsedQuery)).toBe(true);
      expect(parsedQuery.length).toBeGreaterThan(0);

      // 3. Link
      const linkCode = await handleMeshCommand({
        positional: ["mesh", "link", fixture.extDir],
        flags,
      });
      expect(linkCode).toBe(0);

      // 4. Check
      const capturedCheck: string[] = [];
      console.log = (...args) => capturedCheck.push(args.join(" "));
      const checkCode = await handleMeshCommand({
        positional: ["mesh", "check"],
        flags,
      });
      console.log = origLog;
      expect(checkCode).toBe(0);
      const parsedCheck = JSON.parse(capturedCheck[0]);
      expect(parsedCheck).toHaveProperty("total_contracts_checked");

      // 5. Propagate
      const propCode = await handleMeshCommand({
        positional: ["mesh", "propagate"],
        flags: { ...flags, title: "Monorepo invariant", content: "Strict testing" },
      });
      expect(propCode).toBe(0);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
      fs.rmSync(fixture.extDir, { recursive: true, force: true });
    }
  });

  test("MCP Tools execute muse_mesh_status, muse_mesh_query, muse_mesh_audit, and muse_mesh_link", async () => {
    const fixture = setupMonorepoFixture();
    try {
      const server = createServer(fixture.appDir, "full");
      const handler = (server as any)._requestHandlers.get("tools/call");
      expect(handler).toBeDefined();

      // 1. muse_mesh_status
      const statusRes = await handler({
        method: "tools/call",
        params: { name: "muse_mesh_status", arguments: { dir: fixture.appDir } },
      });
      const statusData = JSON.parse(statusRes.content[0].text);
      expect(statusData.isMonorepo).toBe(true);
      expect(statusData.nodes.length).toBeGreaterThanOrEqual(2);

      // 2. muse_mesh_query
      const queryRes = await handler({
        method: "tools/call",
        params: { name: "muse_mesh_query", arguments: { query: "pool", dir: fixture.appDir } },
      });
      const queryData = JSON.parse(queryRes.content[0].text);
      expect(queryData.total_found).toBeGreaterThan(0);

      // 3. muse_mesh_audit
      const auditRes = await handler({
        method: "tools/call",
        params: { name: "muse_mesh_audit", arguments: { dir: fixture.appDir } },
      });
      const auditData = JSON.parse(auditRes.content[0].text);
      expect(auditData).toHaveProperty("total_contracts_checked");

      // 4. muse_mesh_link
      const linkRes = await handler({
        method: "tools/call",
        params: { name: "muse_mesh_link", arguments: { action: "link", path: fixture.extDir, dir: fixture.appDir } },
      });
      const linkData = JSON.parse(linkRes.content[0].text);
      expect(linkData.success).toBe(true);
      expect(linkData.action).toBe("linked");
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
      fs.rmSync(fixture.extDir, { recursive: true, force: true });
    }
  });
});
