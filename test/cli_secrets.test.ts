import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeSecretScan, handleScanSecretsCommand } from "../src/cli/secrets.ts";

describe("T-445: Native Vibeguard Secret Scanner CLI", () => {
  let tempBase: string;

  beforeEach(() => {
    tempBase = join(tmpdir(), `muse-secrets-scan-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    mkdirSync(tempBase, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempBase, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("reports clean when directory has no secret leaks", async () => {
    writeFileSync(join(tempBase, "clean.ts"), `export const hello = "world";\nconsole.log(hello);\n`, "utf8");
    const result = await executeSecretScan({ targetDir: tempBase });
    expect(result.clean).toBe(true);
    expect(result.findings.length).toBe(0);
    expect(result.scannedFiles).toBe(1);
  });

  it("detects credentials and redacts matched snippets", async () => {
    const leakContent = `
const apiKey = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";
const ghToken = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
const awsKey = "AKIAIOSFODNN7EXAMPLE";
`;
    writeFileSync(join(tempBase, "leaks.ts"), leakContent, "utf8");
    const result = await executeSecretScan({ targetDir: tempBase });

    expect(result.clean).toBe(false);
    expect(result.findings.length).toBeGreaterThanOrEqual(3);

    // Verify all snippets are redacted and do not expose raw secrets
    for (const finding of result.findings) {
      expect(finding.redactedSnippet).toContain("[REDACTED_SECRET]");
      expect(finding.redactedSnippet).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz123456");
      expect(finding.redactedSnippet).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234567890");
      expect(finding.redactedSnippet).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(finding.line).toBeGreaterThan(0);
    }
  });

  it("skips ignored directories and binary extensions", async () => {
    const nodeModulesDir = join(tempBase, "node_modules");
    mkdirSync(nodeModulesDir, { recursive: true });
    writeFileSync(join(nodeModulesDir, "secret.js"), `const key = "sk-ant-12345678901234567890123456";\n`, "utf8");

    // Write binary-like file with secret text
    writeFileSync(join(tempBase, "fake.png"), `binary header sk-proj-123456789012345678901234`, "utf8");

    const result = await executeSecretScan({ targetDir: tempBase });
    expect(result.clean).toBe(true);
    expect(result.findings.length).toBe(0);
  });

  it("produces exit code 0 on clean and 1 on leaks in CLI handler", async () => {
    // 1. Clean
    writeFileSync(join(tempBase, "index.ts"), `console.log("clean");\n`, "utf8");
    const codeClean = await handleScanSecretsCommand({
      positional: [tempBase],
      flags: { silent: "true" },
    });
    expect(codeClean).toBe(0);

    // 2. Leaky
    writeFileSync(join(tempBase, "secret.env"), `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n`, "utf8");
    const codeLeaky = await handleScanSecretsCommand({
      positional: [tempBase],
      flags: { silent: "true" },
    });
    expect(codeLeaky).toBe(1);
  });
});
