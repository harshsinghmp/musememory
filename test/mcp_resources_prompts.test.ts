import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, getCachedStore, SUPPORTED_MCP_PROTOCOL_VERSIONS } from "../src/mcp.ts";
import { propose } from "../src/store.ts";
import { BUILTIN_PROMPTS } from "../src/prompts.ts";
import { setCurrent, updateSessionHandoff } from "../src/governor.ts";
import { setCore } from "../src/core.ts";
import { setUserProfile } from "../src/user.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";
import { join } from "node:path";

const root = makeTempRoot();
const memoryDir = join(root, ".memory");
let client: Client;
let negotiatedVersion: string | undefined;
let entryId: string;
let disconnect: () => Promise<void>;

/** Connect an SDK client to the real server over an in-memory transport pair. */
async function connect(): Promise<{ client: Client; negotiated: () => string | undefined; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  // The SDK reports the version it settled on through the carrier's optional
  // `setProtocolVersion` hook (that is how an HTTP transport learns the header
  // it must echo). InMemoryTransport does not implement it, so attach one to
  // observe exactly what `initialize` negotiated.
  let version: string | undefined;
  (clientTransport as unknown as { setProtocolVersion?: (v: string) => void }).setProtocolVersion = (v: string) => {
    version = v;
  };

  const server = createServer(root);
  await server.connect(serverTransport);

  const sdkClient = new Client({ name: "mcp-resources-prompts-test", version: "1.0.0" }, { capabilities: {} });
  await sdkClient.connect(clientTransport);

  return {
    client: sdkClient,
    negotiated: () => version,
    close: async () => {
      await sdkClient.close();
      await server.close();
    },
  };
}

beforeAll(async () => {
  // Seed through the same cached Store the server will use, so the entry under
  // test is visible without reopening the database from a second handle.
  const store = getCachedStore(memoryDir);
  const entry = propose(store, {
    content: "Resources are read-only handles; prompts are parameterised instructions.",
    project: "musememory",
    title: "MCP resources and prompts slice",
    type: "architecture",
    confirmed: true,
    tags: ["mcp", "resources", "prompts"],
  });
  entryId = entry.id;

  setCurrent(memoryDir, "Never read, write or modify the tracked .memory directory during a task.", "musememory");
  setCore(memoryDir, "directives", "Run every gate before opening a pull request.");
  setUserProfile(memoryDir, "# User Profile\n\n- Prefers Bun + TypeScript.\n");
  updateSessionHandoff(memoryDir, {
    status: "IN-PROGRESS",
    agent: "mcp-resources-prompts-test",
    task: "Verify MCP resources and prompts",
  });

  const connected = await connect();
  client = connected.client;
  negotiatedVersion = connected.negotiated();
  // One connection serves every assertion below; it is closed in afterAll.
  disconnect = connected.close;
});

afterAll(async () => {
  await disconnect?.();
  cleanup(root);
});

describe("#494: protocol version advertisement", () => {
  test("advertises every version the installed SDK supports, latest first", () => {
    expect([...SUPPORTED_MCP_PROTOCOL_VERSIONS]).toEqual([
      "2025-11-25",
      "2025-06-18",
      "2025-03-26",
      "2024-11-05",
      "2024-10-07",
    ]);
  });

  test("negotiates 2025-11-25 with a current client", () => {
    expect(negotiatedVersion).toBe("2025-11-25");
  });

  test("advertises tools, resources, prompts and logging capabilities", () => {
    const capabilities = client.getServerCapabilities();
    expect(capabilities?.tools).toBeDefined();
    expect(capabilities?.resources).toBeDefined();
    expect(capabilities?.prompts).toBeDefined();
    expect(capabilities?.logging).toBeDefined();
  });
});

describe("#494: resources", () => {
  test("listResources returns the four static URIs, not every entry", async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri).sort();
    expect(uris).toEqual(["memory://core", "memory://current", "memory://handoff", "memory://user"]);
    for (const resource of resources) {
      expect(resource.mimeType).toBe("text/markdown");
      expect(resource.name.length).toBeGreaterThan(0);
      expect(resource.description?.length).toBeGreaterThan(0);
    }
  });

  test("readResource serves the four static documents as markdown", async () => {
    const expectations: Array<[string, string]> = [
      ["memory://current", "Never read, write or modify the tracked .memory directory"],
      ["memory://user", "Prefers Bun + TypeScript"],
      ["memory://core", "Run every gate before opening a pull request"],
      ["memory://handoff", "Verify MCP resources and prompts"],
    ];
    for (const [uri, needle] of expectations) {
      const result = await client.readResource({ uri });
      expect(result.contents.length).toBe(1);
      const content = result.contents[0] as { uri: string; mimeType: string; text: string };
      expect(content.uri).toBe(uri);
      expect(content.mimeType).toBe("text/markdown");
      expect(content.text).toContain(needle);
    }
  });

  test("readResource resolves memory://entry/<id> to the entry JSON", async () => {
    const result = await client.readResource({ uri: `memory://entry/${entryId}` });
    const content = result.contents[0] as { uri: string; mimeType: string; text: string };
    expect(content.uri).toBe(`memory://entry/${entryId}`);
    expect(content.mimeType).toBe("application/json");

    const entry = JSON.parse(content.text) as Record<string, unknown>;
    expect(entry.id).toBe(entryId);
    expect(entry.title).toBe("MCP resources and prompts slice");
    expect(entry.type).toBe("architecture");
  });

  test("readResource rejects an unknown entry id with -32602", async () => {
    let error: { code?: number; message?: string } | undefined;
    try {
      await client.readResource({ uri: "memory://entry/m_0000000000000_missing" });
    } catch (err) {
      error = err as { code?: number; message?: string };
    }
    expect(error).toBeDefined();
    expect(error!.code).toBe(-32602);
    expect(error!.message).toContain("Unknown memory entry 'm_0000000000000_missing'");
  });

  test("readResource rejects an unknown URI with -32602", async () => {
    let error: { code?: number; message?: string } | undefined;
    try {
      await client.readResource({ uri: "memory://nope" });
    } catch (err) {
      error = err as { code?: number; message?: string };
    }
    expect(error?.code).toBe(-32602);
    expect(error!.message).toContain("Unknown resource URI 'memory://nope'");
  });
});

describe("#494: prompts", () => {
  test("listPrompts returns every builtin prompt with its arguments", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(BUILTIN_PROMPTS.map((p) => p.name));

    for (const builtin of BUILTIN_PROMPTS) {
      const advertised = prompts.find((p) => p.name === builtin.name);
      expect(advertised).toBeDefined();
      expect(advertised!.description).toBe(builtin.description);
      expect(advertised!.arguments).toEqual((builtin.variables ?? []).map((v) => ({ name: v, required: false })));
    }
  });

  test("getPrompt renders the template with the supplied arguments", async () => {
    const result = await client.getPrompt({
      name: "morning-standup",
      arguments: { date: "2026-01-02", focus: "MCP resources and prompts" },
    });

    expect(result.messages.length).toBe(1);
    const message = result.messages[0] as { role: string; content: { type: string; text: string } };
    expect(message.role).toBe("user");
    expect(message.content.type).toBe("text");
    expect(message.content.text).toContain("Date: 2026-01-02");
    expect(message.content.text).toContain("Focus: MCP resources and prompts");
    // Every placeholder is resolved: no {{var}} survives into the prompt.
    expect(message.content.text).not.toContain("{{");
  });

  test("getPrompt renders a single-variable prompt with its argument", async () => {
    const result = await client.getPrompt({ name: "pre-publish-audit", arguments: { target: "v9.9.9" } });
    const text = (result.messages[0] as { content: { text: string } }).content.text;
    expect(text).toContain("Target: v9.9.9");
    expect(text).not.toContain("{{");
  });

  test("getPrompt rejects an unknown prompt name with -32602", async () => {
    let error: { code?: number; message?: string } | undefined;
    try {
      await client.getPrompt({ name: "does-not-exist", arguments: {} });
    } catch (err) {
      error = err as { code?: number; message?: string };
    }
    expect(error).toBeDefined();
    expect(error!.code).toBe(-32602);
    expect(error!.message).toContain("Unknown prompt 'does-not-exist'");
    expect(error!.message).toContain("morning-standup");
  });
});
