import { describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, save, get } from "../src/store.ts";
import { createServer } from "../src/mcp.ts";
import { buildHookEntry } from "../src/hooks/pack.ts";

describe("W26-3: pre-flight hook and MCP surface", () => {
  test("PreToolUse hook entry is matcher-scoped and invokes the hook command", () => {
    const entry = buildHookEntry("PreToolUse");
    expect(entry.command).toBe("memory hooks pre-tool-use");
    expect(entry.matcher).toContain("Edit");
  });

  test("muse_preflight returns risk and anchored invariants read-only", async () => {
    const root = mkdtempSync(join(tmpdir(), "muse-preflight-mcp-"));
    const memoryDir = join(root, ".memory");
    mkdirSync(memoryDir, { recursive: true });
    const store = openStore(memoryDir);
    const constraint = propose(store, { content: "auth tokens must rotate", project: "p", type: "constraint", confirmed: true });
    save(store, { ...get(store, constraint.id)!, anchors: [{ id: "a1", kind: "file", file_path: "src/auth.ts" }] });
    const before = store.db!.query<{ access_count: number }>("SELECT access_count FROM memories WHERE id = ?").get([constraint.id])?.access_count ?? 0;
    try {
      const server = createServer(root, "full");
      const call = (server as any)._requestHandlers.get("tools/call");
      const result = await call({
        method: "tools/call",
        params: { name: "muse_preflight", arguments: { dir: root, files: ["src/auth.ts"], project: "p" } },
      });
      expect(result.isError).toBeFalsy();
      const payload = JSON.parse(result.content[0].text);
      expect(payload.risk.level).toBeDefined();
      expect(payload.anchors.map((anchor: any) => anchor.id)).toContain(constraint.id);
      const after = store.db!.query<{ access_count: number }>("SELECT access_count FROM memories WHERE id = ?").get([constraint.id])?.access_count ?? 0;
      expect(after).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
