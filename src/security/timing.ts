/**
 * Issue #513 — one constant-time comparison for every shared secret in the tree.
 *
 * The MCP HTTP bearer tokens and the Studio token are opaque shared secrets. They
 * used to be checked with `Set.has()` / `===`, which compares the first differing
 * byte and returns — a timing side channel that leaks how much of a guess was
 * correct, and (for the `Set` lookup) the length of the configured token. This
 * module is the single replacement so no call site grows its own version.
 *
 * `node:crypto` is used rather than a hand-rolled XOR loop because V8 is free to
 * transform a JavaScript loop and `timingSafeEqual` is the platform's documented
 * constant-time primitive. It is available on every runtime the package supports
 * (Node.js >= 18 and Bun).
 */
import { timingSafeEqual } from "node:crypto";

/**
 * Compare two secrets without leaking their contents (or their length) through
 * timing.
 *
 * Contract:
 * - identical strings → `true`, including `""` vs `""`;
 * - same byte length, different content → `false`;
 * - different byte length → `false`, after one comparison of the same width is
 *   still performed, so the early return costs the same as a content mismatch
 *   and a caller cannot measure the configured token's length;
 * - empty vs non-empty → `false`, and it goes through that same burned
 *   comparison, so "no credential presented" is not distinguishable from a
 *   wrong one.
 *
 * Strings are compared as UTF-8 bytes: a token is an opaque byte sequence, so
 * two strings that are canonically equivalent but not byte-identical are not the
 * same credential.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;

  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    // Burn a comparison over zero-padded copies of the longer width. The result
    // is deliberately discarded: the inputs differ in length, so they cannot be
    // equal, but the timing must not say so before the work has been done.
    const width = Math.max(left.length, right.length);
    const paddedLeft = Buffer.alloc(width);
    const paddedRight = Buffer.alloc(width);
    left.copy(paddedLeft);
    right.copy(paddedRight);
    timingSafeEqual(paddedLeft, paddedRight);
    return false;
  }

  // `timingSafeEqual` throws when the buffers differ in length, which the guard
  // above already rules out; the empty-vs-empty case compares two zero-length
  // buffers and returns true, matching string equality.
  return timingSafeEqual(left, right);
}
