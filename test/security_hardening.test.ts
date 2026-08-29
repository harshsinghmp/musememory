import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, propose, get, fileForId, slugifyId } from "../src/store.ts";
import { startUiServer } from "../src/ui.ts";
import { getMemoryById, listMemories } from "../src/sqlite.ts";
import { scanSecrets, SECRET_RULES } from "../src/secrets.ts";
import { setUserProfile } from "../src/user.ts";

describe("Secure Code Guardian — Security Controls & Hardening Verification", () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-security-"));
    memoryDir = join(tmpDir, ".memory");
    mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe("1. Web UI & Network Interface Hardening", () => {
    it("UI server responds with strict HTTP security headers (CSP, nosniff, DENY, referrer-policy)", async () => {
      const store = openStore(memoryDir);
      const serverInstance = await startUiServer({ store, memoryDir, port: 0 });
      const port = serverInstance.port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/stats`);
        expect(res.status).toBe(200);

        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(res.headers.get("x-frame-options")).toBe("DENY");
        expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
        expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
      } finally {
        serverInstance.close();
      }
    });

    it("UI server rejects cross-origin state mutations (CSRF defense) from untrusted third-party origins", async () => {
      const store = openStore(memoryDir);
      const serverInstance = await startUiServer({ store, memoryDir, port: 0 });
      const port = serverInstance.port;

      try {
        // 1. Untrusted third-party origin attempting POST /api/propose
        const maliciousRes = await fetch(`http://127.0.0.1:${port}/api/propose`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://malicious-attacker.xyz",
          },
          body: JSON.stringify({ content: "Injected memory", project: "injected" }),
        });
        expect(maliciousRes.status).toBe(403);
        const errJson = (await maliciousRes.json()) as { error: string };
        expect(errJson.error).toContain("Forbidden");

        // 2. Legitimate localhost origin is allowed
        const legitRes = await fetch(`http://127.0.0.1:${port}/api/propose`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: `http://localhost:${port}`,
          },
          body: JSON.stringify({ content: "Legitimate memory", project: "legit" }),
        });
        expect(legitRes.status).toBe(200);
      } finally {
        serverInstance.close();
      }
    });

    it("UI server enforces 1MB payload size limit preventing memory exhaustion DoS", async () => {
      const store = openStore(memoryDir);
      const serverInstance = await startUiServer({ store, memoryDir, port: 0 });
      const port = serverInstance.port;

      try {
        // Construct a payload larger than 1MB (1.2MB)
        const hugePayload = "A".repeat(1.2 * 1024 * 1024);
        const res = await fetch(`http://127.0.0.1:${port}/api/propose`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: `http://127.0.0.1:${port}`,
          },
          body: JSON.stringify({ content: hugePayload, project: "test" }),
        }).catch((err) => ({ status: 500, error: err }));

        // Server destroys stream on overflow or returns error
        if ("status" in res && typeof res.status === "number") {
          expect([400, 500]).toContain(res.status);
        }
      } finally {
        serverInstance.close();
      }
    });
  });

  describe("2. Injection & SQL Parameterization Defense", () => {
    it("SQLite queries safely escape and parameterize SQL injection payloads without syntax errors or data loss", () => {
      const store = openStore(memoryDir);
      const sqlInjectionPayloads = [
        "'; DROP TABLE memories; --",
        "' OR '1'='1",
        "admin'--",
        "UNION SELECT 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 --",
      ];

      for (const payload of sqlInjectionPayloads) {
        const entry = propose(store, {
          title: payload,
          content: `Test content with payload: ${payload}`,
          project: payload,
          type: "discovery",
          confirmed: true,
        });

        // Retrieve by parameterized query
        if (store.db) {
          const fetchedFromDb = getMemoryById(store.db, entry.id);
          expect(fetchedFromDb).not.toBeNull();
          expect(fetchedFromDb?.title).toBe(payload);

          // List with filtered project
          const filtered = listMemories(store.db, { project: payload });
          expect(filtered.length).toBe(1);
          expect(filtered[0].id).toBe(entry.id);
        }

        const fetched = get(store, entry.id);
        expect(fetched).not.toBeNull();
        expect(fetched?.title).toBe(payload);
      }
    });
  });

  describe("3. Path Traversal & File Containment Defense", () => {
    it("slugifyId and fileForId strip traversal sequences preventing directory escape", () => {
      const store = openStore(memoryDir);
      const traversalAttempts = [
        "../../etc/passwd",
        "..\\..\\windows\\system32",
        "/etc/shadow",
        "m_1_../../../tmp/hacked",
        "....//....//shell.sh",
      ];

      for (const attempt of traversalAttempts) {
        const slug = slugifyId(attempt);
        // Slashes, backslashes, and dots must be stripped
        expect(slug).not.toContain("/");
        expect(slug).not.toContain("\\");
        expect(slug).not.toContain("..");

        const targetFile = fileForId(store, attempt);
        // Target file must resolve strictly within store.dir
        expect(targetFile.startsWith(store.dir)).toBe(true);
      }
    });
  });

  describe("4. Vibeguard Zero-Leakage Secret Defense", () => {
    it("Vibeguard scanner blocks AI API tokens, GitHub tokens, database URIs, and Private Keys", () => {
      const secretPayloads = [
        { name: "OpenAI Token", text: "sk-proj-abc123456789012345678901234567890" },
        { name: "GitHub PAT", text: "ghp_123456789012345678901234567890123456" },
        { name: "PostgreSQL with Password", text: "postgres://admin:SuperSecret123@prod-db.internal:5432/main" },
        { name: "AWS Key ID", text: "AKIAIOSFODNN7EXAMPLE" },
      ];

      for (const item of secretPayloads) {
        const matches = scanSecrets(item.text);
        expect(matches.length).toBeGreaterThan(0);
      }
    });

    it("propose and setUserProfile intercept and throw when credentials are detected", () => {
      const store = openStore(memoryDir);

      // Propose secret
      expect(() => {
        propose(store, {
          title: "Database config",
          content: "Use postgres://user:SuperSecretPassword123@localhost:5432/db",
          project: "test",
        });
      }).toThrow(/Probable secret detected/);

      // Set user profile with secret
      expect(() => {
        setUserProfile(memoryDir, "My secret API key is sk-proj-123456789012345678901234567890");
      }).toThrow(/Secret detected in USER\.md/);
    });
  });
});
