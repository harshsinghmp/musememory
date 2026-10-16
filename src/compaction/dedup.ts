import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface DigestEntry {
  timestamp: string;
  memory_id?: string;
  type?: string;
}

export interface DigestDedupStore {
  version: 1;
  updated_at: string;
  hashes: Record<string, DigestEntry>;
}

export function digestDedupFilePath(memoryDir: string): string {
  return join(memoryDir, "digest_dedup.json");
}

/**
 * Computes deterministic SHA-256 digest with whitespace and casing normalization.
 */
export function computeFactDigest(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Loads the persisted digest deduplication store from .memory/digest_dedup.json.
 */
export function loadDigestDedupStore(memoryDir: string): DigestDedupStore {
  const filePath = digestDedupFilePath(memoryDir);
  if (!existsSync(filePath)) {
    return {
      version: 1,
      updated_at: new Date().toISOString(),
      hashes: {},
    };
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as DigestDedupStore;
    if (parsed.version === 1 && parsed.hashes) {
      return parsed;
    }
  } catch {}

  return {
    version: 1,
    updated_at: new Date().toISOString(),
    hashes: {},
  };
}

/**
 * Atomically persists the digest deduplication store to disk.
 */
export function saveDigestDedupStore(memoryDir: string, store: DigestDedupStore): void {
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  const filePath = digestDedupFilePath(memoryDir);
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  store.updated_at = new Date().toISOString();
  writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf8");
  renameSync(tmpPath, filePath);
}

/**
 * Returns true if the normalized text digest has already been recorded.
 */
export function isFactDigestRecorded(memoryDir: string, text: string): boolean {
  if (!text || !text.trim()) return false;
  const store = loadDigestDedupStore(memoryDir);
  const hash = computeFactDigest(text);
  return store.hashes[hash] !== undefined;
}

/**
 * Persists a new fact digest in the deduplication store.
 */
export function recordFactDigest(
  memoryDir: string,
  text: string,
  memoryId?: string,
  type?: string,
): void {
  if (!text || !text.trim()) return;
  const store = loadDigestDedupStore(memoryDir);
  const hash = computeFactDigest(text);
  store.hashes[hash] = {
    timestamp: new Date().toISOString(),
    memory_id: memoryId,
    type,
  };
  saveDigestDedupStore(memoryDir, store);
}
