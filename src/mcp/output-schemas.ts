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
 * Which tools — and why these nine
 * --------------------------------
 * `search`, `memory_recall`, `get_context`, `muse_health`, `memory_read`,
 * `graph_status`, `memory_audit`, `memory_lifecycle_status` and `memory_roi`.
 * Each is a read tool whose payload is already a stable object with a shape
 * owned by a single source — `UnifiedSearchResult` / `FormattedContext` /
 * `ProjectHealthReport`, `schema.json`'s `memory-entry` document, `GraphStatus`,
 * the audit record in `src/types.ts`, `LifecycleStats` and `MemoryRoiReport` —
 * so every schema below describes today's contract instead of inventing one.
 *
 * `memory_settings_get` is the one candidate that stays text-only: its payload
 * is a user-authored `settings.json` shallow-merged over the defaults, so a
 * section may legitimately be partial and an unknown top-level key survives the
 * merge — a closed root would reject a real settings file, and closing only the
 * root while every section stays open would promise nothing worth validating.
 * Every other read-only tool (`muse_*` analyses, `memory_validate`, …) keeps the
 * text-only path until its payload gets a reviewed schema of its own. Nothing
 * here touches a text-only tool: a tool without an entry in
 * `TOOL_OUTPUT_SCHEMAS` is served and dispatched exactly as before.
 *
 * Two deliberate schema decisions
 * -------------------------------
 * 1. **The envelope is closed, the entry body is not.** Every object the server
 *    itself constructs (the payload root, `withheld[]`, `scope`, `pillars`,
 *    `stats`, `sweep`) is `additionalProperties: false`, so a field the handler
 *    stops emitting is a schema change, not a silent drift. The memory-entry
 *    objects nested inside `results` / `entries` / `undetermined` keep
 *    `additionalProperties: true`: their full shape is `schema.json`'s canonical
 *    `memory-entry` document (60+ optional fields that grow with the store), and
 *    repeating it here would create a second source of truth and — because the
 *    SDK's client *validates* `structuredContent` against this schema — turn a
 *    single legacy entry into a failed `search` call. The required core below is
 *    copied from `schema.json` so the promise a host renders against cannot
 *    drift from the store's own contract; everything beyond it is passed through
 *    untouched. `memory_read` is the one tool whose **root** is a memory entry —
 *    its payload is the stored document verbatim, not an envelope — so the entry
 *    rule applies at the root there, and the test asserts the exception rather
 *    than pretending the entry body is closed.
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
 * `memory_read`'s payload: the stored entry, verbatim.
 *
 * The one schema whose root is a memory entry rather than an envelope around
 * one, so the open-entry rule applies at the root (see decision 1). The handler
 * returns exactly what `get()` returned, so the fields listed here are the same
 * required core the retrieval schemas promise; everything else the store model
 * carries passes through.
 */
export const MEMORY_READ_OUTPUT_SCHEMA: ToolOutputSchema = {
  type: "object",
  description: "One memory entry exactly as stored: schema.json's memory-entry document",
  properties: {
    id: ENTRY_CORE.id,
    title: ENTRY_CORE.title,
    content: ENTRY_CORE.content,
    project: ENTRY_CORE.project,
    status: ENTRY_CORE.status,
    type: ENTRY_CORE.type,
    created_at: ENTRY_CORE.created_at,
    updated_at: ENTRY_CORE.updated_at,
  },
  required: [...ENTRY_REQUIRED],
  // Open at the root on purpose: this payload *is* the entry body, not an
  // envelope around one. See decision 1 in the module header.
  additionalProperties: true,
};

/** The providers `detectProvider()` can report (`GraphProviderType`). */
const GRAPH_PROVIDER: JsonSchema = {
  type: "string",
  enum: ["codegraph", "graphify", "none"],
  description: "The graph provider detected in the project root",
};

/**
 * `graph_status`'s payload: `GraphStatus` from `src/graph.ts`.
 *
 * `graphRevision` and `symbolCount` are optional because the handler leaves them
 * `undefined` when the provider is absent or its `meta.json` is unreadable —
 * `JSON.stringify` drops them from the text channel, and a validator treats an
 * `undefined` property as absent, so both channels agree.
 */
export const GRAPH_STATUS_OUTPUT_SCHEMA: ToolOutputSchema = {
  type: "object",
  description: "The graph provider detected for the project and what its index currently holds",
  properties: {
    provider: GRAPH_PROVIDER,
    available: { type: "boolean", description: "True when a provider index directory exists" },
    root: { type: "string", description: "Absolute path of the provider's index directory" },
    graphRevision: { type: "string", description: "Revision the provider recorded, when it recorded one" },
    symbolCount: { type: "number", description: "Number of index files the provider wrote, when readable" },
  },
  required: ["provider", "available", "root"],
  additionalProperties: false,
};

/**
 * One audit record (`AuditEntry` in `src/types.ts`).
 *
 * Open, like the memory entry: the trail is an append-only log, so a record
 * written by an older build — or a field a later build adds — must still be
 * served instead of failing the call that reads it.
 */
const AUDIT_ENTRY_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    timestamp: { type: "string" },
    operation: { type: "string", description: "The recorded operation (an AuditOperation)" },
    entry_id: { type: "string" },
    project: { type: "string" },
    actor: { type: "string" },
    reason: { type: "string" },
    details: { type: "object", description: "Operation-specific detail", additionalProperties: true },
    prev_hash: { type: "string", description: "Hash of the preceding record in the chain" },
    hash: { type: "string", description: "Salted hash of this record" },
    salt_date: { type: "string", description: "Day partition (YYYY-MM-DD) of the salt the hash used" },
  },
  required: ["timestamp", "operation", "entry_id"],
  additionalProperties: true,
};

/**
 * `memory_audit`'s payload: a page of the append-only trail, newest first.
 *
 * `total` is the length of the page the caller received (the trail is capped by
 * `limit`), not the size of the whole log.
 */
export const MEMORY_AUDIT_OUTPUT_SCHEMA: ToolOutputSchema = {
  type: "object",
  description: "A page of the append-only memory-operation audit trail, newest record first",
  properties: {
    total: { type: "number", description: "Number of records in this page" },
    entries: {
      type: "array",
      items: AUDIT_ENTRY_SCHEMA,
      description: "Matching audit records, newest first, capped by `limit`",
    },
  },
  required: ["total", "entries"],
  additionalProperties: false,
};

/** `LifecycleStats` from `src/promotion/types.ts`. */
const LIFECYCLE_STATS_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    total: { type: "number", description: "Entries in the store" },
    by_status: {
      type: "object",
      description: "Entry count per memory status",
      additionalProperties: { type: "number" },
    },
    by_scope: {
      type: "object",
      description: "Entry count per memory scope",
      additionalProperties: { type: "number" },
    },
    promotion_candidates: { type: "number", description: "Entries a promotion evaluation marks eligible" },
    archival_candidates: { type: "number", description: "Entries an archival evaluation would move off active" },
  },
  required: ["total", "by_status", "by_scope", "promotion_candidates", "archival_candidates"],
  additionalProperties: false,
};

/** What `autoArchiveSweep()` moved, by destination status. */
const SWEEP_RESULT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    swept: { type: "number", description: "Entries whose status the sweep changed" },
    cold: { type: "array", items: { type: "string" }, description: "Ids moved to cold" },
    dormant: { type: "array", items: { type: "string" }, description: "Ids moved to dormant" },
    archived: { type: "array", items: { type: "string" }, description: "Ids moved to archived" },
  },
  required: ["swept", "cold", "dormant", "archived"],
  additionalProperties: false,
};

/**
 * `memory_lifecycle_status`'s payload.
 *
 * `stats` is always present; `sweep` only when the caller asked for one, so it
 * stays out of `required` — the handler emits the key as `undefined` otherwise,
 * which both channels treat as absent.
 */
export const LIFECYCLE_STATUS_OUTPUT_SCHEMA: ToolOutputSchema = {
  type: "object",
  description: "Store-wide lifecycle counters and, when requested, the archival sweep that ran",
  properties: {
    stats: LIFECYCLE_STATS_SCHEMA,
    sweep: SWEEP_RESULT_SCHEMA,
  },
  required: ["stats"],
  additionalProperties: false,
};

/** One row of `MemoryRoiReport.topPerformingMemories`. */
const ROI_PERFORMER_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    successCount: { type: "number", description: "Successful applications recorded for the entry" },
    successRate: { type: "number", description: "The entry's reuse success rate" },
  },
  required: ["id", "title", "successCount", "successRate"],
  additionalProperties: false,
};

/** One row of `MemoryRoiReport.concerningMemories`. */
const ROI_CONCERN_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    failCount: { type: "number", description: "Failed applications recorded for the entry" },
    regressions: { type: "number", description: "Regressions attributed to the entry" },
  },
  required: ["id", "title", "failCount", "regressions"],
  additionalProperties: false,
};

/**
 * `memory_roi`'s payload: `MemoryRoiReport` from `src/quality/utility.ts`.
 *
 * Every field is a counter the handler always emits — the payload is built in
 * one `return` — so the root is closed and nothing is optional.
 */
export const MEMORY_ROI_OUTPUT_SCHEMA: ToolOutputSchema = {
  type: "object",
  description: "Store-wide utility counters and the memories that earned or cost the most reuse value",
  properties: {
    totalMemories: { type: "number", description: "Entries in scope" },
    totalRetrievals: { type: "number" },
    totalApplications: { type: "number" },
    totalSuccessfulApplications: { type: "number" },
    totalFailedApplications: { type: "number" },
    totalRegressions: { type: "number" },
    overallReuseSuccessRate: {
      type: "number",
      description: "Successful applications divided by applications; 1.0 when nothing was applied",
    },
    topPerformingMemories: {
      type: "array",
      items: ROI_PERFORMER_SCHEMA,
      description: "Up to ten entries with the most successful applications",
    },
    concerningMemories: {
      type: "array",
      items: ROI_CONCERN_SCHEMA,
      description: "Up to ten entries with failures or regressions, worst first",
    },
  },
  required: [
    "totalMemories",
    "totalRetrievals",
    "totalApplications",
    "totalSuccessfulApplications",
    "totalFailedApplications",
    "totalRegressions",
    "overallReuseSuccessRate",
    "topPerformingMemories",
    "concerningMemories",
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
  memory_read: MEMORY_READ_OUTPUT_SCHEMA,
  graph_status: GRAPH_STATUS_OUTPUT_SCHEMA,
  memory_audit: MEMORY_AUDIT_OUTPUT_SCHEMA,
  memory_lifecycle_status: LIFECYCLE_STATUS_OUTPUT_SCHEMA,
  memory_roi: MEMORY_ROI_OUTPUT_SCHEMA,
});

/** The schema for one tool, or `undefined` when the tool is text-only. */
export function outputSchemaFor(name: string): ToolOutputSchema | undefined {
  return TOOL_OUTPUT_SCHEMAS[name];
}

/** The catalog tool names covered by this module, sorted for stable output. */
export const STRUCTURED_OUTPUT_TOOLS: readonly string[] = Object.freeze(Object.keys(TOOL_OUTPUT_SCHEMAS).sort());
