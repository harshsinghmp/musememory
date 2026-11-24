import { describe, test, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { discoverWorkspaceMesh, listMeshLinks } from "../src/mesh/index.ts";
import { getAuditTrail } from "../src/audit.ts";
import { createServer } from "../src/mcp.ts";
import { openStore, propose } from "../src/store.ts";

const FLAG = "MUSE_MESH_AUTO_DISCOVER";

/**
 * #452: a plain `~/projects/<clientA>` + `~/projects/<clientB>` layout. Both
 * siblings carry a memory store, so pre-fix discovery adopted clientB without
 * anyone asking for it.
 */
function makeSiblingFixture(): { root: string; clientA: string; clientB: string; memoryA: string; memoryB: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-mesh-isolation-"));
  const clientA = path.join(root, "clientA");
  const clientB = path.join(root, "clientB");
  const memoryA = path.join(clientA, ".memory");
  const memoryB = path.join(clientB, ".memory");

  for (const [dir, memoryDir] of [
    [clientA, memoryA],
    [clientB, memoryB],
  ] as const) {
    fs.mkdirSync(path.join(memoryDir, "memories"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: path.basename(dir) }), "utf-8");
  }

  const storeB = openStore(memoryB);
  propose(storeB, {
    title: "Client B pricing formula",
    content: "Client B's private margin formula must never be readable from client A's workspace.",
    project: "clientB",
    type: "decision",
    confirmed: true,
  });

  return { root, clientA, clientB, memoryA, memoryB };
}

function withFlag<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG];
  else process.env[FLAG] = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  }
}

describe("#452 mesh discovery is opt-in", () => {
  test("without MUSE_MESH_AUTO_DISCOVER a sibling with a .memory store is not discovered", () => {
    const fixture = makeSiblingFixture();
    try {
      const topology = withFlag(undefined, () => discoverWorkspaceMesh(fixture.clientA, fixture.memoryA));

      expect(topology.nodes.map((n) => n.path)).toEqual([fixture.clientA]);
      expect(topology.nodes.some((n) => n.path === fixture.clientB)).toBe(false);
      expect(topology.workspaceType).not.toBe("multi_repo");
      expect(topology.linkedPaths).toEqual([]);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("MUSE_MESH_AUTO_DISCOVER=1 opts back in to sibling discovery", () => {
    const fixture = makeSiblingFixture();
    try {
      const topology = withFlag("1", () => discoverWorkspaceMesh(fixture.clientA, fixture.memoryA));

      expect(topology.nodes.map((n) => n.path)).toContain(fixture.clientB);
      expect(topology.workspaceType).toBe("multi_repo");
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("an explicit mesh_links.json entry still admits the sibling without the flag", () => {
    const fixture = makeSiblingFixture();
    try {
      fs.writeFileSync(
        path.join(fixture.memoryA, "mesh_links.json"),
        JSON.stringify({ linked: [fixture.clientB], updatedAt: new Date().toISOString() }, null, 2),
        "utf-8",
      );

      const topology = withFlag(undefined, () => discoverWorkspaceMesh(fixture.clientA, fixture.memoryA));

      expect(topology.nodes.map((n) => n.path)).toContain(fixture.clientB);
      expect(topology.linkedPaths).toEqual([fixture.clientB]);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

describe("#452 muse_mesh_link is explicit and audited", () => {
  test("linking without confirm is rejected and writes nothing", async () => {
    const fixture = makeSiblingFixture();
    try {
      const server = createServer(fixture.clientA);
      const callTool = (server as any)._requestHandlers.get("tools/call");

      const res = await callTool({
        method: "tools/call",
        params: { name: "muse_mesh_link", arguments: { path: fixture.clientB, dir: fixture.clientA } },
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("confirm: true");
      expect(listMeshLinks(fixture.memoryA)).toEqual([]);
      expect(fs.existsSync(path.join(fixture.memoryA, "mesh_links.json"))).toBe(false);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("confirm: true stores the link and records an audit event with the path and actor", async () => {
    const fixture = makeSiblingFixture();
    try {
      const server = createServer(fixture.clientA);
      const callTool = (server as any)._requestHandlers.get("tools/call");

      const res = await callTool({
        method: "tools/call",
        params: {
          name: "muse_mesh_link",
          arguments: { path: fixture.clientB, confirm: true, dir: fixture.clientA },
        },
      });

      expect(res.isError).toBeFalsy();
      const payload = JSON.parse(res.content[0].text);
      expect(payload.success).toBe(true);
      expect(payload.action).toBe("linked");
      expect(listMeshLinks(fixture.memoryA)).toContain(fixture.clientB);

      const linkEvents = getAuditTrail(fixture.memoryA, { operation: "link" });
      const event = linkEvents.find((e) => e.details?.path === fixture.clientB);
      expect(event).toBeDefined();
      expect(event!.actor).toBe("mcp");
      expect(event!.details?.action).toBe("link");
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
