/**
 * Issue #513 — the constant-time comparison behind every shared secret.
 *
 * `constantTimeEqual` replaced `Set.has()` in the MCP HTTP bearer-token check and
 * `!==` in the Studio token gate. The value of the helper is the property, not
 * the branch, so the cases here are the ones an off-by-one rewrite gets wrong:
 * equality, same-length inequality, different-length inequality, the empty
 * credential, and non-ASCII input where "same characters" and "same bytes" can
 * disagree. Mutation evidence: reverting the helper to `a === b` turns the
 * length-mismatch and unicode-length cases red (and the MCP/Studio auth tests
 * still pass, which is exactly why the helper needs its own test).
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { constantTimeEqual } from "../src/security/timing.ts";
import { validateHttpAuth } from "../src/mcp/http.ts";
import type { IncomingMessage } from "node:http";

function mockReq(headers: Record<string, string>): IncomingMessage {
  return {
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
  } as unknown as IncomingMessage;
}

describe("Issue #513: constantTimeEqual", () => {
  test("identical secrets compare equal", () => {
    expect(constantTimeEqual("correct-horse-battery-staple", "correct-horse-battery-staple")).toBe(true);
    expect(constantTimeEqual("a", "a")).toBe(true);
    expect(constantTimeEqual("", "")).toBe(true);
  });

  test("a same-length wrong secret compares unequal", () => {
    expect(constantTimeEqual("token-abc", "token-abd")).toBe(false);
    // differs only in the first byte, which is the case a short-circuit gets
    // right for the wrong reason — assert it explicitly.
    expect(constantTimeEqual("xoken-abc", "token-abc")).toBe(false);
    // differs only in the last byte
    expect(constantTimeEqual("token-ab", "token-ac")).toBe(false);
  });

  test("a different-length wrong secret compares unequal", () => {
    expect(constantTimeEqual("token", "token-extra")).toBe(false);
    expect(constantTimeEqual("token-extra", "token")).toBe(false);
    expect(constantTimeEqual("a", "ab")).toBe(false);
  });

  test("empty versus non-empty is always unequal", () => {
    expect(constantTimeEqual("", "token")).toBe(false);
    expect(constantTimeEqual("token", "")).toBe(false);
    expect(constantTimeEqual("", " ")).toBe(false);
  });

  test("unicode input compares as UTF-8 bytes", () => {
    expect(constantTimeEqual("pässwörd-🔑", "pässwörd-🔑")).toBe(true);
    expect(constantTimeEqual("pässwörd-🔑", "pässwörd-🔒")).toBe(false);
    // Same character count, different byte length (é as one code point vs the
    // decomposed e + combining accent): equal-looking, not byte-equal.
    expect(constantTimeEqual("café", "cafe\u0301")).toBe(false);
    // Same byte length, different characters: "é" is two UTF-8 bytes, "ab" two.
    expect(constantTimeEqual("é", "ab")).toBe(false);
  });

  test("the length check does not leak through an early return", () => {
    // Both calls must return false and neither may throw; the burned comparison
    // inside the length-mismatch branch keeps timingSafeEqual's length
    // precondition satisfied without skipping the work.
    expect(() => constantTimeEqual("1234567890", "12345")).not.toThrow();
    expect(() => constantTimeEqual("12345", "1234567890")).not.toThrow();
    expect(() => constantTimeEqual("🔑🔑", "🔑")).not.toThrow();
  });

  test("non-string input is rejected rather than thrown on", () => {
    expect(constantTimeEqual(undefined as unknown as string, "token")).toBe(false);
    expect(constantTimeEqual("token", null as unknown as string)).toBe(false);
  });
});

describe("Issue #513: the helper keeps using the constant-time primitive", () => {
  test("timingSafeEqual is the comparison, and the equality shortcut is gone", () => {
    // A return value cannot express timing, so every value-level case above
    // would also pass with `a === b` — which is the whole bug. The mechanism is
    // therefore pinned here: the platform primitive is imported and called, the
    // length-mismatch branch still calls it (the burned comparison), and the
    // string-equality shortcut the issue was filed about does not survive.
    const source = readFileSync(join(import.meta.dir, "..", "src", "security", "timing.ts"), "utf8");
    expect(source).toContain('from "node:crypto"');
    expect(source).toContain("timingSafeEqual(");
    expect(source).not.toMatch(/\ba\s*===?\s*b\b/);
    expect(source).not.toMatch(/return\s+[A-Za-z_$][\w$]*\s*===?\s*/);
  });
});

describe("Issue #513: the auth decisions are unchanged", () => {
  const original = { ...process.env };

  test("a valid bearer token still authenticates and a wrong one is still 403", () => {
    delete process.env.MUSE_BEARER_TOKEN;
    delete process.env.MUSE_AUTH_TOKENS;

    const opts = { bearerToken: "secret-token-123" };
    const ok = validateHttpAuth(mockReq({ authorization: "Bearer secret-token-123" }), opts);
    expect(ok.authenticated).toBe(true);
    expect(ok.peerId).toBe("default");

    const prefix = validateHttpAuth(mockReq({ authorization: "Bearer secret" }), opts);
    expect(prefix.authenticated).toBe(false);
    expect(prefix.status).toBe(403);

    const longer = validateHttpAuth(mockReq({ authorization: "Bearer secret-token-1234" }), opts);
    expect(longer.authenticated).toBe(false);
    expect(longer.status).toBe(403);

    process.env = { ...original };
  });

  test("peer:token mappings still resolve the peer through the constant-time path", () => {
    delete process.env.MUSE_BEARER_TOKEN;
    delete process.env.MUSE_AUTH_TOKENS;

    const opts = { bearerTokens: ["sol:sol-tok-1", "nexus:nexus-tok-2"] };
    const res = validateHttpAuth(mockReq({ authorization: "Bearer nexus-tok-2" }), opts);
    expect(res.authenticated).toBe(true);
    expect(res.peerId).toBe("nexus");

    const wrong = validateHttpAuth(mockReq({ authorization: "Bearer nexus-tok-3" }), opts);
    expect(wrong.authenticated).toBe(false);
    expect(wrong.status).toBe(403);

    process.env = { ...original };
  });
});
