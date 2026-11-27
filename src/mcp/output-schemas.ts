/**
 * Typed `outputSchema` / `structuredContent` for the read tools (#495).
 *
 * Why this exists
 * ---------------
 * Every handler in `src/mcp/dispatch.ts` builds a JavaScript object and then
 * flattens it into one JSON text block (`tool-result.ts`). A host that wants to
 * render a search page has to parse that string back into the object the server
 * already had, and it has no machine-readable description of what the object
 * contains — the catalog advertised an `inputSchema` only, so a typed client
 * could validate an argument but not a result.
 *
 * The protocol's answer is a pair of fields:
 *   - `outputSchema` on the tool in `tools/list` — a JSON Schema for the object
 *     the tool returns;
 *   - `structuredContent` on the result — that object, unflattened.
 *
 * Both are **additive**. `content` is still the single JSON text block, byte for
 * byte, so a client that ignores `structuredContent` sees exactly what it saw
 * before. `dispatch.ts` builds the payload once and passes the same object to
 * both channels, so the two can never disagree.
 *
 * Which tools — and why only these four
 * -------------------------------------
 * `search`, `memory_recall`, `get_context` and `muse_health`. They are the read
 * tools whose payload is already a stable object with a shape owned by a single
 * source (`UnifiedSearchResult` / `FormattedContext` / `ProjectHealthReport`),
 * so the schema describes today's contract instead of inventing one. The other
 * read-only tools (`memory_read`, `graph_status`, `memory_audit`,
 * `memory_settings_get`, the `muse_*` analyses, …) return equally regular
 * payloads, but each would need its own reviewed schema; they are the follow-up
 * slice, not this one. Nothing here touches a text-only tool: a tool without an
 * entry in `TOOL_OUTPUT_SCHEMAS` is served and dispatched exactly as before.
 *
 * Two deliberate schema decisions
 * -------------------------------
 * 1. **The envelope is closed, the entry body is not.** Every object the server
 *    itself constructs (the payload root, `withheld[]`, `scope`, `pillars`) is
 *    `additionalProperties: false`, so a field the handler stops emitting is a
 *    schema change, not a silent drift. The memory-entry objects nested inside
 *    `results` / `entries` / `undetermined` keep `additionalProperties: true`:
 *    their full shape is `schema.json`'s canonical `memory-entry` document
 *    (60+ optional fields that grow with the store), and repeating it here would
 *    create a second source of truth and — because the SDK's client *validates*
 *    `structuredContent` against this schema — turn a single legacy entry into a
 *    failed `search` call. The required core below is copied from `schema.json`
 *    so the promise a host renders against cannot drift from the store's own
 *    contract; everything beyond it is passed through untouched.
 * 2. **No `format` keywords.** `date-time` is a plain `string` here: the schema
 *    travels to third-party validators, and a strict one that has not registered
 *    the format would reject every payload.
 */
import MEMORY_ENTRY_SCHEMA from "../../schema.json";

/** The shape the SDK requires: `type: "object"` plus free-form JSON Schema. */
export type ToolOutputSchema = { type: "object"; [key: string]: unknown };

/** One nested schema node. */
type JsonSchema = Record<string, unknown>;

/** The canonical entry document the store itself is validated against. */
const MEMORY_ENTRY = MEMORY_ENTRY_SCHEMA as {
  required: string[];
  properties: Record<string, JsonSchema>;
};

/**
 * The handful of entry fields every rendered result promises, typed by
 * `schema.json` rather than by a copy — if the store's contract tightens
 * (`id` pattern, `title` length, the `status` enum), the tool schema follows.
 */
const ENTRY_CORE = MEMORY_ENTRY.properties;

/** The entry fields a payload guarantees; the rest of the entry passes through. */
const ENTRY_REQUIRED = ["id", "title", "content", "project", "status", "created_at", "updated_at"];

/**
 * A retrieved memory: the entry plus the score the retrieval engine gave it.
 *
 * `score` is the only field the payload adds, and it is why this is not just a
 * reference to `memory-entry`: `{ ...entry, score }` is the object every
 * retrieval tool emits.
 */
function scoredEntrySchema(description: string): JsonSchema {
  return {
    type: "object",
    description,
    properties: {
      id: ENTRY_CORE.id,
      title: ENTRY_CORE.title,
      content: ENTRY_CORE.content,
      project: ENTRY_CORE.project,
      status: ENTRY_CORE.status,
      type: ENTRY_CORE.type,
      created_at: ENTRY_CORE.created_at,
      updated_at: ENTRY_CORE.updated_at,
      score: { type: "number", description: "Relevance score the retrieval engine assigned to this entry" },
    },
    required: [...ENTRY_REQUIRED, "score"],
    // Open on purpose: the full entry shape is `schema.json`'s memory-entry
    // document, which grows with the store model. See the module header.
    additionalProperties: true,
  };
}

/** A memory the read-path trust gates removed, and why. */
const WITHHELD_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    reason: { type: "string" },
  },
  required: ["id", "reason"],
  additionalProperties: false,
};

const CONFIDENCE_MODE: JsonSchema = {
  type: "string",
  enum: ["confident_match", "no_confident_match"],
  description: "Whether the page met the confidence threshold or abstained",
};

/**
 * `search` and `memory_recall` share one dispatch arm, so they share one schema.
 *
 * `withheld` is optional because only the full-store branch enriches it; the
 * `at_time` branch returns the same object without it.
 */
export const SEARCH_OUTPUT_SCHEMA: ToolOutputSchema = {
  type: "object",
  description: "A ranked page of memory entries plus the diagnostics that explain how it was produced",
  properties: {
    results: {
      type: "array",
      items: scoredEntrySchema("A retrieved memory and its relevance score"),
      description: "Ranked matches, best first, capped by `limit` and `token_budget`",
    },
    source: {
      type: "string",
      description: "Retrieval path that produced the page: exact, hybrid, tree or pageindex (live/cache/degraded on the `at_time` branch)",
    },
    stale: { type: "boolean", description: "True when the page was served from a cache the circuit breaker downgraded" },
    from_cache: { type: "boolean", description: "True when the page came from the context cache" },
    total_tokens_used: { type: "number", description: "Token cost of the packed result page" },
    explanation: { type: "string", description: "Human-readable account of the retrieval decision, when the engine emits one" },
    mode: CONFIDENCE_MODE,
    no_confident_match: { type: "boolean", description: "True when nothing cleared the confidence threshold" },
    as_of: { type: "string", description: "The bi-temporal instant the page was evaluated at, when one was requested" },
    undetermined: {
      type: "array",
      items: scoredEntrySchema("A memory whose validity at `as_of` cannot be decided"),
      description: "Matches whose state at `as_of` is undetermined without inventing a date",
    },
    withheld: {
      type: "array",
      items: WITHHELD_SCHEMA,
      description: "Memories removed by the trust or veracity gates, with the reason",
    },
  },
  required: ["results", "source", "stale", "from_cache", "total_tokens_used", "mode", "no_confident_match"],
  additionalProperties: false,
};

/**
 * `get_context`'s payload.
 *
 * `markdown` is the rendered prompt block a host injects verbatim; the arrays
 * beside it are the same material in structured form, so a host can render a
 * context list without splitting the markdown.
 */
export const CONTEXT_OUTPUT_SCHEMA: ToolOutputSchema = {
  type: "object",
  description: "Top-K memories, active constraints (CURRENT.md) and the user profile (USER.md) for prompt injection",
  properties: {
    markdown: { type: "string", description: "The rendered context block, byte-identical to the text channel" },
    entries: {
      type: "array",
      items: scoredEntrySchema("A retrieved memory and its relevance score"),
      description: "The memories the markdown was built from",
    },
    total_tokens_used: { type: "number", description: "Token cost of the rendered context" },
    constraints: { type: "array", items: { type: "string" }, description: "Active hard constraints from CURRENT.md" },
    user_profile: { type: ["string", "null"], description: "USER.md verbatim, or null when no profile is stored" },
    stale: { type: "boolean", description: "True when the page was served from a cache the circuit breaker downgraded" },
    from_cache: { type: "boolean", description: "True when the context came from the context cache" },
    mode: CONFIDENCE_MODE,
    no_confident_match: { type: "boolean", description: "True when nothing cleared the confidence threshold" },
    as_of: { type: "string", description: "The bi-temporal instant the context was evaluated at, when one was requested" },
    undetermined: {
      type: "array",
      items: scoredEntrySchema("A memory whose validity at `as_of` cannot be decided"),
      description: "Matches whose state at `as_of` is undetermined without inventing a date",
    },
  },
  required: ["markdown", "entries", "total_tokens_used", "constraints", "stale", "from_cache"],
  additionalProperties: false,
};

const PILLAR_GRADE: JsonSchema = { type: "string", enum: ["A", "B", "C", "D", "F"] };
const GATE_STATUS: JsonSchema = { type: "string", enum: ["PASS", "WARN", "FAIL"] };

/** One of the five health pillars (`ProjectHealthReport.pillars`). */
const PILLAR_REPORT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    score: { type: "number", minimum: 0, maximum: 100 },
    grade: PILLAR_GRADE,
    status: GATE_STATUS,
    metrics: {
      type: "object",
      description: "Pillar-specific counters and labels",
      additionalProperties: { type: ["number", "string"] },
    },
    remediation_items: { type: "array", items: { type: "string" } },
  },
  required: ["name", "score", "grade", "status", "metrics", "remediation_items"],
  additionalProperties: false,
};

/**
 * `muse_health`'s payload: the full `ProjectHealthReport` from
 * `src/health/types.ts`, including the scope the numbers were computed over.
 */
export const HEALTH_OUTPUT_SCHEMA: ToolOutputSchema = {
  type: "object",
  description: "Five-pillar project health report with an overall grade and a pass/warn/fail gate",
  properties: {
    project: { type: "string", description: "The project the report is attributed to, or \"all\"" },
    scope: {
      type: "object",
      properties: {
        filter: { type: ["string", "null"], description: "The project filter applied, or null for the whole store" },
        projects: { type: "array", items: { type: "string" } },
        entry_count: { type: "number" },
        code_scope: { type: "string", enum: ["workspace"], description: "Code-side metrics always cover the whole workspace" },
      },
      required: ["filter", "projects", "entry_count", "code_scope"],
      additionalProperties: false,
    },
    timestamp: { type: "string" },
    overall_score: { type: "number", minimum: 0, maximum: 100 },
    overall_grade: PILLAR_GRADE,
    gate_status: GATE_STATUS,
    pillars: {
      type: "object",
      properties: {
        store_integrity: PILLAR_REPORT_SCHEMA,
        code_anchors: PILLAR_REPORT_SCHEMA,
        doc_code_alignment: PILLAR_REPORT_SCHEMA,
        negative_anti_patterns: PILLAR_REPORT_SCHEMA,
        technical_debt: PILLAR_REPORT_SCHEMA,
      },
      required: [
        "store_integrity",
        "code_anchors",
        "doc_code_alignment",
        "negative_anti_patterns",
        "technical_debt",
      ],
      additionalProperties: false,
    },
    summary: { type: "string" },
    actionable_checklist: { type: "array", items: { type: "string" } },
  },
  required: [
    "project",
    "scope",
    "timestamp",
    "overall_score",
    "overall_grade",
    "gate_status",
    "pillars",
    "summary",
    "actionable_checklist",
  ],
  additionalProperties: false,
};

/**
 * The tools that publish an `outputSchema`, keyed by catalog name.
 *
 * Frozen and exported as the single registry: `catalog.ts` attaches the schema
 * to the tool entry and `test/mcp_structured_content.test.ts` asserts the served
 * `tools/list` matches this map exactly, so a tool can never advertise a schema
 * the dispatcher does not fill (the SDK's client throws when a tool with an
 * `outputSchema` returns no `structuredContent`).
 */
export const TOOL_OUTPUT_SCHEMAS: Readonly<Record<string, ToolOutputSchema>> = Object.freeze({
  search: SEARCH_OUTPUT_SCHEMA,
  memory_recall: SEARCH_OUTPUT_SCHEMA,
  get_context: CONTEXT_OUTPUT_SCHEMA,
  muse_health: HEALTH_OUTPUT_SCHEMA,
});

/** The schema for one tool, or `undefined` when the tool is text-only. */
export function outputSchemaFor(name: string): ToolOutputSchema | undefined {
  return TOOL_OUTPUT_SCHEMAS[name];
}

/** The catalog tool names covered by this module, sorted for stable output. */
export const STRUCTURED_OUTPUT_TOOLS: readonly string[] = Object.freeze(Object.keys(TOOL_OUTPUT_SCHEMAS).sort());
