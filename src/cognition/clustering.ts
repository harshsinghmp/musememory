import type { Store } from "../store.ts";
import { list } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import type { BugCluster } from "./types.ts";

interface CategoryDefinition {
  category: BugCluster["category"];
  keywords: string[];
  hypothesis: string;
  recommendation: string;
}

const CATEGORIES: CategoryDefinition[] = [
  {
    category: "race_condition",
    keywords: ["race", "concurren", "async", "timing", "lock", "deadlock", "await", "parallel", "interleaving"],
    hypothesis: "Asynchronous state mutation or uncoordinated shared memory between parallel operations",
    recommendation: "Introduce atomic transactions, explicit mutex locks, or single-writer event queues",
  },
  {
    category: "type_drift",
    keywords: ["type", "cast", "any", "undefined", "null", "nan", "shape", "mismatch", "interface", "signature"],
    hypothesis: "Inconsistent schema boundaries or runtime data shape drifting from static TypeScript definitions",
    recommendation: "Enforce strict runtime schema validation (e.g. Zod) at system boundaries and eliminate 'as any' casts",
  },
  {
    category: "missing_guard",
    keywords: ["validation", "sanitize", "guard", "boundary", "bounds", "empty", "regex", "injection", "check"],
    hypothesis: "Insufficient pre-condition validation or defensive boundary checking on input parameters",
    recommendation: "Add fail-fast input validation assertions and comprehensive boundary condition unit tests",
  },
  {
    category: "resource_leak",
    keywords: ["leak", "timeout", "hang", "unhandled", "memory", "listener", "connection", "socket", "file descriptor"],
    hypothesis: "Dangling asynchronous resources, unclosed handles, or unhandled promise rejections",
    recommendation: "Implement explicit lifecycle cleanup (dispose/close) and universal unhandled rejection handlers",
  },
  {
    category: "architecture_flaw",
    keywords: ["circular", "coupling", "monolith", "layer", "inversion", "dependency", "bypass", "spaghetti"],
    hypothesis: "High coupling between components violating separation of concerns or clean layering",
    recommendation: "Refactor into decoupled domain interfaces with dependency injection and single-responsibility modules",
  },
];

function classifyBug(entry: MemoryEntry): BugCluster["category"] {
  const text = `${entry.title} ${entry.content} ${entry.tags?.join(" ") || ""}`.toLowerCase();

  for (const cat of CATEGORIES) {
    if (cat.keywords.some((kw) => text.includes(kw))) {
      return cat.category;
    }
  }

  return "general_bug";
}

/**
 * Clusters recurring bug fixes, negative lessons, and failure records into architectural fragility hotspots.
 */
export function clusterRecurringBugsAndFriction(store: Store): BugCluster[] {
  const entries = list(store);
  const bugEntries = entries.filter(
    (e) =>
      e.status !== "archived" &&
      (e.type === "fix" ||
        e.type === "negative" ||
        e.negative != null ||
        e.tags?.includes("bug") ||
        e.tags?.includes("fix") ||
        e.tags?.includes("failure") ||
        e.tags?.includes("error"))
  );

  const clusterMap = new Map<
    BugCluster["category"],
    {
      entries: MemoryEntry[];
      paths: Set<string>;
      symbols: Set<string>;
    }
  >();

  for (const entry of bugEntries) {
    const cat = classifyBug(entry);
    let group = clusterMap.get(cat);
    if (!group) {
      group = { entries: [], paths: new Set(), symbols: new Set() };
      clusterMap.set(cat, group);
    }

    group.entries.push(entry);

    // Extract code anchors
    if (entry.anchors) {
      for (const anc of entry.anchors) {
        if (anc.file_path) group.paths.add(anc.file_path);
        if (anc.symbol_name) group.symbols.add(anc.symbol_name);
      }
    }

    // Extract backticks
    const backticks = entry.content.match(/`([^`]+)`/g) || [];
    for (const bt of backticks) {
      const raw = bt.replace(/`/g, "").trim();
      if (raw.includes(".") || raw.includes("/")) {
        group.paths.add(raw);
      } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]+$/.test(raw)) {
        group.symbols.add(raw);
      }
    }
  }

  const clusters: BugCluster[] = [];

  for (const [cat, group] of clusterMap.entries()) {
    const count = group.entries.length;
    const catMeta = CATEGORIES.find((c) => c.category === cat);

    // Fragility score: base on frequency and recurrence across symbols
    const recurrenceFactor = Math.min(1.0, count / 5);
    const spreadFactor = Math.min(1.0, (group.paths.size + group.symbols.size) / 4);
    const fragility = Number(Math.min(1.0, recurrenceFactor * 0.7 + spreadFactor * 0.3).toFixed(2));

    clusters.push({
      cluster_id: `cluster_${cat}_${count}`,
      category: cat,
      affected_paths: Array.from(group.paths),
      affected_symbols: Array.from(group.symbols),
      occurrence_count: count,
      fragility_score: fragility,
      sample_fixes: group.entries.slice(0, 5).map((e) => ({ id: e.id, title: e.title })),
      root_cause_hypothesis: catMeta?.hypothesis || "Repeated system defects requiring systematic testing",
      preventative_recommendation: catMeta?.recommendation || "Implement comprehensive regression test suites",
    });
  }

  return clusters.sort((a, b) => b.fragility_score - a.fragility_score);
}
