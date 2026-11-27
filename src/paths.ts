import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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

/**
 * True when `candidate` is `root` itself or lives beneath it.
 *
 * Purely lexical (`..` and `../root-evil` are handled, `..foo` is a real name);
 * a caller that must not be fooled by a symlinked prefix canonicalizes both
 * sides first with `realishPath`.
 */
export function isWithinRoot(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const rel = relative(resolvedRoot, resolve(candidate));
  if (rel === "") return true;
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Resolve `p` to an absolute path with every *existing* prefix canonicalized
 * through `fs.realpathSync`, then the not-yet-existing tail re-appended.
 *
 * `resolve()` alone is lexical, so `<root>/link/child` where `link` points at
 * `/etc` still reads as "inside `<root>`" — and a containment check that trusts
 * that answer is what lets a request-supplied directory escape. `realpathSync`
 * cannot answer for a path that does not exist yet, so the walk goes up to the
 * nearest ancestor that does; everything below it does not exist and therefore
 * cannot be a symlink.
 *
 * Throws on an empty path or one containing a NUL byte, both of which are
 * unrepresentable as a filesystem path anyway.
 */
export function realishPath(p: string): string {
  if (!p || p.includes("\0")) {
    throw new Error("realishPath: path must be a non-empty string without NUL bytes");
  }
  const resolved = resolve(p);
  const missing: string[] = [];
  let current = resolved;
  for (;;) {
    try {
      const real = realpathSync(current);
      return missing.length === 0 ? real : resolve(real, ...missing.reverse());
    } catch {
      const parent = dirname(current);
      // The filesystem root always exists; if even it does not resolve, fall
      // back to the lexical answer rather than looping.
      if (parent === current) return resolved;
      missing.push(basename(current));
      current = parent;
    }
  }
}