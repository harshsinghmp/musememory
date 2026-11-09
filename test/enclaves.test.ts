import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEnclave, listEnclaveEntries, putEnclaveEntry, getEnclaveEntry, enclavePath, validateEnclaveName } from "../src/store/enclaves.ts";
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
      expect(statSync(join(memoryDir, "enclave.key")).mode & 0o077).toBe(0);

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
