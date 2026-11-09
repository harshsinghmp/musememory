import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import {
  chmodSync,
  rmSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { MemoryEntry } from "../types.ts";
import { recordAuditEvent } from "../audit.ts";
import { withStoreLock } from "../lock.ts";

const VERSION = 1;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

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

export interface EnclaveKeyInfo {
  key_id: string;
  active: boolean;
  referenced: boolean;
  path: string;
}

export interface EnclavePruneResult {
  removed: string[];
  kept: string[];
  dryRun: boolean;
}

export interface EnclaveRotation {
  old_key_id: string;
  new_key_id: string;
  reencrypted: number;
}

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

function keyId(master: Buffer): string {
  return createHash("sha256").update(master).digest("hex").slice(0, 16);
}

function keysDir(memoryDir: string): string {
  return join(memoryDir, "enclave.keys");
}

function activePath(memoryDir: string): string {
  return join(memoryDir, "enclave.active");
}

function readKeyFile(path: string): Buffer {
  const stored = readFileSync(path, "utf8").trim();
  if (!KEY_PATTERN.test(stored)) throw new Error(`Invalid enclave key at ${path}`);
  return Buffer.from(stored, "hex");
}

function writeKeyFile(path: string, key: Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path, key.toString("hex") + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  try { chmodSync(path, 0o600); } catch {}
}

function envKey(): Buffer | null {
  const env = process.env.MUSE_ENCLAVE_KEY;
  if (!env) return null;
  if (!KEY_PATTERN.test(env)) throw new Error("MUSE_ENCLAVE_KEY must be exactly 64 hex characters (raw 32-byte key)");
  return Buffer.from(env, "hex");
}

function keyForId(memoryDir: string, id: string): Buffer | null {
  const env = envKey();
  if (env) return keyId(env) === id ? env : null;
  const candidate = join(keysDir(memoryDir), `${id}.key`);
  if (existsSync(candidate)) return readKeyFile(candidate);
  const legacy = join(memoryDir, "enclave.key");
  if (existsSync(legacy)) {
    const key = readKeyFile(legacy);
    if (keyId(key) === id) return key;
  }
  return null;
}

function setActive(memoryDir: string, id: string): void {
  const path = activePath(memoryDir);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${id}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

function activeKey(memoryDir: string): { key: Buffer; id: string } {
  const env = envKey();
  if (env) return { key: env, id: keyId(env) };

  const active = activePath(memoryDir);
  if (existsSync(active)) {
    const id = readFileSync(active, "utf8").trim();
    const key = keyForId(memoryDir, id);
    if (!key) throw new Error(`Active enclave key '${id}' is missing from ${keysDir(memoryDir)}`);
    return { key, id };
  }

  const legacy = join(memoryDir, "enclave.key");
  if (existsSync(legacy)) {
    const key = readKeyFile(legacy);
    return { key, id: keyId(key) };
  }

  const key = randomBytes(32);
  const id = keyId(key);
  writeKeyFile(join(keysDir(memoryDir), `${id}.key`), key);
  mkdirSync(memoryDir, { recursive: true, mode: 0o700 });
  setActive(memoryDir, id);
  return { key, id };
}

function currentKeyId(memoryDir: string): string | null {
  const env = envKey();
  if (env) return keyId(env);
  const active = activePath(memoryDir);
  if (existsSync(active)) return readFileSync(active, "utf8").trim();
  const legacy = join(memoryDir, "enclave.key");
  if (existsSync(legacy)) return keyId(readKeyFile(legacy));
  return null;
}

export function listEnclaveKeys(memoryDir: string): EnclaveKeyInfo[] {
  const active = currentKeyId(memoryDir);
  const referenced = new Set(vaultFiles(join(memoryDir, "enclaves")).map((path) => {
    const envelope = JSON.parse(readFileSync(path, "utf8")) as EnclaveEnvelope;
    return envelope.key_id;
  }));
  const keys: EnclaveKeyInfo[] = [];
  const dir = keysDir(memoryDir);
  if (existsSync(dir)) {
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".key")) continue;
      const id = file.name.slice(0, -".key".length);
      keys.push({ key_id: id, active: id === active, referenced: referenced.has(id), path: join(dir, file.name) });
    }
  }
  const legacy = join(memoryDir, "enclave.key");
  if (existsSync(legacy)) {
    const id = keyId(readKeyFile(legacy));
    if (!keys.some((key) => key.key_id === id)) {
      keys.push({ key_id: id, active: id === active, referenced: referenced.has(id), path: legacy });
    }
  }
  return keys.sort((a, b) => a.key_id.localeCompare(b.key_id));
}

/** Remove keys that are neither active nor referenced by any vault. */
export function pruneEnclaveKeys(memoryDir: string, options: { dryRun?: boolean } = {}): EnclavePruneResult {
  if (envKey()) throw new Error("Cannot prune keys while MUSE_ENCLAVE_KEY is set");
  const removed: string[] = [];
  const kept: string[] = [];
  for (const key of listEnclaveKeys(memoryDir)) {
    if (key.active || key.referenced) {
      kept.push(key.key_id);
      continue;
    }
    if (!options.dryRun) rmSync(key.path, { force: true });
    removed.push(key.key_id);
  }
  if (!options.dryRun && removed.length > 0) {
    recordAuditEvent(memoryDir, {
      operation: "enclave_prune",
      entry_id: "enclave",
      actor: "cli",
      reason: "enclave_key_prune",
      details: { removed, kept },
    });
  }
  return { removed, kept, dryRun: options.dryRun === true };
}

function deriveKey(master: Buffer, salt: Buffer): Buffer {
  return scryptSync(master, salt, 32);
}

function aad(client: string, division: string, id: string): Buffer {
  return Buffer.from(JSON.stringify({ version: VERSION, key_id: id, client, division }));
}

function encryptWith(master: Buffer, id: string, client: string, division: string, entries: MemoryEntry[]): EnclaveEnvelope {
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

function decryptWith(master: Buffer, id: string, client: string, division: string, envelope: EnclaveEnvelope): MemoryEntry[] {
  if (envelope.version !== VERSION) throw new Error(`Unsupported enclave version ${envelope.version}`);
  if (envelope.client !== client || envelope.division !== division) {
    throw new Error("Enclave metadata does not match the requested client/division");
  }
  if (envelope.key_id !== id) throw new Error("Enclave key id mismatch");
  const key = deriveKey(master, Buffer.from(envelope.salt, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(aad(client, division, id));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as MemoryEntry[];
}

function decrypt(memoryDir: string, client: string, division: string, envelope: EnclaveEnvelope): MemoryEntry[] {
  const key = keyForId(memoryDir, envelope.key_id);
  if (!key) throw new Error(`Missing enclave key '${envelope.key_id}'`);
  return decryptWith(key, envelope.key_id, client, division, envelope);
}

function writeEnvelope(path: string, envelope: EnclaveEnvelope): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(envelope, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

export function createEnclave(memoryDir: string, client: string, division: string = "default"): void {
  const path = enclavePath(memoryDir, client, division);
  if (existsSync(path)) return;
  const { key, id } = activeKey(memoryDir);
  writeEnvelope(path, encryptWith(key, id, client, division, []));
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
  return withStoreLock(memoryDir, () => {
    const entries = listEnclaveEntries(memoryDir, client, division).filter((candidate) => candidate.id !== entry.id);
    entries.push(entry);
    const { key, id } = activeKey(memoryDir);
    writeEnvelope(enclavePath(memoryDir, client, division), encryptWith(key, id, client, division, entries));
    return entries;
  });
}

export function getEnclaveEntry(
  memoryDir: string,
  client: string,
  id: string,
  division: string = "default",
): MemoryEntry | null {
  return listEnclaveEntries(memoryDir, client, division).find((entry) => entry.id === id) ?? null;
}

function vaultFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...vaultFiles(path));
    else if (entry.name.endsWith(".enc.json")) files.push(path);
  }
  return files;
}

/**
 * Rotate the store-wide enclave key. Old keys stay on disk for rollback; with
 * re-encryption enabled every vault moves to the new key id immediately.
 */
export function rotateEnclaveKey(memoryDir: string, options: { reencrypt?: boolean } = {}): EnclaveRotation {
  if (envKey()) throw new Error("Cannot rotate keys while MUSE_ENCLAVE_KEY is set");
  const current = activeKey(memoryDir);
  const newKey = randomBytes(32);
  const newId = keyId(newKey);
  writeKeyFile(join(keysDir(memoryDir), `${newId}.key`), newKey);
  setActive(memoryDir, newId);

  let reencrypted = 0;
  if (options.reencrypt !== false) {
    for (const path of vaultFiles(join(memoryDir, "enclaves"))) {
      const envelope = JSON.parse(readFileSync(path, "utf8")) as EnclaveEnvelope;
      const entries = decrypt(memoryDir, envelope.client, envelope.division, envelope);
      writeEnvelope(path, encryptWith(newKey, newId, envelope.client, envelope.division, entries));
      reencrypted += 1;
    }
  }

  recordAuditEvent(memoryDir, {
    operation: "enclave_rotate",
    entry_id: "enclave",
    actor: "cli",
    reason: "enclave_key_rotation",
    details: { old_key_id: current.id, new_key_id: newId, reencrypted },
  });
  return { old_key_id: current.id, new_key_id: newId, reencrypted };
}
