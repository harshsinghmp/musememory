import { isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Joins `segs` under `base` and throws if the result escapes `base`.
 *
 * Rejects NUL bytes, absolute segments and lexical traversal (`..`, including
 * sibling prefixes such as `../base-evil`). The target need not exist.
 *
 * shortcut: lexical containment only, no symlink resolution — revisit if .memory accepts less-trusted writes
 */
export function resolveWithin(base: string, ...segs: string[]): string {
  if (!base || base.includes("\0")) {
    throw new Error("resolveWithin: base must be a non-empty path without NUL bytes");
  }
  for (const seg of segs) {
    if (seg.includes("\0")) {
      throw new Error("resolveWithin: path segments must not contain NUL bytes");
    }
    // An absolute segment discards the base entirely; path.join would hide this.
    if (isAbsolute(seg)) {
      throw new Error(`resolveWithin: segment "${seg}" must be relative to the base`);
    }
  }
  if (!segs.length) return resolve(base);

  const resolvedBase = resolve(base);
  const target = resolve(resolvedBase, ...segs);
  const rel = relative(resolvedBase, target);
  // `rel === ".."` or a ".." prefix means escape; "..foo" is a legitimate name.
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`resolveWithin: "${target}" escapes base "${resolvedBase}"`);
  }
  return join(resolvedBase, rel);
}

/**
 * Normalizes a path that is legitimately outside the memory dir (sync pool dir,
 * linked external repos). Rejects NUL bytes only — no containment, by design.
 */
export function resolveExternal(p: string): string {
  if (!p || p.includes("\0")) {
    throw new Error("resolveExternal: path must be a non-empty path without NUL bytes");
  }
  return resolve(p);
}