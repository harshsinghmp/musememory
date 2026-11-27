import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/mcp.ts";
import { MCP_TOOL_CATALOG } from "../src/mcp/catalog.ts";
import {
  ANNOTATED_TOOL_CATALOG,
  TOOL_ANNOTATIONS,
  annotationsFor,
  defaultAnnotation,
} from "../src/mcp/annotations.ts";
import { makeTempRoot, cleanup } from "./helpers.ts";

/**
 * #495: every tool the server advertises carries MCP safety hints.
 *
 * The catalog names are the contract: `test/marketing_claims.test.ts` and
 * `claims.json` publish 126 tools, so the annotation map has to hold exactly
 * those 126 names — no missing tool (silently unannotated) and no extra name
 * (a hint for a tool that does not exist is dead weight that hides a typo).
 *
 * Note on names: issue #495 phrases some expectations as `memory_search` /
 * `memory_list` / `memory_save`, but the shipped catalog calls those `search`
 * (unprefixed), has no bare list tool (the list-shaped tools are the
 * `*_list` family), and has no `memory_save` (the save-shaped tools are
 * `memory_confirm`, `memory_settings_set`, `memory_core`). The assertions below
 * use the real names.
 */

const CATALOG_NAMES: string[] = MCP_TOOL_CATALOG.map((tool) => tool.name);

/** Read-shaped tools: retrieval, listing, reporting. */
const READ_TOOLS = [
  "search",
  "memory_read",
  "get_context",
  "memory_recall",
  "memory_adr_list",
  "memory_claim_list",
  "memory_source_list",
  "memory_prompt_list",
  "memory_freeze_list",
  "muse_profile_list",
  "memory_audit",
  "muse_health",
] as const;

/** Tools that can delete, forget, overwrite or prune stored state. */
const DESTRUCTIVE_TOOLS = [
  "memory_delete",
  "memory_lifecycle", // `forget` verb
  "memory_restore",
  "memory_import", // overwrite: true
  "memory_disconnect_pageindex",
  "muse_reconcile_anchors",
] as const;

describe("TOOL_ANNOTATIONS coverage", () => {
  test("covers exactly the catalog's 126 tool names — no missing, no extra", () => {
    const mapped = Object.keys(TOOL_ANNOTATIONS).sort();
    const catalog = [...CATALOG_NAMES].sort();

    expect(mapped.length).toBe(126);
    expect(catalog.length).toBe(126);
    expect(new Set(mapped).size).toBe(mapped.length); // no duplicate keys
    expect(mapped).toEqual(catalog);
    expect(mapped.filter((name) => !catalog.includes(name))).toEqual([]);
    expect(catalog.filter((name) => !mapped.includes(name))).toEqual([]);
  });

  test("carries all four hints as booleans on every entry", () => {
    for (const [name, hints] of Object.entries(TOOL_ANNOTATIONS)) {
      expect({ name, readOnly: typeof hints.readOnlyHint }).toEqual({ name, readOnly: "boolean" });
      expect({ name, destructive: typeof hints.destructiveHint }).toEqual({ name, destructive: "boolean" });
      expect({ name, idempotent: typeof hints.idempotentHint }).toEqual({ name, idempotent: "boolean" });
      expect({ name, openWorld: typeof hints.openWorldHint }).toEqual({ name, openWorld: "boolean" });
    }
  });

  test("no tool is both readOnly and destructive", () => {
    const contradictory = Object.entries(TOOL_ANNOTATIONS)
      .filter(([, hints]) => hints.readOnlyHint === true && hints.destructiveHint === true)
      .map(([name]) => name);
    expect(contradictory).toEqual([]);
  });
});

describe("classification", () => {
  test("search / read / list tools are readOnly and not destructive", () => {
    for (const name of READ_TOOLS) {
      expect({ name, readOnly: TOOL_ANNOTATIONS[name]?.readOnlyHint }).toEqual({ name, readOnly: true });
      expect({ name, destructive: TOOL_ANNOTATIONS[name]?.destructiveHint }).toEqual({
        name,
        destructive: false,
      });
    }
  });

  test("every tool whose name says delete/purge/forget/reset is destructive and not readOnly", () => {
    const byName = CATALOG_NAMES.filter((name) => /(delete|purge|forget|reset)/.test(name));
    // Guard the guard: the catalog does have delete-shaped names, so an empty
    // match here would mean the regex silently stopped testing anything.
    expect(byName.length).toBeGreaterThan(0);
    for (const name of byName) {
      expect({ name, destructive: TOOL_ANNOTATIONS[name]?.destructiveHint }).toEqual({
        name,
        destructive: true,
      });
      expect({ name, readOnly: TOOL_ANNOTATIONS[name]?.readOnlyHint }).toEqual({ name, readOnly: false });
    }
  });

  test("destructive tools are destructive and not readOnly", () => {
    for (const name of DESTRUCTIVE_TOOLS) {
      expect({ name, destructive: TOOL_ANNOTATIONS[name]?.destructiveHint }).toEqual({
        name,
        destructive: true,
      });
      expect({ name, readOnly: TOOL_ANNOTATIONS[name]?.readOnlyHint }).toEqual({ name, readOnly: false });
    }
  });

  test("save-style tools are idempotent, capture is not", () => {
    // The catalog's "save" shapes: a set, a status transition, a replace.
    for (const name of ["memory_settings_set", "memory_set_user_profile", "memory_confirm", "memory_core"]) {
      expect({ name, idempotent: TOOL_ANNOTATIONS[name]?.idempotentHint }).toEqual({ name, idempotent: true });
    }
    expect(TOOL_ANNOTATIONS.memory_capture?.idempotentHint).toBe(false);
  });

  test("no tool reaches outside the machine", () => {
    // Audited, not assumed: nothing in src/ calls fetch/node:https/undici and no
    // handler dereferences a URL — memory_source_add records one without
    // retrieving it. A tool that does talk to the network must move this count.
    const openWorld = Object.entries(TOOL_ANNOTATIONS)
      .filter(([, hints]) => hints.openWorldHint === true)
      .map(([name]) => name);
    expect(openWorld).toEqual([]);
  });

  test("defaultAnnotation is conservative for an unclassified name", () => {
    const fallback = defaultAnnotation("memory_future_tool");
    expect(fallback.readOnlyHint).toBe(false);
    expect(fallback.destructiveHint).toBe(true);
    expect(fallback.idempotentHint).toBe(false);
    expect(fallback.openWorldHint).toBe(false);
    expect(annotationsFor("memory_future_tool")).toEqual(fallback);
  });

  test("annotations are attached without mutating the source catalog", () => {
    // The catalog stays the unannotated wire description everything else reads.
    expect(MCP_TOOL_CATALOG.every((tool) => tool.annotations === undefined)).toBe(true);
    expect(ANNOTATED_TOOL_CATALOG.length).toBe(MCP_TOOL_CATALOG.length);
    // Same order, same names, same schemas — only `annotations` is added.
    expect(ANNOTATED_TOOL_CATALOG.map((tool) => tool.name)).toEqual(CATALOG_NAMES);
    for (const [i, tool] of ANNOTATED_TOOL_CATALOG.entries()) {
      expect(tool.inputSchema).toEqual(MCP_TOOL_CATALOG[i]!.inputSchema);
      expect(tool.description).toEqual(MCP_TOOL_CATALOG[i]!.description);
      expect(tool.annotations).toEqual(TOOL_ANNOTATIONS[tool.name]!);
    }
  });
});

describe("tools/list over the real server", () => {
  const root = makeTempRoot();
  let client: Client;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer(root);
    await server.connect(serverTransport);
    client = new Client({ name: "mcp-annotations-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
    close = async () => {
      await client.close();
      await server.close();
    };
  });

  afterAll(async () => {
    await close?.();
    cleanup(root);
  });

  test("every advertised tool carries annotations", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(126);
    const unannotated = tools.filter((tool) => tool.annotations === undefined).map((tool) => tool.name);
    expect(unannotated).toEqual([]);
    // …and they are the hints from the map, not a per-request invention.
    for (const tool of tools) {
      expect({ name: tool.name, annotations: tool.annotations }).toEqual({
        name: tool.name,
        annotations: TOOL_ANNOTATIONS[tool.name]!,
      });
      expect(typeof tool.annotations?.readOnlyHint).toBe("boolean");
      expect(typeof tool.annotations?.destructiveHint).toBe("boolean");
      expect(typeof tool.annotations?.idempotentHint).toBe("boolean");
      expect(typeof tool.annotations?.openWorldHint).toBe("boolean");
    }
  });

  test("the wire tells a read from a delete", async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    expect(byName.get("memory_read")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("memory_read")?.annotations?.destructiveHint).toBe(false);
    expect(byName.get("memory_delete")?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get("memory_delete")?.annotations?.destructiveHint).toBe(true);
  });
});
