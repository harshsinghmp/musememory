import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { makeTempRoot, cleanup } from "./helpers.ts";
import { join } from "node:path";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import {
  addSource,
  listSources,
  getSource,
  findSources,
  type SourceEntry,
} from "../src/provenance.ts";
import {
  recordClaim,
  listClaims,
  getClaim,
  findClaims,
  type ClaimEntry,
  type ClaimConfidence,
} from "../src/claims.ts";

describe("Deliverable 1: Provenance & Claim Ledgers", () => {
  let root: string;
  let memoryDir: string;

  beforeEach(() => {
    root = makeTempRoot();
    memoryDir = join(root, ".memory");
    mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    cleanup(root);
  });

  describe("Source Ledger (provenance.ts)", () => {
    test("addSource creates .memory/sources.json and persists source entry", () => {
      const source = addSource(memoryDir, {
        url: "https://example.com/docs/api",
        title: "API Reference v2",
        source_type: "documentation",
        excerpt: "The API uses Bearer tokens and rate limits to 100 req/min.",
        author: "Dev Rel Team",
      });

      expect(source.id).toMatch(/^src_/);
      expect(source.url).toBe("https://example.com/docs/api");
      expect(source.title).toBe("API Reference v2");
      expect(source.source_type).toBe("documentation");
      expect(source.retrieved_at).toBeDefined();

      const sourcesPath = join(memoryDir, "sources.json");
      expect(existsSync(sourcesPath)).toBe(true);

      const all = listSources(memoryDir);
      expect(all.length).toBe(1);
      expect(all[0].id).toBe(source.id);
    });

    test("addSource throws if Vibeguard detects secrets in title or excerpt", () => {
      expect(() => {
        addSource(memoryDir, {
          url: "https://example.com/leaked",
          title: "Leaked Token",
          source_type: "primary",
          excerpt: "Here is the key: sk-proj-1234567890abcdef1234567890abcdef12345678",
        });
      }).toThrow(/secret/i);
    });

    test("getSource and findSources retrieve sources accurately", () => {
      const s1 = addSource(memoryDir, {
        url: "https://github.com/facebook/react",
        title: "React Repository",
        source_type: "repo",
        excerpt: "React is a JavaScript library for building user interfaces.",
      });

      const s2 = addSource(memoryDir, {
        url: "https://bun.sh/docs",
        title: "Bun Documentation",
        source_type: "documentation",
        excerpt: "Bun is a fast all-in-one JavaScript runtime.",
      });

      expect(getSource(memoryDir, s1.id)?.title).toBe("React Repository");
      expect(getSource(memoryDir, "non-existent")).toBeNull();

      const found = findSources(memoryDir, "runtime");
      expect(found.length).toBe(1);
      expect(found[0].id).toBe(s2.id);
    });
  });

  describe("Claim Ledger (claims.ts)", () => {
    test("recordClaim creates .memory/claims.json and links sources and confidence tags", () => {
      const claim = recordClaim(memoryDir, {
        claim: "Bun executes SQLite queries faster than node-sqlite3 in single-thread benchmarks.",
        confidence_tag: "RAW",
        source_ids: ["src_123"],
        memory_ids: ["m_456"],
        notes: "Measured locally with bun test benchmark suite.",
        verified: true,
      });

      expect(claim.id).toMatch(/^clm_/);
      expect(claim.claim).toContain("Bun executes SQLite");
      expect(claim.confidence_tag).toBe("RAW");
      expect(claim.source_ids).toEqual(["src_123"]);
      expect(claim.memory_ids).toEqual(["m_456"]);
      expect(claim.created_at).toBeDefined();

      const claimsPath = join(memoryDir, "claims.json");
      expect(existsSync(claimsPath)).toBe(true);

      const all = listClaims(memoryDir);
      expect(all.length).toBe(1);
      expect(all[0].id).toBe(claim.id);
    });

    test("recordClaim throws if Vibeguard detects secrets in claim or notes", () => {
      expect(() => {
        recordClaim(memoryDir, {
          claim: "Database url is postgres://admin:secretPass123@db.example.com:5432/main",
          confidence_tag: "RAW",
        });
      }).toThrow(/secret/i);
    });

    test("listClaims filters by confidence tag and searches text", () => {
      recordClaim(memoryDir, {
        claim: "First claim verified by local test",
        confidence_tag: "RAW",
      });

      recordClaim(memoryDir, {
        claim: "Second claim fetched from RFC 9110",
        confidence_tag: "FETCH",
      });

      recordClaim(memoryDir, {
        claim: "Third claim inferred by reasoning agent",
        confidence_tag: "INFER",
      });

      const rawClaims = listClaims(memoryDir, { confidence_tag: "RAW" });
      expect(rawClaims.length).toBe(1);
      expect(rawClaims[0].confidence_tag).toBe("RAW");

      const searchResults = findClaims(memoryDir, "RFC 9110");
      expect(searchResults.length).toBe(1);
      expect(searchResults[0].confidence_tag).toBe("FETCH");
    });
  });
});
