import type { Store } from "../store.ts";
import { list } from "../store.ts";

/**
 * T-406: sorted unique project names present in the store, canonical casing.
 */
export function listProjectNames(store: Store): string[] {
  return [
    ...new Set(
      list(store)
        .map((e) => e.project)
        .filter((p): p is string => Boolean(p)),
    ),
  ].sort();
}

/**
 * T-406: resolve a user-supplied project name to the canonical store casing.
 *
 * Exact match wins — a store holding both `alpha` and `ALPHA` is resolved by
 * exactly what the caller asked for. Otherwise a UNIQUE case-insensitive
 * match returns the store's own spelling. No match — or an AMBIGUOUS one
 * (two projects differing only in case) — returns `undefined` so the caller
 * can fail loudly and list what is actually available.
 *
 * The gate's own compare (`listForProject`) stays exact-canonical; this is
 * the user-input layer, not a store rewrite.
 */
export function resolveProjectName(store: Store, requested?: string): string | undefined {
  const name = requested?.trim();
  if (!name) return undefined;
  const projects = listProjectNames(store);
  if (projects.includes(name)) return name;
  const matches = projects.filter((p) => p.toLowerCase() === name.toLowerCase());
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * T-406: render the available project list for loud-failure messages — one
 * formatter so the three surfaces cannot drift apart in wording.
 */
export function formatAvailable(store: Store): string {
  const available = listProjectNames(store);
  return available.length > 0 ? available.join(", ") : "none";
}
