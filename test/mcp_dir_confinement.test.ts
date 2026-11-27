/**
 * #512: the `dir` argument must not be able to relocate the store anywhere.
 *
 * `resolveStoreForRequest` accepted `a.dir || a.workspace || a.project_dir ||
 * a.cwd` and handed it straight to `findOrCreateProjectRoot`, which creates
 * `.memory/` wherever it is pointed. A model — or a prompt injection — could
 * therefore name `/`, `$HOME`, or a sibling checkout and read and write there.
 * These tests exercise the real server over a real client: the request
 * directory is confined to the workspace root the server was started for, a
 * rejected directory creates nothing, the operator opt-in keeps the
 * multi-project workflow available, and a freshly created store is 0700/0600.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ALLOW_EXTERNAL_DIR_ENV, createServer } from "../src/mcp.ts";
import { realishPath } from "../src/paths.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

const root = makeTempRoot();
const outside = makeTempRoot();
let client: Client;
let disconnect: () => Promise<void>;

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
}

function textOf(result: ToolResult): string {
  return result.content.map((part) => part.text ?? "").join("\n");
}

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(root);
  await server.connect(serverTransport);

  client = new Client({ name: "mcp-dir-confinement-test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);

  disconnect = async () => {
    await client.close();
    await server.close();
  };
});

afterAll(async () => {
  delete process.env[ALLOW_EXTERNAL_DIR_ENV];
  await disconnect?.();
  cleanup(root);
  cleanup(outside);
});

describe("#512: request directories are confined to the workspace root", () => {
  test("every directory argument alias is rejected outside the root and creates nothing", async () => {
    const configuredRoot = realishPath(root);

    for (const key of ["dir", "workspace", "project_dir", "cwd"]) {
      const target = join(outside, `forbidden-${key}`);
      const result = (await client.callTool({
        name: "memory_current",
        arguments: { [key]: target },
      })) as ToolResult;

      expect(result.isError).toBe(true);
      const message = textOf(result);
      // The rejection has to name the bound the caller crossed.
      expect(message).toContain("outside the MCP workspace root");
      expect(message).toContain(configuredRoot);
      expect(message).toContain(`${ALLOW_EXTERNAL_DIR_ENV}=1`);
      // Rejected before `findOrCreateProjectRoot`: no store, no directory.
      expect(existsSync(target)).toBe(false);
      expect(existsSync(join(target, ".memory"))).toBe(false);
    }
  });

  test("a directory inside the root is still accepted", async () => {
    const inside = join(root, "packages", "inside");
    const result = (await client.callTool({
      name: "memory_current",
      arguments: { dir: inside },
    })) as ToolResult;

    expect(result.isError).toBeFalsy();
    // The ancestor scan still finds the configured store rather than forking one.
    expect(existsSync(join(root, ".memory"))).toBe(true);
  });

  test.skipIf(process.platform === "win32")(
    "a symlink inside the root cannot launder an outside directory",
    async () => {
      const link = join(root, "link-to-outside");
      symlinkSync(outside, link, "dir");

      const target = join(link, "nested");
      const result = (await client.callTool({
        name: "memory_current",
        arguments: { dir: target },
      })) as ToolResult;

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("outside the MCP workspace root");
      expect(existsSync(join(outside, "nested"))).toBe(false);
    },
  );

  test(`the same call succeeds with ${ALLOW_EXTERNAL_DIR_ENV}=1`, async () => {
    const target = join(outside, "opted-in");

    process.env[ALLOW_EXTERNAL_DIR_ENV] = "1";
    try {
      const result = (await client.callTool({
        name: "memory_current",
        arguments: { dir: target },
      })) as ToolResult;

      expect(result.isError).toBeFalsy();
      // The opt-in restores the documented multi-project workflow: the external
      // project gets its own store instead of being refused.
      expect(existsSync(join(target, ".memory"))).toBe(true);
      expect(existsSync(join(target, ".memory", "CURRENT.md"))).toBe(true);
    } finally {
      delete process.env[ALLOW_EXTERNAL_DIR_ENV];
    }
  });

  test.skipIf(process.platform === "win32")(
    "a newly created store is 0700 and CURRENT.md is 0600",
    async () => {
      const freshRoot = makeTempRoot();
      const server = createServer(freshRoot);
      try {
        const memoryDir = join(freshRoot, ".memory");
        expect(statSync(memoryDir).mode & 0o777).toBe(0o700);
        expect(statSync(join(memoryDir, "memories")).mode & 0o777).toBe(0o700);
        expect(statSync(join(memoryDir, "CURRENT.md")).mode & 0o777).toBe(0o600);
        // USER.md is written through the same 0o600 path.
        expect(statSync(join(memoryDir, "USER.md")).mode & 0o777).toBe(0o600);
      } finally {
        await server.close();
        cleanup(freshRoot);
      }
    },
  );
});
