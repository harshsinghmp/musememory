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
    project: entry.project,
    source: entry.source,
    tags: entry.tags ?? [],
    anchors: entry.anchors ?? [],
    verification: entry.verification ?? null,
    salience: entry.salience ?? null,
    utility: entry.utility ?? null,
    mem_path: entry.mem_path ?? null,
    supersedes_id: entry.supersedes_id ?? null,
    valid_from: entry.valid_from,
    valid_to: entry.valid_to,
    expires_at: entry.expires_at ?? null,
  });
}

function same(a?: MemoryEntry, b?: MemoryEntry): boolean {
  if (!a || !b) return a === b;
  return fingerprint(a) === fingerprint(b);
}

function isProtected(entry: MemoryEntry): boolean {
  if (entry.type === "constraint" || entry.type === "adr") return true;
  const level = entry.verification?.level;
  return level === "authoritative" || level === "independently-verified";
}

function sameAnchors(a: MemoryEntry, b: MemoryEntry): boolean {
  return JSON.stringify(a.anchors ?? []) === JSON.stringify(b.anchors ?? []);
}

/** Strict extension: same type/anchors, losing content is a whole prefix. */
function strictExtension(winner: MemoryEntry, loser: MemoryEntry): boolean {
  if (winner.type !== loser.type || !sameAnchors(winner, loser)) return false;
  if (!winner.content.startsWith(loser.content)) return false;
  const next = winner.content[loser.content.length];
  return next === undefined || /[\s.,;:!?)\]}]/.test(next);
}

function semanticWinner(ours: MemoryEntry, theirs: MemoryEntry): MemoryEntry | "conflict" {
  // Untrusted/self-asserted lineage must never auto-win a merge.
  if (ours.trust === "untrusted" || theirs.trust === "untrusted") return "conflict";
  if (isProtected(ours) || isProtected(theirs)) return "conflict";

  const live = new Set(["active", "confirmed"]);
  if (ours.status === "archived" && live.has(theirs.status)) return theirs;
  if (theirs.status === "archived" && live.has(ours.status)) return ours;

  if (strictExtension(ours, theirs)) return ours;
  if (strictExtension(theirs, ours)) return theirs;
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
