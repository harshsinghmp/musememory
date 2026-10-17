import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordClaim } from "../src/claims.ts";
import { addSource } from "../src/provenance.ts";

describe("T-393: Claims & provenance secret-scan gaps", () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-secrets-test-"));
    memoryDir = join(tmpDir, ".memory");
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe("recordClaim secret detection", () => {
    const fakeSecret = "ghp_123456789012345678901234567890123456";

    test("detects secrets embedded in source_ids array", () => {
      expect(() =>
        recordClaim(memoryDir, {
          claim: "Legitimate architecture claim",
          source_ids: ["src_clean", fakeSecret],
          validate_sources: false,
        }),
      ).toThrow(/Vibeguard: Detected secret in claim/);
    });

    test("detects secrets embedded in memory_ids array", () => {
      expect(() =>
        recordClaim(memoryDir, {
          claim: "Legitimate architecture claim",
          memory_ids: [fakeSecret],
          validate_sources: false,
        }),
      ).toThrow(/Vibeguard: Detected secret in claim/);
    });

    test("detects secrets embedded in custom claim id", () => {
      expect(() =>
        recordClaim(memoryDir, {
          claim: "Legitimate architecture claim",
          id: `claim_${fakeSecret}`,
          validate_sources: false,
        }),
      ).toThrow(/Vibeguard: Detected secret in claim/);
    });

    test("accepts clean claim inputs", () => {
      const claim = recordClaim(memoryDir, {
        claim: "Legitimate architecture claim without secrets",
        notes: "Some architecture notes",
        source_ids: ["src_123"],
        memory_ids: ["mem_456"],
        validate_sources: false,
      });
      expect(claim.id).toBeDefined();
      expect(claim.claim).toBe("Legitimate architecture claim without secrets");
    });
  });

  describe("addSource secret detection", () => {
    const fakeSecret = "ghp_123456789012345678901234567890123456";

    test("detects secrets embedded in metadata object", () => {
      expect(() =>
        addSource(memoryDir, {
          url: "https://example.com/docs",
          title: "Architecture Documentation",
          metadata: {
            authHeader: `Bearer ${fakeSecret}`,
            nested: { token: fakeSecret },
          },
        }),
      ).toThrow(/Vibeguard: Detected secret in source data/);
    });

    test("detects secrets embedded in custom source id", () => {
      expect(() =>
        addSource(memoryDir, {
          url: "https://example.com/docs",
          title: "Architecture Documentation",
          id: `src_${fakeSecret}`,
        }),
      ).toThrow(/Vibeguard: Detected secret in source data/);
    });

    test("accepts clean source inputs", () => {
      const source = addSource(memoryDir, {
        url: "https://example.com/docs",
        title: "Clean Documentation",
        author: "Sol",
        excerpt: "Clean documentation snippet",
        metadata: { category: "architecture", verified: true },
      });
      expect(source.id).toBeDefined();
      expect(source.title).toBe("Clean Documentation");
    });
  });
});
