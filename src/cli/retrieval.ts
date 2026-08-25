import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { queryContext, formatPromptContext, type DisclosureDepth } from "../retrieval.ts";
import { hybridSearch } from "../vector.ts";
import { importTranscript } from "../harvest.ts";
import { harvestMemory } from "../commands/retrieval.ts";
import { installGitHook, harvestAuto } from "../hook.ts";
import { searchTranscriptWithBookends } from "../transcript.ts";
import { DEFAULT_CONTEXT_LIMIT } from "../types.ts";
import { resolveAgentFile, parseAgentMemoryContract } from "../agentcontract.ts";
import { requireRoot, printEntry, usageError, fail, type ParsedArgs } from "./shared.ts";

export async function handleContextCommand({ positional, flags }: ParsedArgs): Promise<number> {
  // SOW-106: resolve agent memory contract before requireRoot so scope=global can flip the flag.
  let agentTypes: string[] | undefined;
  let agentTags: string[] | undefined;
  if (flags["for-agent"]) {
    const file = resolveAgentFile(flags["for-agent"], flags["dir"] ?? process.cwd());
    if (!file) return usageError(`--for-agent: cannot resolve agent '${flags["for-agent"]}'`);
    const contract = parseAgentMemoryContract(readFileSync(file, "utf8"));
    if (contract) {
      agentTypes = contract.types;
      agentTags = contract.tags;
      if (contract.scope === "global") flags["global"] = "true";
    }
  }
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const limit = parseInt(flags["limit"] ?? String(DEFAULT_CONTEXT_LIMIT), 10) || DEFAULT_CONTEXT_LIMIT;
  const tokenBudget = flags["token-budget"] ? parseInt(flags["token-budget"], 10) : undefined;
  const query = positional[0] ?? "";
  const depth = flags["depth"] as DisclosureDepth | undefined;
  if (depth && depth !== "L1" && depth !== "L2" && depth !== "L3") {
    return usageError("--depth must be one of L1|L2|L3");
  }
  if (depth) {
    // Progressive disclosure: render the tiered prompt-injection block
    const formatted = formatPromptContext(ctx.store, ctx.memoryDir, query, {
      limit,
      tokenBudget,
      project: flags["project"],
      includeSuperseded: false,
      type: flags["type"],
      types: agentTypes,
      tags: agentTags,
      status: flags["status"],
      verified: flags["verified"] === "true",
      depth,
    });
    console.log(formatted.markdown);
    return 0;
  }
  const res = queryContext(ctx.store, query, {
    limit,
    tokenBudget,
    project: flags["project"],
    includeSuperseded: false,
    type: flags["type"],
    types: agentTypes,
    tags: agentTags,
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

  // Hybrid vector+BM25 path (requires a built index)
  if (flags["hybrid"] === "true") {
    const hybrid = hybridSearch(ctx.store, ctx.memoryDir, positional[0], { limit });
    if (!hybrid) {
      console.error("no vector index found — run 'memory reindex' first; falling back to live scoring");
    } else {
      for (const r of hybrid) {
        const badge = r.entry.status !== "active" ? ` [${r.entry.status}]` : "";
        console.log(`- ${r.entry.id}${badge} score=${r.score.toFixed(3)} cos=${r.cosine.toFixed(3)} bm25=${r.bm25.toFixed(3)} (${r.entry.project}) ${r.entry.title}`);
        console.log(`  ${r.entry.content}`);
      }
      console.log(`source=hybrid count=${hybrid.length}`);
      return 0;
    }
  }

  const res = queryContext(ctx.store, positional[0], {
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
  const res = queryContext(ctx.store, query, {
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

export async function handleReindexCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const { rebuildIndex, saveIndex } = await import("../vector.ts");
  const index = rebuildIndex(ctx.store);
  saveIndex(index, ctx.memoryDir);
  console.log(`indexed ${Object.keys(index.entries).length} entries -> ${join(ctx.memoryDir, "index.json")}`);
  return 0;
}

export async function handleHookCommand({ positional, flags }: ParsedArgs): Promise<number> {
  if (positional[0] !== "install") return usageError("hook requires install");
  if (flags["git"] !== "true") return usageError("hook install requires --git");
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const result = installGitHook(ctx.root);
  console.log(result.message);
  return result.installed ? 0 : 1;
}

export async function handleHarvestAutoCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const res = harvestAuto(ctx.store, ctx.root, ctx.memoryDir, {
    from: flags["from"],
    project: flags["project"],
  });
  for (const p of res.processed) {
    console.log(`[harvested] ${p.file} -> ${p.movedTo} (${p.imported} unit(s) proposed as candidates)`);
  }
  for (const err of res.errors) {
    console.error(`  warning: ${err}`);
  }
  console.log(res.message);
  return 0;
}
