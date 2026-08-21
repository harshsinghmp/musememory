import { describe, test, expect } from "bun:test";
import { scanSecrets, hasSecret, redactSecrets } from "../src/secrets.ts";

describe("secrets scanner", () => {
  test("detects OpenAI / AI API keys", () => {
    const text = "OpenAI key: sk-proj-1234567890abcdef1234567890";
    expect(hasSecret(text)).toBe(true);
    expect(scanSecrets(text)).toContain("OpenAI / Anthropic / Generic AI API Key");
  });

  test("detects GitHub tokens", () => {
    const text = "export GITHUB_TOKEN=ghp_123456789012345678901234567890123456";
    expect(hasSecret(text)).toBe(true);
    expect(scanSecrets(text)).toContain("GitHub Token");
  });

  test("detects NPM tokens", () => {
    const text = "npm_123456789012345678901234567890123456";
    expect(hasSecret(text)).toBe(true);
    expect(scanSecrets(text)).toContain("NPM Access Token");
  });

  test("detects AWS Access Key ID", () => {
    const text = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
    expect(hasSecret(text)).toBe(true);
    expect(scanSecrets(text)).toContain("AWS Access Key ID");
  });

  test("detects Private Key block", () => {
    const text = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0";
    expect(hasSecret(text)).toBe(true);
    expect(scanSecrets(text)).toContain("Private Key Block");
  });

  test("detects Database connection strings with credentials", () => {
    const text = "postgres://admin:supersecret123@localhost:5432/mydb";
    expect(hasSecret(text)).toBe(true);
    expect(scanSecrets(text)).toContain("Database Connection String with Credentials");
  });

  test("detects generic password assignments", () => {
    const text = "password: 'superSecretPassword99'";
    expect(hasSecret(text)).toBe(true);
    expect(scanSecrets(text)).toContain("Generic Credential Assignment");
  });

  test("does not flag clean non-secret text", () => {
    const cleanText = "The server connects to http://localhost:3000 and uses public routes with token count 5";
    expect(hasSecret(cleanText)).toBe(false);
    expect(scanSecrets(cleanText)).toEqual([]);
  });

  test("redactSecrets masks secrets including case-insensitive patterns", () => {
    const text = "key is ghp_123456789012345678901234567890123456 and PASSWORD: 'superSecretPassword99'";
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain("ghp_123456789012345678901234567890123456");
    expect(redacted).not.toContain("superSecretPassword99");
    expect(redacted).toContain("[REDACTED_SECRET]");
  });
});
