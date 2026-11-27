import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import Ajv from "ajv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createServer, getCachedStore } from "../src/mcp.ts";
import { propose } from "../src/store.ts";
import { setCurrent, updateSessionHandoff } from "../src/governor.ts";
import { setCore } from "../src/core.ts";
import { setUserProfile } from "../src/user.ts";
import { STRUCTURED_OUTPUT_TOOLS } from "../src/mcp/output-schemas.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";
import { join } from "node:path";

/**
 * #495: the structured-result half of the MCP surface.
 *
 * Drives the real server through the SDK's `InMemoryTransport` (as
 * `test/mcp_resources_prompts.test.ts` does) and checks the four promises the
 * change makes:
 *   1. `tools/list` advertises an `outputSchema` for every covered read tool and
 *      for no other tool;
 *   2. a call's `structuredContent` validates against that very schema (the
 *      installed `ajv`, not a hand-written assertion);
 *   3. `content[0].text` still parses to the same object — the text channel is
 *      unchanged, so a client that ignores `structuredContent` sees no
 *      difference;
 *   4. an error result is still `isError: true` with no `structuredContent`.
 */

const root = makeTempRoot();
const memoryDir = join(root, ".memory");
let client: Client;
let tools: Tool[];
let disconnect: () => Promise<void>;
let seededId: string;

// Same validator options the SDK's client uses: no strict-mode complaints, and
// `format` keywords are not enforced (the shipped schemas avoid them).
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });

async function connect(): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(root);
  await server.connect(serverTransport);
  const sdkClient = new Client({ name: "mcp-structured-content-test", version: "1.0.0" }, { capabilities: {} });
  await sdkClient.connect(clientTransport);
  return {
    client: sdkClient,
    close: async () => {
      await sdkClient.close();
      await server.close();
    },
  };
}

function toolByName(name: string): Tool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool '${name}' is missing from tools/list`);
  return tool;
}

/** Validate a schema with ajv and fail with the validator's own errors. */
function assertValid(schema: unknown, value: unknown, label: string): void {
  const validate = ajv.compile(schema as object);
  const ok = validate(value);
  if (!ok) throw new Error(`${label} does not validate: ${JSON.stringify(validate.errors, null, 2)}`);
  expect(ok).toBe(true);
}

/**
 * Call a covered tool and assert the three result invariants.
 * Returns the parsed payload so a test can make tool-specific assertions.
 */
async function callStructured(
  name: string,
  args: Record<string, unknown>,
): Promise<{ structured: Record<string, unknown>; text: string }> {
  const tool = toolByName(name);
  expect(tool.outputSchema).toBeDefined();

  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBeUndefined();

  const structured = result.structuredContent as Record<string, unknown> | undefined;
  expect(structured).toBeDefined();

  // 1. The payload matches the schema the tool advertises on tools/list.
  assertValid(tool.outputSchema, structured, `${name} structuredContent`);

  // 2. The text channel is the same object, serialised exactly as before.
  const text = (result.content as Array<{ type: string; text: string }>)[0];
  expect(text.type).toBe("text");
  const parsed = JSON.parse(text.text);
  expect(parsed).toEqual(structured);
  // Key-for-key and value-for-value, including anything JSON drops (undefined).
  expect(JSON.stringify(parsed)).toBe(JSON.stringify(structured));

  return { structured: structured!, text: text.text };
}

beforeAll(async () => {
  const store = getCachedStore(memoryDir);
  const entry = propose(store, {
    content:
      "Structured tool results carry the same object as the text block: search, memory_recall, get_context and muse_health publish an outputSchema.",
    project: "musememory",
    title: "Structured tool results slice",
    type: "architecture",
    confirmed: true,
    tags: ["mcp", "structured-content"],
  });
  seededId = entry.id;
  propose(store, {
    content: "A second memory so retrieval pages have more than one candidate to rank.",
    project: "musememory",
    title: "Ranking companion entry",
    type: "decision",
    confirmed: true,
  });

  setCurrent(memoryDir, "Never read, write or modify the tracked .memory directory during a task.", "musememory");
  setCore(memoryDir, "directives", "Run every gate before opening a pull request.");
  setUserProfile(memoryDir, "# User Profile\n\n- Prefers Bun + TypeScript.\n");
  updateSessionHandoff(memoryDir, {
    status: "IN-PROGRESS",
    agent: "mcp-structured-content-test",
    task: "Verify structuredContent",
  });

  const connected = await connect();
  client = connected.client;
  disconnect = connected.close;
  tools = (await client.listTools()).tools;
});

afterAll(async () => {
  await disconnect?.();
  cleanup(root);
});

describe("#495: tools/list advertises outputSchema", () => {
  test("every covered read tool carries an object schema", () => {
    expect([...STRUCTURED_OUTPUT_TOOLS]).toEqual(["get_context", "memory_recall", "muse_health", "search"]);
    for (const name of STRUCTURED_OUTPUT_TOOLS) {
      const schema = toolByName(name).outputSchema as Record<string, unknown> | undefined;
      expect(schema).toBeDefined();
      expect(schema!.type).toBe("object");
      expect(schema!.properties).toBeTypeOf("object");
      expect(Array.isArray(schema!.required)).toBe(true);
      // The envelope is closed: the handler owns every key it emits.
      expect(schema!.additionalProperties).toBe(false);
    }
  });

  test("no other tool advertises an outputSchema", () => {
    const advertised = tools.filter((t) => t.outputSchema !== undefined).map((t) => t.name).sort();
    expect(advertised).toEqual([...STRUCTURED_OUTPUT_TOOLS]);
    // Control tools on both sides of the read/write line stay text-only.
    for (const control of ["memory_delete", "memory_capture", "memory_read"]) {
      expect(toolByName(control).outputSchema).toBeUndefined();
    }
  });

  test("the served schema is the registry's schema", () => {
    const search = toolByName("search").outputSchema as Record<string, unknown>;
    const required = search.required as string[];
    expect(required).toContain("results");
    expect(required).toContain("total_tokens_used");
    const properties = search.properties as Record<string, Record<string, unknown>>;
    expect(properties.results.type).toBe("array");
    // The `at_time` branch omits `withheld`, so it must stay optional.
    expect(required).not.toContain("withheld");
  });
});

describe("#495: calls return validated structuredContent", () => {
  test("search returns the ranked page as structuredContent", async () => {
    const { structured } = await callStructured("search", { query: "structured tool results", limit: 5 });
    const results = structured.results as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.id === seededId)).toBe(true);
    expect(typeof results[0].score).toBe("number");
    expect(structured.source).toBeTypeOf("string");
  });

  test("search honours the same schema on the at_time branch", async () => {
    const { structured } = await callStructured("search", {
      query: "structured tool results",
      at_time: new Date().toISOString(),
      limit: 5,
    });
    expect(Array.isArray(structured.results)).toBe(true);
  });

  test("memory_recall returns the same shape as search", async () => {
    const { structured } = await callStructured("memory_recall", { query: "structured tool results" });
    expect(Array.isArray(structured.results)).toBe(true);
    expect(structured.mode).toBeTypeOf("string");
  });

  test("get_context returns the rendered context and its parts", async () => {
    const { structured } = await callStructured("get_context", { query: "structured tool results" });
    expect(structured.markdown).toBeTypeOf("string");
    expect(structured.markdown as string).toContain("Never read, write or modify the tracked .memory directory");
    expect(Array.isArray(structured.constraints)).toBe(true);
    expect(structured.user_profile).toContain("Prefers Bun + TypeScript");
  });

  test("muse_health returns the five-pillar report", async () => {
    const { structured } = await callStructured("muse_health", {});
    const pillars = structured.pillars as Record<string, unknown>;
    expect(Object.keys(pillars).sort()).toEqual([
      "code_anchors",
      "doc_code_alignment",
      "negative_anti_patterns",
      "store_integrity",
      "technical_debt",
    ]);
    expect(structured.gate_status).toBeTypeOf("string");
    expect(typeof structured.overall_score).toBe("number");
  });
});

describe("#495: the error path stays a plain tool error", () => {
  test("a covered tool that fails returns isError with no structuredContent", async () => {
    const tool = toolByName("muse_health");
    expect(tool.outputSchema).toBeDefined();

    // An unknown project is a loud tool error, not an empty report.
    const result = await client.callTool({ name: "muse_health", arguments: { project: "no-such-project-xyz" } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const text = (result.content as Array<{ type: string; text: string }>)[0];
    expect(text.text).toContain('no memories for project "no-such-project-xyz"');
  });
});
