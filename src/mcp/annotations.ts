/**
 * Safety hints for every tool on `tools/list`.
 *
 * Why this exists
 * ---------------
 * The catalog advertised 126 tools with a name, a description and an input
 * schema, and nothing else — so a host had no machine-readable way to tell
 * `memory_read` from `memory_delete` without parsing 126 prose descriptions.
 * The practical consequence is that every call needs the same human approval
 * prompt, which is why servers that expose a large surface get switched off.
 *
 * The protocol's answer is four boolean hints on each tool:
 *   - `readOnlyHint`     — the tool does not modify its environment, so a host
 *                          may auto-approve it;
 *   - `destructiveHint`  — the tool can delete or overwrite data, so a host
 *                          should warn before running it;
 *   - `idempotentHint`   — repeating the call with the same arguments has no
 *                          further effect, so a host may retry it safely;
 *   - `openWorldHint`    — the tool reaches outside this machine.
 *
 * These are **hints**, not guarantees: the SDK's own type docs say a client
 * must not make trust decisions about an untrusted server from them. They are
 * still worth getting right, because the cost of a wrong `readOnlyHint: true`
 * is a silently approved write.
 *
 * How the 126 tools are classified
 * --------------------------------
 * By what the dispatch table actually does, not by the sound of the name:
 *
 *   - `READ_ONLY_TOOLS` — every handler that only reads. Search and context
 *     tools enqueue retrieval bookkeeping (utility/salience counters) through
 *     the deferred write queue in `src/mcp.ts`; that is internal telemetry
 *     about the read itself and never changes an entry's content, status or
 *     links, so the tools stay read-only for auto-approval purposes.
 *     `muse_sync_broadcast` is here because it renders a packet and persists
 *     nothing; `memory_verify_strict`, `memory_drift`, `memory_anchor_*`,
 *     `muse_health` and `muse_tech_debt` are here because their scans return a
 *     report and write nothing.
 *   - `CONVERGING_WRITE_TOOLS` — writes whose repetition lands on the same
 *     state: status transitions (`confirm`, `reject`, `archive`, `promote`),
 *     `set`-style updates, and builders that regenerate a derived artefact.
 *   - `ACCUMULATING_WRITE_TOOLS` — appends and run-type tools where a second
 *     call adds a second row, observation, snapshot or round: `capture`,
 *     `observe`, `record_session`, `freeze_run`, `test_feedback`, `verify`.
 *   - `DESTRUCTIVE_WRITE_TOOLS` — deletes, the lifecycle `forget` verb, the
 *     snapshot import that can overwrite an existing entry, the PageIndex
 *     disconnect that removes its indexes, and the anchor reconcile that
 *     prunes anchors.
 *
 * `openWorldHint` is `false` on all 126. That is a reviewed finding, not a
 * default: nothing in `src/` calls `fetch`, `node:https` or undici, and no
 * handler dereferences a URL — `memory_source_add` *records* a URL in the
 * provenance ledger without retrieving it, and `muse_sync_*` exchange packets
 * through a local directory. `test/mcp_annotations.test.ts` pins the count at
 * zero, so adding a tool that talks to the network has to revisit this file.
 *
 * Coverage
 * --------
 * `TOOL_ANNOTATIONS` must hold all 126 catalog names; a test asserts set
 * equality in both directions. `defaultAnnotation()` is what `tools/list` falls
 * back to for a name that is not in the map, so a tool added to the catalog
 * tomorrow is never advertised unannotated: it is served as *not* read-only,
 * *destructive*, *not* idempotent and *not* open-world — the conservative
 * reading of "unknown", which makes a host warn instead of auto-approving
 * something nobody classified.
 */
import type { Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { MCP_TOOL_CATALOG } from "./catalog.ts";

/** A read: no entry content, status or link is changed. */
const READ_ONLY_HINTS: ToolAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/** A write whose repetition lands on the same state. */
const CONVERGING_WRITE_HINTS: ToolAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/** A write where a second call adds a second row, observation or run. */
const ACCUMULATING_WRITE_HINTS: ToolAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
});

/** A write that can remove or overwrite what the store already holds. */
const DESTRUCTIVE_WRITE_HINTS: ToolAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
});

/**
 * What `tools/list` serves for a name this map does not know.
 *
 * Deliberately the pessimistic reading of "unknown": never advertised as a
 * read, flagged destructive so a host warns, and never assumed retry-safe.
 * `openWorldHint` stays `false` because every tool this server ships is local
 * and a false "reaches the internet" warning is its own kind of lie.
 */
export function defaultAnnotation(_name: string): ToolAnnotations {
  return Object.freeze({
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  });
}

/** Handlers that only read. `memory_verify_strict`/`memory_drift` are scans. */
const READ_ONLY_TOOLS: readonly string[] = [
  // retrieval and context
  "search",
  "get_context",
  "memory_read",
  "memory_recall",
  "memory_get_constraints",
  "memory_get_user_profile",
  "memory_trace",
  "memory_loops",
  "memory_tree_search",
  "memory_ranked_retrieval",
  "memory_search_transcripts",
  "memory_pageindex_search",
  "memory_entities_get",
  "memory_entities_search",
  "memory_wiki_get",
  "memory_wiki_search",
  "memory_compress",
  "memory_generalize",
  "memory_compaction_check",
  "memory_evaluate_promotion",
  // indexes and code intelligence (all read-only queries)
  "graph_status",
  "memory_code_intel_status",
  "memory_code_intel_symbols",
  "memory_code_intel_blast_radius",
  "memory_anchor_verify",
  "memory_anchor_audit",
  // ledgers, settings and history
  "memory_audit",
  "memory_export",
  "memory_validate",
  "memory_verify_strict",
  "memory_drift",
  "memory_drift_audit",
  "memory_roi",
  "memory_lifecycle_status",
  "memory_settings_get",
  "memory_source_list",
  "memory_claim_list",
  "memory_freeze_list",
  "memory_prompt_list",
  "memory_prompt_get",
  "memory_prompt_run",
  "memory_loop_status",
  "memory_adr_list",
  // environment scans (read the machine, write nothing)
  "memory_detect_providers",
  "memory_detect_agents",
  // muse — read-only analyses
  "muse_context",
  "muse_code_for_memory",
  "muse_memory_for_code",
  "muse_profile_list",
  "muse_why",
  "muse_bug_clusters",
  "muse_tech_debt",
  "muse_health",
  "muse_preflight",
  "muse_episodes",
  "muse_playbook_recall",
  "muse_code_impact",
  "muse_pr_context",
  "muse_regression_sentry",
  "muse_flaky_tests",
  "muse_remediation_playbooks",
  "muse_enclave_recall",
  "muse_overlay_status",
  "muse_attestation_verify",
  "muse_mesh_status",
  "muse_mesh_query",
  "muse_mesh_audit",
  "muse_sync_broadcast",
  "muse_sync_status",
];

/** Writes that converge: a second identical call changes nothing further. */
const CONVERGING_WRITE_TOOLS: readonly string[] = [
  // lifecycle / status transitions
  "memory_confirm",
  "confirm_fix",
  "memory_supersede",
  "memory_resolve_conflict",
  "memory_mark_stale",
  "memory_reject",
  "memory_archive",
  "memory_rehydrate",
  "memory_promote",
  "memory_flush_pending",
  "memory_link",
  // set-style updates
  "memory_set_user_profile",
  "memory_core",
  "memory_settings_set",
  "memory_checkpoint",
  "memory_compact_handoff",
  // builders that regenerate a derived artefact
  "memory_consolidate",
  "memory_rollup",
  "memory_wiki_compile",
  "memory_distill",
  "memory_distill_route",
  "memory_distill_observations",
  "graph_index",
  "memory_pageindex_index",
  // attach / enrich / wire operations that replace rather than append
  "memory_anchor_create",
  "memory_enrich",
  "memory_connect",
  "memory_migrate",
  "muse_mesh_link",
];

/** Writes where a second call adds a second row, observation, run or round. */
const ACCUMULATING_WRITE_TOOLS: readonly string[] = [
  "memory_capture",
  "memory_current",
  "memory_set_constraints",
  "memory_harvest",
  "memory_harvest_turn",
  "memory_import_transcript",
  "memory_pageindex_import",
  "record_session",
  "memory_observe",
  "memory_freeze_run",
  "memory_loop_record",
  "memory_feedback",
  "memory_test_feedback",
  "memory_negative_capture",
  "memory_curate",
  "memory_source_add",
  "memory_claim_record",
  "memory_adr_record",
  "muse_playbook_record",
  "muse_sync_ingest",
  "muse_sync_pool",
  "memory_verify",
];

/** Writes that can remove or overwrite what the store already holds. */
const DESTRUCTIVE_WRITE_TOOLS: readonly string[] = [
  "memory_delete", // tombstone / permanent delete
  "memory_lifecycle", // the `forget` verb
  "memory_restore", // replay=true rebuilds the content from the audit ledger
  "memory_import", // overwrite: true replaces an existing entry
  "memory_disconnect_pageindex", // removes the PageIndex trees
  "muse_reconcile_anchors", // prune=true drops drifted/orphaned anchors
];

function assign(
  names: readonly string[],
  hints: ToolAnnotations,
): Record<string, ToolAnnotations> {
  return Object.fromEntries(names.map((name) => [name, hints]));
}

/**
 * Every catalog tool name mapped to its safety hints.
 *
 * A `Record`, not an array, so the `tools/list` mapping is a hash lookup and a
 * missing name is visible as `undefined` rather than a silent shift. Frozen:
 * the hints are data, and nothing may rewrite them per request.
 */
export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = Object.freeze({
  ...assign(READ_ONLY_TOOLS, READ_ONLY_HINTS),
  ...assign(CONVERGING_WRITE_TOOLS, CONVERGING_WRITE_HINTS),
  ...assign(ACCUMULATING_WRITE_TOOLS, ACCUMULATING_WRITE_HINTS),
  ...assign(DESTRUCTIVE_WRITE_TOOLS, DESTRUCTIVE_WRITE_HINTS),
});

/** The hints for one tool, falling back to the conservative default. */
export function annotationsFor(name: string): ToolAnnotations {
  return TOOL_ANNOTATIONS[name] ?? defaultAnnotation(name);
}

/**
 * The catalog with `annotations` attached, built **once** at module load.
 *
 * Why a derived array and not a mutation: `MCP_TOOL_CATALOG` is the wire
 * description everything else reads (the claims generator, the CLI reference,
 * `test/retrieval.test.ts`), and rewriting it in place would make the annotated
 * form the only form — a second server in the same process, or a test that
 * asserts the shipped schemas, would then see annotations it never asked for.
 * The source array stays exactly what it is; this is the served projection.
 *
 * Only `annotations` is added. Name, description, input schema and order are
 * untouched, so the rest of the wire surface is byte-identical.
 */
export const ANNOTATED_TOOL_CATALOG: Tool[] = MCP_TOOL_CATALOG.map((tool) => ({
  ...tool,
  annotations: annotationsFor(tool.name),
}));
