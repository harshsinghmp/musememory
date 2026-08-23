import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { search } from "../retrieval.ts";
import { importTranscript } from "../harvest.ts";
import { harvestMemory } from "../commands/retrieval.ts";
import { searchTranscriptWithBookends } from "../transcript.ts";
import { DEFAULT_CONTEXT_LIMIT } from "../types.ts";
import { requireRoot, printEntry, type ParsedArgs } from "./shared.ts";

function usageError(msg: string): number {
  console.error(`Error: ${msg}`);
  return 2;
}

function fail(msg: string): number {
  console.error(`Error: ${msg}`);
  return 1;
}

export async function handleContextCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const limit = parseInt(flags["limit"] ?? String(DEFAULT_CONTEXT_LIMIT), 10) || DEFAULT_CONTEXT_LIMIT;
  const tokenBudget = flags["token-budget"] ? parseInt(flags["token-budget"], 10) : undefined;
  const query = positional[0] ?? "";
  const res = search(ctx.store, ctx.memoryDir, query, {
    limit,
    tokenBudget,
    project: flags["project"],
    includeSuperseded: false,
    type: flags["type"],
    status: flags["status"],
    verified: flags["verified"] === "true",
  });
  for (const r of res.results) printEntry(r.entry);
  return 0;
}

export async function handleSearchCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  if (positional.length === 0) return usageError("search requires a query");
  const limit = parseInt(flags["limit"] ?? "10", 10) || 10;
  const tokenBudget = flags["token-budget"] ? parseInt(flags["token-budget"], 10) : undefined;
  const res = search(ctx.store, ctx.memoryDir, positional[0], {
    limit,
    tokenBudget,
    includeSuperseded: flags["include-superseded"] === "true",
    type: flags["type"],
    status: flags["status"],
    verified: flags["verified"] === "true",
  });
  for (const r of res.results) {
    const badge = r.entry.status !== "active" ? ` [${r.entry.status}]` : "";
    console.log(`- ${r.entry.id}${badge} score=${r.score.toFixed(3)} (${r.entry.project}) ${r.entry.title}`);
    console.log(`  ${r.entry.content}`);
  }
  console.log(`source=${res.source} stale=${res.stale} count=${res.results.length}${res.totalTokensUsed ? ` tokens=${res.totalTokensUsed}` : ""}`);
  return 0;
}

export async function handleRecallCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const query = positional[0] ?? "";
  const limit = parseInt(flags["limit"] ?? String(DEFAULT_CONTEXT_LIMIT), 10) || DEFAULT_CONTEXT_LIMIT;
  const tokenBudget = flags["token-budget"] ? parseInt(flags["token-budget"], 10) : undefined;
  const res = search(ctx.store, ctx.memoryDir, query, {
    limit,
    tokenBudget,
    project: flags["project"],
    includeSuperseded: false,
    type: flags["type"],
    status: flags["status"],
    verified: flags["verified"] === "true",
  });
  for (const r of res.results) printEntry(r.entry);
  return 0;
}

export async function handleHarvestCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const target = positional[0];
  if (!target) return usageError("harvest requires <text|file> --project P");
  const project = flags["project"];
  if (!project) return usageError("harvest requires --project");
  const rawText = existsSync(target) ? readFileSync(target, "utf8") : target;
  const created = harvestMemory(ctx.store, {
    text: rawText,
    project,
    confirmed: flags["confirmed"] === "true",
  });
  if (created.length === 0) {
    console.log("no distinct harvest units identified");
    return 0;
  }
  const createdIds = created.map((e) => e.id);
  console.log(`harvested ${createdIds.length} memory units: ${createdIds.join(", ")}`);
  return 0;
}

export async function handleImportTranscriptCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const filePath = positional[0];
  if (!filePath) return usageError("import-transcript requires <file.jsonl|text>");
  const project = flags["project"] ?? "default";
  const isConfirmed = flags["confirmed"] === "true";
  const res = importTranscript(ctx.store, filePath, { project, confirmed: isConfirmed });
  console.log(`imported ${res.imported} memory units from transcript: ${res.entries.map((e) => e.id).join(", ")}`);
  if (res.errors.length > 0) {
    for (const err of res.errors) console.error(`  warning: ${err}`);
  }
  return 0;
}

export async function handleSearchTranscriptCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const query = positional[0];
  const filePath = positional[1];
  if (!query) return usageError("search-transcript requires <query> [file.jsonl]");
  const targetFile = filePath ? (filePath.startsWith("/") ? filePath : join(process.cwd(), filePath)) : join(process.cwd(), "transcript.jsonl");
  if (!existsSync(targetFile)) {
    return fail(`error: transcript file not found: ${targetFile}`);
  }
  const windowSize = flags["window"] ? parseInt(flags["window"], 10) : 2;
  const maxMatches = flags["max"] ? parseInt(flags["max"], 10) : 5;
  const res = searchTranscriptWithBookends(targetFile, query, { windowSize, maxMatches });
  console.log(res.formattedSummary);
  return 0;
}
