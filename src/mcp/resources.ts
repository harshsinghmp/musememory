/**
 * MCP **resources** (issue #494).
 *
 * A resource is a read-only handle a client can browse and pull into context
 * without spending a tool call: `resources/list` advertises the small, stable
 * set of documents this server always has (CURRENT.md, USER.md, CORE.md and the
 * session handoff), and `resources/read` resolves one of them — or one memory
 * entry by id via the dynamic `memory://entry/<id>` form.
 *
 * The static four are listed but *not* enumerated per memory entry: the store
 * holds thousands of entries, and a list that size is a token bomb for a client
 * that just wants an index. Entries stay reachable by id (and through the
 * search/catalog tools).
 *
 * Every reader here reuses the helper the equivalent tool already uses —
 * `parseCurrentFile`/`getSessionHandoff` from the governor, `getUserProfile`
 * from USER.md, `readCore` from CORE.md — so a resource can never disagree with
 * the tool that exposes the same content.
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { CORE_TIERS, readCore } from "../core.ts";
import { getSessionHandoff, parseCurrentFile } from "../governor.ts";
import { get as getEntry, type Store } from "../store.ts";
import { getUserProfile } from "../user.ts";
import { DOCUMENT_MAX_BYTES, stripFenceTokens, wrapAgentContext } from "../security/context_sanitizer.ts";

/** The four always-present documents, in list order. */
export const STATIC_MCP_RESOURCES = [
  {
    uri: "memory://current",
    name: "current",
    title: "Active Working Constraints (CURRENT.md)",
    description:
      "Hard constraints, invariants and in-flight loops recorded in the project's CURRENT.md. Same source as the memory_current tool.",
    mimeType: "text/markdown",
  },
  {
    uri: "memory://user",
    name: "user",
    title: "User Profile (USER.md)",
    description:
      "The active user profile and working preferences, resolved local-to-global. Same source as memory_get_user_profile.",
    mimeType: "text/markdown",
  },
  {
    uri: "memory://core",
    name: "core",
    title: "Core Memory (CORE.md)",
    description:
      "The permanent operating guidelines, tiered as identity, directives, conventions and context. Same source as memory_core.",
    mimeType: "text/markdown",
  },
  {
    uri: "memory://handoff",
    name: "handoff",
    title: "Session Handoff (CURRENT.md)",
    description:
      "The interruption-proof session handoff written by memory_compact_handoff: status, active agent, task, progress and discoveries.",
    mimeType: "text/markdown",
  },
] as const;

/** Prefix of the dynamic per-entry resource. */
export const ENTRY_RESOURCE_PREFIX = "memory://entry/";

export interface McpResourceRead {
  uri: string;
  mimeType: string;
  text: string;
}

function renderCurrent(memoryDir: string): string {
  const { constraints } = parseCurrentFile(memoryDir);
  if (constraints.length === 0) {
    return "# Active Working Constraints (CURRENT.md)\n\n*(No active hard constraints recorded)*\n";
  }
  return ["# Active Working Constraints (CURRENT.md)", "", ...constraints.map((c) => `- ${c}`), ""].join("\n");
}

function renderUser(memoryDir: string): string {
  const profile = getUserProfile(memoryDir);
  return profile && profile.trim().length > 0
    ? profile
    : "# User Profile (USER.md)\n\n*(No USER.md profile configured for this project)*\n";
}

function renderCore(memoryDir: string): string {
  const tiers = readCore(memoryDir);
  const body = CORE_TIERS.map((tier) => {
    const lines = tiers[tier];
    return [`## ${tier}`, ...(lines.length > 0 ? lines.map((l) => `- ${l}`) : ["*(empty)*"])].join("\n");
  }).join("\n\n");
  return `# CORE MEMORY\n\n${body}\n`;
}

function renderHandoff(memoryDir: string): string {
  const handoff = getSessionHandoff(memoryDir);
  if (!handoff) {
    return "# Session Handoff (CURRENT.md)\n\n*(No session handoff recorded)*\n";
  }
  const lines = ["# Session Handoff (CURRENT.md)", "", `- **Status**: [${handoff.status}]`];
  if (handoff.agent) lines.push(`- **Active Agent**: ${handoff.agent}`);
  if (handoff.sessionId) lines.push(`- **Session ID**: ${handoff.sessionId}`);
  lines.push(`- **Last Updated**: ${handoff.lastUpdated}`);
  if (handoff.task) lines.push(`- **Active Task**: ${handoff.task}`);
  if (handoff.lastQuery) lines.push(`- **Last Query / Instruction**: "${handoff.lastQuery}"`);
  if (handoff.progress && handoff.progress.length > 0) {
    lines.push("- **Progress & Checkpoints**:");
    for (const p of handoff.progress) lines.push(`  - ${p}`);
  }
  if (handoff.discoveries && handoff.discoveries.length > 0) {
    lines.push("- **Learned Discoveries**:");
    for (const d of handoff.discoveries) lines.push(`  - ${d}`);
  }
  lines.push("");
  return lines.join("\n");
}

function invalidResource(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message);
}

/**
 * #514: a resource body is memory content, so it is served as data inside the
 * same fence `get_context` uses. Without it a constraint or an imported memory
 * containing `</muse-memory>` could close the delimiter and speak as the
 * operator; `wrapAgentContext` strips those tokens before wrapping, so the
 * fence cannot be forged and does not nest.
 */
function asData(markdown: string): string {
  return wrapAgentContext(markdown, DOCUMENT_MAX_BYTES);
}

/**
 * #514: the entry resource must stay valid JSON, so it cannot be wrapped in a
 * text fence. Instead the fence tokens are stripped from every string it
 * carries — including keys, which a memory can control through its tags — so
 * embedding the document in a prompt cannot close an outer fence either.
 */
function scrubFenceTokens(value: unknown): unknown {
  if (typeof value === "string") return stripFenceTokens(value);
  if (Array.isArray(value)) return value.map(scrubFenceTokens);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[stripFenceTokens(key)] = scrubFenceTokens(inner);
    }
    return out;
  }
  return value;
}

/** Extract the entry id from `memory://entry/<id>`, or null when the URI lacks one. */
function entryIdFromUri(uri: string): string | null {
  const raw = uri.slice(ENTRY_RESOURCE_PREFIX.length);
  if (!raw) return null;
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    // A malformed escape sequence is a bad id, not a reason to throw here.
  }
  return id.trim() || null;
}

/**
 * Resolve one `resources/read` URI.
 *
 * Throws `McpError(-32602)` — invalid params — for anything this server cannot
 * answer, including a syntactically valid `memory://entry/<id>` whose id is not
 * in the store, so a client sees a clear protocol-level rejection instead of an
 * empty document it would mistake for a real, empty memory.
 */
export function readMcpResource(store: Store, memoryDir: string, uri: string): McpResourceRead {
  switch (uri) {
    case "memory://current":
      return { uri, mimeType: "text/markdown", text: asData(renderCurrent(memoryDir)) };
    case "memory://user":
      return { uri, mimeType: "text/markdown", text: asData(renderUser(memoryDir)) };
    case "memory://core":
      return { uri, mimeType: "text/markdown", text: asData(renderCore(memoryDir)) };
    case "memory://handoff":
      return { uri, mimeType: "text/markdown", text: asData(renderHandoff(memoryDir)) };
    default:
      break;
  }

  if (uri.startsWith(ENTRY_RESOURCE_PREFIX)) {
    const id = entryIdFromUri(uri);
    if (!id) {
      throw invalidResource(
        `Invalid resource URI '${uri}': expected '${ENTRY_RESOURCE_PREFIX}<id>'.`,
      );
    }
    const entry = getEntry(store, id);
    if (!entry) {
      throw invalidResource(
        `Unknown memory entry '${id}' for resource '${uri}'. Use the search or memory_tree_search tool to find a valid id.`,
      );
    }
    return { uri, mimeType: "application/json", text: JSON.stringify(scrubFenceTokens(entry), null, 2) };
  }

  throw invalidResource(
    `Unknown resource URI '${uri}'. Available: ${STATIC_MCP_RESOURCES.map((r) => r.uri).join(", ")}, ${ENTRY_RESOURCE_PREFIX}<id>.`,
  );
}
