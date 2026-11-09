import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stderr } from "node:process";
import { requireRoot, usageError } from "./shared.ts";
import type { ParsedArgs } from "./shared.ts";
import { mergeMemories3Way, type MergeConflict, type MergeStrategy } from "../quality/branch_merge.ts";
import { scanSecrets } from "../secrets.ts";
import type { MemoryEntry } from "../types.ts";

function readEntries(path: string): MemoryEntry[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const entries = Array.isArray(parsed) ? parsed : (parsed as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) throw new Error(`${path} is not a memory snapshot`);
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || typeof (entry as MemoryEntry).id !== "string" || typeof (entry as MemoryEntry).content !== "string") {
      throw new Error(`${path} contains an invalid memory entry`);
    }
  }
  return entries as MemoryEntry[];
}

export async function handleMerge3Command({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  try {
    const [basePath, oursPath, theirsPath] = positional;
    if (!basePath || !oursPath || !theirsPath) {
      return usageError("merge3 requires <base.json> <ours.json> <theirs.json> [--strategy ours|theirs|semantic|manual]");
    }
    const strategy = (flags["strategy"] ?? "semantic") as MergeStrategy;
    if (!["ours", "theirs", "semantic", "manual"].includes(strategy)) {
      return usageError("--strategy must be ours, theirs, semantic or manual");
    }

    const result = mergeMemories3Way(readEntries(basePath), readEntries(oursPath), readEntries(theirsPath), { strategy });
    let conflicts = result.conflicts;

    if (strategy === "manual" && conflicts.length > 0) {
      if (!stdin.isTTY) return usageError("--strategy manual requires an interactive terminal");
      const rl = createInterface({ input: stdin, output: stderr });
      try {
        for (const conflict of conflicts) {
          const choices = [conflict.ours ? "ours" : null, conflict.theirs ? "theirs" : null].filter(Boolean).join("/");
          const answer = (await rl.question(`conflict ${conflict.id} (${conflict.reason}) [${choices}/skip]: `)).trim();
          if (answer === "ours" && conflict.ours) {
            result.merged.push(conflict.ours);
            result.resolutions[conflict.id] = "ours";
          } else if (answer === "theirs" && conflict.theirs) {
            result.merged.push(conflict.theirs);
            result.resolutions[conflict.id] = "theirs";
          }
        }
      } finally {
        rl.close();
      }
      conflicts = conflicts.filter((conflict) => !(conflict.id in result.resolutions));
    }

    const output = { merged: result.merged, conflicts, resolutions: result.resolutions };
    const serialized = JSON.stringify(output, null, 2) + "\n";
    const leaked = scanSecrets(serialized);
    if (leaked.length > 0) return usageError(`refusing to emit a credential: ${leaked[0]}`);
    if (flags["out"]) {
      writeFileSync(flags["out"], serialized, { encoding: "utf8", mode: 0o600 });
      console.log(`wrote ${result.merged.length} merged, ${conflicts.length} conflict(s) to ${flags["out"]}`);
    } else {
      console.log(serialized);
    }
    return conflicts.length > 0 && flags["allow-conflicts"] === undefined ? 1 : 0;
  } catch (err) {
    return usageError(err instanceof Error ? err.message : String(err));
  }
}
