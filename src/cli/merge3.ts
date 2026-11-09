import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { requireRoot, usageError } from "./shared.ts";
import type { ParsedArgs } from "./shared.ts";
import { mergeMemories3Way, type MergeConflict, type MergeDecision, type MergeStrategy } from "../quality/branch_merge.ts";
import type { MemoryEntry } from "../types.ts";

function readEntries(path: string): MemoryEntry[] {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(parsed) ? (parsed as MemoryEntry[]) : ((parsed.entries ?? []) as MemoryEntry[]);
}

export async function handleMerge3Command({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const [basePath, oursPath, theirsPath] = positional;
  if (!basePath || !oursPath || !theirsPath) {
    return usageError("merge3 requires <base.json> <ours.json> <theirs.json> [--strategy ours|theirs|semantic|manual]");
  }
  const strategy = (flags["strategy"] ?? "semantic") as MergeStrategy;
  if (!["ours", "theirs", "semantic", "manual"].includes(strategy)) {
    return usageError("--strategy must be ours, theirs, semantic or manual");
  }

  const rl = strategy === "manual" ? createInterface({ input: stdin, output: stdout }) : null;
  const decide = async (conflict: MergeConflict): Promise<MergeDecision | undefined> => {
    if (!rl) return undefined;
    const answer = (await rl.question(`conflict ${conflict.id} (${conflict.reason}) [ours/theirs/skip]: `)).trim();
    return answer === "ours" || answer === "theirs" ? answer : undefined;
  };

  let result = mergeMemories3Way(readEntries(basePath), readEntries(oursPath), readEntries(theirsPath), { strategy });
  if (strategy === "manual" && rl) {
    const resolved = [];
    for (const conflict of result.conflicts) {
      const picked = await decide(conflict);
      if (picked === "ours" && conflict.ours) resolved.push(conflict.ours);
      else if (picked === "theirs" && conflict.theirs) resolved.push(conflict.theirs);
    }
    result = { ...result, merged: [...result.merged, ...resolved] };
    rl.close();
  }

  const output = { merged: result.merged, conflicts: result.conflicts, resolutions: result.resolutions };
  if (flags["out"]) {
    writeFileSync(flags["out"], JSON.stringify(output, null, 2) + "\n", "utf8");
    console.log(`wrote ${result.merged.length} merged, ${result.conflicts.length} conflict(s) to ${flags["out"]}`);
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
  return 0;
}
