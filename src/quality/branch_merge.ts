import type { MemoryEntry } from "../types.ts";

export type MergeStrategy = "ours" | "theirs" | "semantic" | "manual";
export type MergeDecision = "ours" | "theirs";

export interface MergeConflict {
  id: string;
  base?: MemoryEntry;
  ours?: MemoryEntry;
  theirs?: MemoryEntry;
  reason: "add/add" | "modify/modify" | "delete/modify" | "delete/delete";
}

export interface ThreeWayResult {
  merged: MemoryEntry[];
  conflicts: MergeConflict[];
  resolutions: Record<string, MergeDecision | "semantic" | "dropped">;
}

export interface ThreeWayOptions {
  strategy?: MergeStrategy;
  decide?: (conflict: MergeConflict) => MergeDecision | undefined;
}

function fingerprint(entry: MemoryEntry): string {
  return JSON.stringify({
    title: entry.title,
    content: entry.content,
    status: entry.status,
    type: entry.type,
    tags: entry.tags ?? [],
    anchors: entry.anchors ?? [],
    valid_from: entry.valid_from,
    valid_to: entry.valid_to,
  });
}

function same(a?: MemoryEntry, b?: MemoryEntry): boolean {
  if (!a || !b) return a === b;
  return fingerprint(a) === fingerprint(b);
}

function semanticWinner(ours: MemoryEntry, theirs: MemoryEntry): MemoryEntry | "conflict" {
  if (ours.supersedes_id === theirs.id) return ours;
  if (theirs.supersedes_id === ours.id) return theirs;
  if (ours.status === "archived" && theirs.status !== "archived") return theirs;
  if (theirs.status === "archived" && ours.status !== "archived") return ours;
  if (ours.content.includes(theirs.content)) return ours;
  if (theirs.content.includes(ours.content)) return theirs;
  return "conflict";
}

/**
 * T-439: three-way merge over memory ids. Resolves add/add, modify/modify and
 * delete/modify with explicit strategies; `semantic` only takes safe winners
 * (supersession, archival, content containment) and reports the rest.
 */
export function mergeMemories3Way(
  base: MemoryEntry[],
  ours: MemoryEntry[],
  theirs: MemoryEntry[],
  options: ThreeWayOptions = {},
): ThreeWayResult {
  const strategy = options.strategy ?? "semantic";
  const maps = {
    base: new Map(base.map((entry) => [entry.id, entry])),
    ours: new Map(ours.map((entry) => [entry.id, entry])),
    theirs: new Map(theirs.map((entry) => [entry.id, entry])),
  };
  const ids = new Set([...maps.base.keys(), ...maps.ours.keys(), ...maps.theirs.keys()]);
  const merged: MemoryEntry[] = [];
  const conflicts: MergeConflict[] = [];
  const resolutions: ThreeWayResult["resolutions"] = {};

  const decide = (conflict: MergeConflict): void => {
    let winner: MemoryEntry | undefined;
    let resolution: ThreeWayResult["resolutions"][string] | undefined;
    if (strategy === "ours") {
      if (!conflict.ours) { resolutions[conflict.id] = "dropped"; return; }
      winner = conflict.ours;
      resolution = "ours";
    } else if (strategy === "theirs") {
      if (!conflict.theirs) { resolutions[conflict.id] = "dropped"; return; }
      winner = conflict.theirs;
      resolution = "theirs";
    } else if (strategy === "semantic" && conflict.ours && conflict.theirs) {
      const picked = semanticWinner(conflict.ours, conflict.theirs);
      if (picked !== "conflict") {
        winner = picked;
        resolution = "semantic";
      }
    } else if (strategy === "manual" && options.decide) {
      const picked = options.decide(conflict);
      if (picked) {
        winner = picked === "ours" ? conflict.ours : conflict.theirs;
        resolution = picked;
      }
    }
    if (winner) {
      merged.push(winner);
      resolutions[conflict.id] = resolution!;
    } else {
      conflicts.push(conflict);
    }
  };

  for (const id of ids) {
    const b = maps.base.get(id);
    const o = maps.ours.get(id);
    const t = maps.theirs.get(id);

    if (o && t) {
      if (!b) {
        if (same(o, t)) { merged.push(o); resolutions[id] = "semantic"; }
        else decide({ id, ours: o, theirs: t, reason: "add/add" });
        continue;
      }
      if (same(o, t)) { merged.push(o); continue; }
      if (same(o, b)) { merged.push(t); resolutions[id] = "theirs"; continue; }
      if (same(t, b)) { merged.push(o); resolutions[id] = "ours"; continue; }
      decide({ id, base: b, ours: o, theirs: t, reason: "modify/modify" });
      continue;
    }

    if (o && !t) {
      if (!b) { merged.push(o); continue; }
      if (same(o, b)) { resolutions[id] = "dropped"; continue; }
      decide({ id, base: b, ours: o, reason: "delete/modify" });
      continue;
    }

    if (t && !o) {
      if (!b) { merged.push(t); continue; }
      if (same(t, b)) { resolutions[id] = "dropped"; continue; }
      decide({ id, base: b, theirs: t, reason: "delete/modify" });
      continue;
    }

    // Deleted on both sides: nothing to merge.
    resolutions[id] = "dropped";
  }

  return { merged, conflicts, resolutions };
}
