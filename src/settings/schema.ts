import type { GlobalSettings } from "./types.ts";

const SAFE_PATH_REGEX = /^[a-zA-Z0-9_\/\.-]+$/;

export function validateSafePath(path: string, context = "Path"): void {
  if (!path || typeof path !== "string") {
    throw new Error(`${context}: invalid or missing path`);
  }
  if (path.includes("..") || path.startsWith("/") || path.includes("\\")) {
    throw new Error(`${context}: path traversal not allowed ("${path}")`);
  }
  if (!SAFE_PATH_REGEX.test(path)) {
    throw new Error(`${context}: path contains invalid characters ("${path}")`);
  }
}

export function validateSettings(settings: Partial<GlobalSettings>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (settings.retrieval) {
    const r = settings.retrieval;
    if (r.defaultMode && !["tree", "vector", "hybrid"].includes(r.defaultMode)) {
      errors.push(`retrieval.defaultMode must be one of 'tree', 'vector', 'hybrid'`);
    }
    if (r.defaultTokenBudget !== undefined && (r.defaultTokenBudget <= 0 || !Number.isInteger(r.defaultTokenBudget))) {
      errors.push(`retrieval.defaultTokenBudget must be a positive integer`);
    }
    if (r.defaultDisclosureDepth && !["L1", "L2", "L3"].includes(r.defaultDisclosureDepth)) {
      errors.push(`retrieval.defaultDisclosureDepth must be one of 'L1', 'L2', 'L3'`);
    }
    if (r.hybridVectorWeight !== undefined && r.hybridTreeWeight !== undefined) {
      if (Math.abs(r.hybridVectorWeight + r.hybridTreeWeight - 1.0) > 0.001) {
        errors.push(`retrieval weights (hybridVectorWeight + hybridTreeWeight) must sum to 1.0`);
      }
    }
  }

  if (settings.wiki) {
    const w = settings.wiki;
    if (w.outputDir) {
      try {
        validateSafePath(w.outputDir, "wiki.outputDir");
      } catch (err: any) {
        errors.push(err.message);
      }
    }
    if (w.minClusterSize !== undefined && w.minClusterSize <= 0) {
      errors.push(`wiki.minClusterSize must be positive`);
    }
  }

  if (settings.pageindex) {
    const p = settings.pageindex;
    if (p.storagePath) {
      try {
        validateSafePath(p.storagePath, "pageindex.storagePath");
      } catch (err: any) {
        errors.push(err.message);
      }
    }
  }

  if (settings.ui) {
    const u = settings.ui;
    if (u.defaultMode && !["tree", "graph", "timeline", "cluster"].includes(u.defaultMode)) {
      errors.push(`ui.defaultMode must be 'tree', 'graph', 'timeline', or 'cluster'`);
    }
    if (u.graphEngine && !["barnes-hut", "webgl", "auto"].includes(u.graphEngine)) {
      errors.push(`ui.graphEngine must be 'barnes-hut', 'webgl', or 'auto'`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
