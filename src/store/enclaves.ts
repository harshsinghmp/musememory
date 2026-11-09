import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryEntry } from "../types.ts";

const VERSION = 1;

export interface EnclaveEnvelope {
  version: number;
  client: string;
  division: string;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function enclavePath(memoryDir: string, client: string, division: string = "default"): string {
  return join(memoryDir, "enclaves", safeName(client), `${safeName(division)}.enc.json`);
}

function loadMasterKey(memoryDir: string): Buffer {
  const env = process.env.MUSE_ENCLAVE_KEY;
  if (env) {
    const fromEnv = /^[0-9a-fA-F]{64}$/.test(env) ? Buffer.from(env, "hex") : createHash("sha256").update(env).digest();
    return fromEnv;
  }
  const keyPath = join(memoryDir, "enclave.key");
  if (existsSync(keyPath)) {
    const stored = readFileSync(keyPath, "utf8").trim();
    if (!/^[0-9a-fA-F]{64}$/.test(stored)) throw new Error(`Invalid enclave key at ${keyPath}`);
    return Buffer.from(stored, "hex");
  }
  mkdirSync(memoryDir, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString("hex") + "\n", { encoding: "utf8", mode: 0o600 });
  try { chmodSync(keyPath, 0o600); } catch {}
  return key;
}

function deriveKey(master: Buffer, salt: Buffer): Buffer {
  return scryptSync(master, salt, 32);
}

function encrypt(memoryDir: string, client: string, division: string, entries: MemoryEntry[]): EnclaveEnvelope {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(loadMasterKey(memoryDir), salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(entries), "utf8"), cipher.final()]);
  return {
    version: VERSION,
    client,
    division,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decrypt(memoryDir: string, envelope: EnclaveEnvelope): MemoryEntry[] {
  if (envelope.version !== VERSION) throw new Error(`Unsupported enclave version ${envelope.version}`);
  const key = deriveKey(loadMasterKey(memoryDir), Buffer.from(envelope.salt, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as MemoryEntry[];
}

function writeEnvelope(path: string, envelope: EnclaveEnvelope): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(envelope, null, 2) + "\n", "utf8");
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
  return decrypt(memoryDir, envelope);
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
