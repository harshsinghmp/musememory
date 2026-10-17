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

/**
 * T-392: Validate embedderUrl against SSRF, cloud metadata injection, and dangerous protocols.
 * - Enforces http: or https:
 * - Restricts plain http: to loopback addresses (localhost, 127.0.0.1, ::1, 0.0.0.0) unless allowInsecureHttp is set.
 * - Blocks link-local metadata addresses (169.254.169.254, 169.254.0.0/16, metadata.google.internal).
 */
export function validateEmbedderUrl(
  urlStr: string,
  options: { allowInsecureHttp?: boolean } = {},
): { valid: boolean; error?: string } {
  if (!urlStr || typeof urlStr !== "string") {
    return { valid: false, error: "embedderUrl must be a non-empty string" };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, error: `Invalid URL format: "${urlStr}"` };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      valid: false,
      error: `Invalid protocol: "${parsed.protocol}". Only 'http:' and 'https:' are allowed`,
    };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Cloud metadata & link-local address defense
  if (
    hostname === "169.254.169.254" ||
    hostname.startsWith("169.254.") ||
    hostname === "metadata.google.internal" ||
    hostname.endsWith(".metadata.google.internal") ||
    hostname.startsWith("fe80:")
  ) {
    return {
      valid: false,
      error: `Access to cloud metadata or link-local address "${hostname}" is forbidden`,
    };
  }

  const isLoopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0";

  if (parsed.protocol === "http:" && !isLoopback && !options.allowInsecureHttp) {
    return {
      valid: false,
      error: `Remote embedder endpoint "${urlStr}" must use HTTPS (plain HTTP is restricted to local loopback)`,
    };
  }

  return { valid: true };
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
    // T-392: Validate embedderUrl
    if (r.embedderUrl) {
      const urlCheck = validateEmbedderUrl(r.embedderUrl);
      if (!urlCheck.valid && urlCheck.error) {
        errors.push(`retrieval.embedderUrl: ${urlCheck.error}`);
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
