import { describe, test, expect } from "bun:test";
import { validateEmbedderUrl, validateSettings } from "../src/settings/schema.ts";
import { createEmbedder } from "../src/retrieval/embedders.ts";

describe("T-392: SSRF protection and embedderUrl validation", () => {
  describe("validateEmbedderUrl", () => {
    test("accepts local loopback HTTP endpoints", () => {
      expect(validateEmbedderUrl("http://localhost:8081/v1").valid).toBe(true);
      expect(validateEmbedderUrl("http://127.0.0.1:8081/v1").valid).toBe(true);
      expect(validateEmbedderUrl("http://127.0.0.1:11434/api").valid).toBe(true);
      expect(validateEmbedderUrl("http://[::1]:8081/v1").valid).toBe(true);
      expect(validateEmbedderUrl("http://0.0.0.0:8081/v1").valid).toBe(true);
    });

    test("accepts secure HTTPS remote endpoints", () => {
      expect(validateEmbedderUrl("https://api.openai.com/v1").valid).toBe(true);
      expect(validateEmbedderUrl("https://embed.internal.agency.com/v1").valid).toBe(true);
    });

    test("rejects remote plain HTTP endpoints by default", () => {
      const res = validateEmbedderUrl("http://api.remote-llm.com/v1");
      expect(res.valid).toBe(false);
      expect(res.error).toContain("must use HTTPS");
    });

    test("blocks cloud instance metadata service IP 169.254.169.254 and link-local addresses", () => {
      const awsMetadata = validateEmbedderUrl("http://169.254.169.254/latest/meta-data/");
      expect(awsMetadata.valid).toBe(false);
      expect(awsMetadata.error).toContain("cloud metadata or link-local address");

      const gcpMetadata = validateEmbedderUrl("http://metadata.google.internal/computeMetadata/v1/");
      expect(gcpMetadata.valid).toBe(false);
      expect(gcpMetadata.error).toContain("cloud metadata or link-local address");

      const linkLocalIpv4 = validateEmbedderUrl("http://169.254.10.20/v1");
      expect(linkLocalIpv4.valid).toBe(false);
      expect(linkLocalIpv4.error).toContain("cloud metadata or link-local address");
    });

    test("rejects dangerous or non-HTTP protocols", () => {
      expect(validateEmbedderUrl("file:///etc/passwd").valid).toBe(false);
      expect(validateEmbedderUrl("gopher://evil.com/1").valid).toBe(false);
      expect(validateEmbedderUrl("javascript:alert(1)").valid).toBe(false);
      expect(validateEmbedderUrl("ftp://files.example.com").valid).toBe(false);
    });
  });

  describe("validateSettings integration", () => {
    test("passes when embedderUrl is valid local loopback or https", () => {
      const res = validateSettings({
        retrieval: {
          defaultMode: "hybrid",
          defaultTokenBudget: 2000,
          defaultDisclosureDepth: "L2",
          treeMaxDepth: 5,
          enableLLMReasoning: false,
          hybridVectorWeight: 0.5,
          hybridTreeWeight: 0.5,
          embedderUrl: "http://127.0.0.1:8081/v1",
        },
      });
      expect(res.valid).toBe(true);
      expect(res.errors.length).toBe(0);
    });

    test("rejects settings when embedderUrl points to metadata SSRF target", () => {
      const res = validateSettings({
        retrieval: {
          defaultMode: "hybrid",
          defaultTokenBudget: 2000,
          defaultDisclosureDepth: "L2",
          treeMaxDepth: 5,
          enableLLMReasoning: false,
          hybridVectorWeight: 0.5,
          hybridTreeWeight: 0.5,
          embedderUrl: "http://169.254.169.254/latest/meta-data/",
        },
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("cloud metadata"))).toBe(true);
    });
  });

  describe("createEmbedder runtime enforcement", () => {
    test("throws early when endpoint violates SSRF rules", () => {
      expect(() =>
        createEmbedder({
          endpoint: "http://169.254.169.254/v1",
        }),
      ).toThrow(/cloud metadata/);

      expect(() =>
        createEmbedder({
          endpoint: "file:///etc/passwd",
        }),
      ).toThrow(/Invalid protocol/);
    });
  });
});
