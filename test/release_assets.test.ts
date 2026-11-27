import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const workflowPath = join(ROOT, ".github", "workflows", "release-assets.yml");

/**
 * The release assets are only trustworthy if the pipeline signs them **and**
 * verifies its own signature against this workflow's identity at the tag.
 * These assertions pin that contract; the generic workflow linter in
 * `security_audit_2026_11.test.ts` covers pinning and permissions.
 */
describe("release-assets workflow", () => {
  const text = () => readFileSync(workflowPath, "utf8");

  test("runs when a release is published and can sign keyless", () => {
    const yml = text();
    expect(yml).toContain("types: [published]");
    expect(yml).toContain("id-token: write");
    expect(yml).toContain("contents: write");
  });

  test("builds from the tagged commit, generates and signs both assets", () => {
    const yml = text();
    expect(yml).toContain("github.event.release.tag_name");
    expect(yml).toContain("bun run sbom");
    expect(yml).toContain("bun run checksums");
    expect(yml).toContain("cosign sign-blob");
    expect(yml).toContain("dist/bom.cdx.json");
    expect(yml).toContain("dist/SHA256SUMS");
  });

  test("verifies its own signature with this workflow's identity before uploading", () => {
    const yml = text();
    expect(yml).toContain("cosign verify-blob");
    expect(yml).toContain("release-assets.yml@refs/tags/");
    expect(yml).toContain("token.actions.githubusercontent.com");
    expect(yml).toContain("gh release upload");
  });
});
