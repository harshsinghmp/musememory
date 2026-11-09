import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryEntry } from "../types.ts";

const VERSION = 1;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface EnclaveEnvelope {
  version: number;
  key_id: string;
  client: string;
  division: string;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

/** Validate a tenant component instead of lossy-rewriting it. */
export function validateEnclaveName(value: string, label: string): string {
  if (!NAME_PATTERN.test(value) || value === "." || value === "..") {
    throw new Error(`Invalid ${label} '${value}': use [A-Za-z0-9._-], 1-64 chars`);
  }
  return value;
}

export function enclavePath(memoryDir: string, client: string, division: string = "default"): string {
  validateEnclaveName(client, "client");
  validateEnclaveName(division, "division");
  return join(memoryDir, "enclaves", client, `${division}.enc.json`);
}

function loadMasterKey(memoryDir: string): Buffer {
  const env = process.env.MUSE_ENCLAVE_KEY;
  if (env) {
    if (!/^[0-9a-fA-F]{64}$/.test(env)) {
      throw new Error("MUSE_ENCLAVE_KEY must be exactly 64 hex characters (raw 32-byte key)");
    }
    return Buffer.from(env, "hex");
  }
  const keyPath = join(memoryDir, "enclave.key");
  if (existsSync(keyPath)) {
    const stored = readFileSync(keyPath, "utf8").trim();
    if (!/^[0-9a-fA-F]{64}$/.test(stored)) throw new Error(`Invalid enclave key at ${keyPath}`);
    return Buffer.from(stored, "hex");
  }
  mkdirSync(memoryDir, { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  try {
    writeFileSync(keyPath, key.toString("hex") + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      const stored = readFileSync(keyPath, "utf8").trim();
      if (!/^[0-9a-fA-F]{64}$/.test(stored)) throw new Error(`Invalid enclave key at ${keyPath}`);
      return Buffer.from(stored, "hex");
    }
    throw err;
  }
  try { chmodSync(keyPath, 0o600); } catch {}
  return key;
}

function deriveKey(master: Buffer, salt: Buffer): Buffer {
  return scryptSync(master, salt, 32);
}

function keyId(master: Buffer): string {
  return createHash("sha256").update(master).digest("hex").slice(0, 16);
}

function aad(client: string, division: string, id: string): Buffer {
  return Buffer.from(JSON.stringify({ version: VERSION, key_id: id, client, division }));
}

function encrypt(memoryDir: string, client: string, division: string, entries: MemoryEntry[]): EnclaveEnvelope {
  const master = loadMasterKey(memoryDir);
  const id = keyId(master);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(master, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(client, division, id));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(entries), "utf8"), cipher.final()]);
  return {
    version: VERSION,
    key_id: id,
    client,
    division,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decrypt(memoryDir: string, client: string, division: string, envelope: EnclaveEnvelope): MemoryEntry[] {
  if (envelope.version !== VERSION) throw new Error(`Unsupported enclave version ${envelope.version}`);
  if (envelope.client !== client || envelope.division !== division) {
    throw new Error("Enclave metadata does not match the requested client/division");
  }
  const master = loadMasterKey(memoryDir);
  const id = keyId(master);
  if (envelope.key_id !== id) throw new Error("Enclave was encrypted with a different key");
  const key = deriveKey(master, Buffer.from(envelope.salt, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(aad(client, division, id));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as MemoryEntry[];
}

function writeEnvelope(path: string, envelope: EnclaveEnvelope): void {
  const dir = path.slice(0, path.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(envelope, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

export function createEnclave(memoryDir: string, client: string, division: string = "default"): void {
  const path = enclavePath(memoryDir, client, division);
  if (existsSync(path)) return;
  writeEnvelope(path, encrypt(memoryDir, client, division, []));
}

export function listEnclaveEntries(memoryDir: string, client: string, division: string = "default"): MemoryEntry[] {
  const path = enclavePath(memoryDir, client, division);
  if (!existsSync(path)) return [];
  const envelope = JSON.parse(readFileSync(path, "utf8")) as EnclaveEnvelope;
  return decrypt(memoryDir, client, division, envelope);
}

export function putEnclaveEntry(
  memoryDir: string,
  client: string,
  entry: MemoryEntry,
  division: string = "default",
): MemoryEntry[] {
  const entries = listEnclaveEntries(memoryDir, client, division).filter((candidate) => candidate.id !== entry.id);
  entries.push(entry);
  writeEnvelope(enclavePath(memoryDir, client, division), encrypt(memoryDir, client, division, entries));
  return entries;
}

export function getEnclaveEntry(
  memoryDir: string,
  client: string,
  id: string,
  division: string = "default",
): MemoryEntry | null {
  return listEnclaveEntries(memoryDir, client, division).find((entry) => entry.id === id) ?? null;
}
