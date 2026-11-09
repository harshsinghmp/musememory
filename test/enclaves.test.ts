import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEnclave, listEnclaveEntries, putEnclaveEntry, getEnclaveEntry, enclavePath, validateEnclaveName, rotateEnclaveKey } from "../src/store/enclaves.ts";
import { getAuditTrail } from "../src/audit.ts";
import type { MemoryEntry } from "../src/types.ts";

function entry(id: string, content: string): MemoryEntry {
  const now = new Date().toISOString();
  return { id, title: content, content, project: "client-a", status: "confirmed", created_at: now, updated_at: now, tags: [] } as MemoryEntry;
}

describe("T-437: encrypted client enclaves", () => {
  test("round-trips per client/division and stores no plaintext", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-enclave-"));
    try {
      createEnclave(memoryDir, "client-a");
      putEnclaveEntry(memoryDir, "client-a", entry("m_1_secret", "super secret credential plan"));
      expect(getEnclaveEntry(memoryDir, "client-a", "m_1_secret")?.content).toBe("super secret credential plan");

      const file = join(memoryDir, "enclaves", "client-a", "default.enc.json");
      expect(readFileSync(file, "utf8")).not.toContain("super secret");
      const activeId = readFileSync(join(memoryDir, "enclave.active"), "utf8").trim();
      expect(statSync(join(memoryDir, "enclave.keys", `${activeId}.key`)).mode & 0o077).toBe(0);

      expect(listEnclaveEntries(memoryDir, "client-b")).toEqual([]);
      putEnclaveEntry(memoryDir, "client-b", entry("m_2_other", "client b only"));
      expect(listEnclaveEntries(memoryDir, "client-a").map((e) => e.id)).toEqual(["m_1_secret"]);
      expect(listEnclaveEntries(memoryDir, "client-b").map((e) => e.id)).toEqual(["m_2_other"]);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  test("rejects lossy names and detects vault relabeling", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-enclave-names-"));
    try {
      expect(() => validateEnclaveName("../acme", "client")).toThrow();
      expect(() => validateEnclaveName("acme/alpha", "client")).toThrow();
      expect(() => validateEnclaveName("acme alpha", "client")).toThrow();
      expect(() => enclavePath(memoryDir, "..")).toThrow();

      createEnclave(memoryDir, "client-a");
      putEnclaveEntry(memoryDir, "client-a", entry("m_1_secret", "alpha only"));
      const source = enclavePath(memoryDir, "client-a");
      const target = enclavePath(memoryDir, "client-b");
      const { mkdirSync } = require("node:fs") as typeof import("node:fs");
      mkdirSync(join(memoryDir, "enclaves", "client-b"), { recursive: true });
      writeFileSync(target, readFileSync(source));
      expect(() => listEnclaveEntries(memoryDir, "client-b")).toThrow(/metadata/);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  test("rotates the key and re-encrypts vaults without data loss", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-enclave-rotate-"));
    try {
      createEnclave(memoryDir, "client-a");
      putEnclaveEntry(memoryDir, "client-a", entry("m_1_secret", "rotate me"));
      const oldId = readFileSync(join(memoryDir, "enclave.active"), "utf8").trim();
      const rotation = rotateEnclaveKey(memoryDir);
      expect(rotation.old_key_id).toBe(oldId);
      expect(rotation.new_key_id).not.toBe(oldId);
      expect(rotation.reencrypted).toBe(1);
      expect(listEnclaveEntries(memoryDir, "client-a")[0].content).toBe("rotate me");
      const envelope = JSON.parse(readFileSync(join(memoryDir, "enclaves", "client-a", "default.enc.json"), "utf8"));
      expect(envelope.key_id).toBe(rotation.new_key_id);
      expect(getAuditTrail(memoryDir, { operation: "enclave_rotate" })).toHaveLength(1);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  test("rotation without re-encryption keeps old vaults readable until key removal", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-enclave-rotate-lazy-"));
    try {
      createEnclave(memoryDir, "client-a");
      putEnclaveEntry(memoryDir, "client-a", entry("m_1_secret", "old key"));
      const oldId = readFileSync(join(memoryDir, "enclave.active"), "utf8").trim();
      const rotation = rotateEnclaveKey(memoryDir, { reencrypt: false });
      expect(rotation.reencrypted).toBe(0);
      expect(listEnclaveEntries(memoryDir, "client-a")[0].content).toBe("old key");
      rmSync(join(memoryDir, "enclave.keys", `${oldId}.key`));
      expect(() => listEnclaveEntries(memoryDir, "client-a")).toThrow(/Missing enclave key/);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  test("tampered ciphertext fails authentication", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-enclave-tamper-"));
    try {
      createEnclave(memoryDir, "client-a");
      putEnclaveEntry(memoryDir, "client-a", entry("m_1_secret", "secret"));
      const file = join(memoryDir, "enclaves", "client-a", "default.enc.json");
      const envelope = JSON.parse(readFileSync(file, "utf8"));
      envelope.ciphertext = Buffer.from("tampered").toString("base64");
      writeFileSync(file, JSON.stringify(envelope));
      expect(() => listEnclaveEntries(memoryDir, "client-a")).toThrow();
      expect(existsSync(file)).toBe(true);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });
});
