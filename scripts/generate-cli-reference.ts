/**
 * Generates `docs/cli-reference.md` — the complete CLI and MCP surface,
 * derived from the source rather than transcribed by hand.
 *
 * Why
 * ---
 * The README's tool table had drifted badly: it listed `memory_capture_negative`
 * (the real name is `memory_negative_capture`), `memory_promote_scope` (real:
 * `memory_promote`), `memory_lifecycle_stats` / `memory_lifecycle_sweep` (real:
 * `memory_lifecycle_status`), `profile_list` (real: `muse_profile_list`) and
 * `anchor_create` (real: `memory_anchor_create`). An agent following that
 * table would call tools that do not exist.
 *
 * A generated reference cannot drift. Regenerate after any CLI or MCP change:
 *   bun run scripts/generate-cli-reference.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { USAGE } from "../src/cli.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = join(ROOT, "docs/cli-reference.md");

/* ── MCP tools ────────────────────────────────────────────────────────────
   Parsed from the single ListTools handler in src/mcp.ts. The handler is a
   flat array of `{ name, description, inputSchema }` objects, so a targeted
   scan of that array is enough — and it cannot disagree with the server. */
interface Tool {
  name: string;
  description: string;
  required: string[];
}

function parseTools(): Tool[] {
  const src = readFileSync(join(ROOT, "src/mcp.ts"), "utf8");
  const start = src.indexOf("server.setRequestHandler(ListToolsRequestSchema");
  if (start === -1) throw new Error("ListTools handler not found in src/mcp.ts");
  const end = src.indexOf("return { tools: ", start);
  const body = src.slice(start, end === -1 ? src.length : end);

  const tools: Tool[] = [];
  const toolRe = /name:\s*"([a-z0-9_]+)",\s*\n\s*description:\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = toolRe.exec(body)) !== null) {
    const name = m[1]!;
    const description = m[2]!
      .replace(/\\n/g, " ")
      .replace(/\\"/g, '"')
      .replace(/\s+/g, " ")
      .trim();
    // Required parameters are read from the inputSchema of the same object.
    const tail = body.slice(m.index, m.index + 4000);
    const reqMatch = tail.match(/required:\s*\[([^\]]*)\]/);
    const required = reqMatch
      ? [...reqMatch[1]!.matchAll(/"([a-z0-9_]+)"/g)].map((r) => r[1]!)
      : [];
    tools.push({ name, description, required });
  }
  // De-duplicate while keeping order.
  const seen = new Set<string>();
  return tools.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)));
}

const tools = parseTools();

/* ── Grouping ─────────────────────────────────────────────────────────────
   The tool names follow a convention, so the grouping can be derived rather
   than curated — and a tool with an unrecognised prefix is reported instead
   of being silently filed somewhere wrong. */
const GROUPS: Array<{ title: string; match: (n: string) => boolean }> = [
  {
    title: "Context & recall",
    match: (n) =>
      /^(get_context|search|muse_context|memory_ranked_retrieval|memory_read|memory_recall|memory_tree_search|memory_wiki_search|memory_wiki_get|memory_entities_search|memory_entities_get|memory_search_transcripts|memory_get_user_profile|memory_code_intel_status|memory_code_intel_symbols|memory_code_intel_blast_radius|muse_code_for_memory|muse_memory_for_code)$/.test(n),
  },
  {
    title: "Capture & lifecycle",
    match: (n) =>
      /^(memory_capture|memory_propose|memory_confirm|memory_supersede|memory_mark_stale|memory_reject|memory_delete|memory_restore|memory_link|memory_negative_capture|memory_harvest|memory_harvest_turn|memory_observe|memory_import|memory_import_transcript|memory_export|memory_consolidate|memory_rollup|memory_archive|memory_rehydrate|memory_lifecycle|memory_lifecycle_status|memory_compress|memory_generalize|memory_promote|memory_curate|memory_evaluate_promotion|memory_flush_pending|memory_distill|memory_distill_observations|memory_distill_route|memory_enrich|memory_feedback|memory_validate|memory_verify|memory_verify_strict|memory_trace|memory_source_add|memory_source_list|memory_claim_record|memory_claim_list|memory_current|memory_set_constraints|memory_get_constraints|memory_user|memory_set_user_profile|memory_settings_get|memory_settings_set|memory_core|memory_id|memory_audit|memory_roi|memory_resolve_conflict|memory_checkpoint|memory_compaction_check|memory_compact_handoff|memory_loops|memory_loop_record|memory_loop_status|memory_prompt_get|memory_prompt_list|memory_prompt_run|memory_freeze_run|memory_freeze_list|confirm_fix|record_session)$/.test(n),
  },
  {
    title: "Code anchors, drift & decisions",
    match: (n) => /anchor|drift|muse_health|muse_code_impact|muse_pr_context|muse_reconcile|muse_tech_debt|muse_bug_clusters|muse_why|pageindex|memory_adr/.test(n),
  },
  {
    title: "Knowledge compounding",
    match: (n) => /^(memory_wiki_compile|memory_entities|memory_extract)/.test(n) || /wiki|entities/.test(n),
  },
  {
    title: "Sync, mesh & team",
    match: (n) => /^(muse_sync|muse_mesh|memory_sync)/.test(n),
  },
  {
    title: "Onboarding & environment",
    match: (n) => /^(memory_connect|memory_detect|memory_migrate|memory_agents|memory_install|memory_setup|graph_|muse_profile_list)/.test(n),
  },
];

const grouped = new Map<string, Tool[]>();
for (const g of GROUPS) grouped.set(g.title, []);
const orphans: Tool[] = [];
for (const t of tools) {
  const g = GROUPS.find((x) => x.match(t.name));
  if (g) grouped.get(g.title)!.push(t);
  else orphans.push(t);
}

const claims = JSON.parse(readFileSync(join(ROOT, "claims.json"), "utf8"));

function esc(s: string): string {
  return s.replace(/\|/g, "\\|");
}

const lines: string[] = [];

lines.push(`# CLI & MCP Reference`);
lines.push("");
lines.push(
  `> **Generated file** — produced by \`scripts/generate-cli-reference.ts\` from ` +
    `\`src/cli.ts\` and \`src/mcp.ts\`. Do not hand-edit: regenerate it after any ` +
    `CLI or MCP change (\`bun run scripts/generate-cli-reference.ts\`).`,
);
lines.push("");
lines.push(
  `This is the complete machine-facing surface. For narrative guidance see ` +
    `[\`agent-reference.md\`](./agent-reference.md); for the human walkthrough see ` +
    `[\`user-guide.md\`](./user-guide.md).`,
);
lines.push("");

lines.push("## Command line");
lines.push("");
lines.push("```bash");
lines.push("memory <command> [arguments] [options]   # alias: musememory");
lines.push("```");
lines.push("");
lines.push("```");
lines.push(USAGE.trim());
lines.push("```");
lines.push("");

lines.push("## MCP tools");
lines.push("");
lines.push(
  `**${tools.length} tools** are registered, exposed through **${claims.mcpProfiles} task-focused ` +
    `profiles** (\`core\`, \`coding\`, \`debugging\`, \`review\`, \`architecture\`, ` +
    `\`maintenance\`, \`full\`). The authoritative machine-readable list is ` +
    `[\`mcp-tool-matrix.json\`](./mcp-tool-matrix.json).`,
);
lines.push("");
lines.push(
  `Select a profile with the \`MUSE_MCP_PROFILE\` environment variable. ` +
    `Call \`muse_profile_list\` for the live mapping.`,
);
lines.push("");

for (const g of GROUPS) {
  const list = grouped.get(g.title)!;
  if (list.length === 0) continue;
  lines.push(`### ${g.title}`);
  lines.push("");
  lines.push("| Tool | Required parameters | Description |");
  lines.push("| --- | --- | --- |");
  for (const t of list) {
    const req = t.required.length ? t.required.map((r) => `\`${r}\``).join(", ") : "—";
    lines.push(`| \`${t.name}\` | ${req} | ${esc(t.description)} |`);
  }
  lines.push("");
}

if (orphans.length) {
  lines.push("### Other");
  lines.push("");
  lines.push("| Tool | Required parameters | Description |");
  lines.push("| --- | --- | --- |");
  for (const t of orphans) {
    const req = t.required.length ? t.required.map((r) => `\`${r}\``).join(", ") : "—";
    lines.push(`| \`${t.name}\` | ${req} | ${esc(t.description)} |`);
  }
  lines.push("");
}

lines.push("---");
lines.push("");
lines.push(
  `Counts in this file are generated from the same source as ` +
    `[\`claims.json\`](../claims.json): ${claims.mcpTools} tools, ` +
    `${claims.mcpProfiles} profiles, ${claims.agentPlatforms} agent platforms, ` +
    `${claims.migratorProviders} import formats, ` +
    `${claims.credentialRuleFamilies} credential rule families.`,
);
lines.push("");

writeFileSync(OUT, lines.join("\n"));
console.log(`Wrote ${OUT} — ${tools.length} MCP tools, ${USAGE.trim().split("\n").length} usage lines.`);
process.exit(0);
