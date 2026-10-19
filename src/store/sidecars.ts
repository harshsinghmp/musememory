import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../sqlite.ts";
import type { MemoryEntry } from "../types.ts";
import type { Store } from "../store.ts";

export interface L1Abstract {
  summary: string;
  key_takeaways: string[];
  entities: string[];
  estimated_tokens: number;
}

export interface AbstractSidecar {
  id: string;
  l0: string;
  l1: L1Abstract;
  source_content_hash: string;
  generated_at: string;
}

/**
 * Strips formatting, markdown headers, links, and HTML tags into plain readable text.
 */
function cleanPlainText(text: string): string {
  if (!text) return "";
  return text
    .replace(/^#+\s+/gm, "") // headers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // markdown links
    .replace(/[*_~`]/g, "") // styling asterisks, underscores, backticks
    .replace(/<[^>]+>/g, "") // html tags
    .replace(/\s+/g, " ") // normalize spacing
    .trim();
}

/**
 * Computes deterministic content hash for memory text.
 */
export function computeMemoryContentHash(title: string, content: string): string {
  return createHash("sha256")
    .update(`${title.trim()}\n${content.trim()}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * T-122: Generates clean single-line L0 executive summary (<= 120 characters).
 * Clean-room MIT implementation.
 */
export function generateL0Abstract(entry: MemoryEntry): string {
  const title = cleanPlainText(entry.title);
  const plainContent = cleanPlainText(entry.content);

  // If title is already concise and descriptive (>= 20 chars), use it as prime basis
  let candidate = title;
  if (!candidate || candidate.length < 20) {
    // Extract first sentence of content
    const firstSentence = plainContent.split(/[.!?]\s+/)[0] || plainContent;
    candidate = candidate ? `${candidate}: ${firstSentence}` : firstSentence;
  }

  candidate = cleanPlainText(candidate);
  if (candidate.length <= 120) {
    return candidate;
  }

  // Trim to last whole word boundary <= 117 chars + "..."
  const truncated = candidate.slice(0, 117);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 40) {
    return `${truncated.slice(0, lastSpace)}...`;
  }
  return `${truncated}...`;
}

/**
 * T-122: Generates structured L1 abstract containing summary, key takeaways, entities, and token count.
 * Clean-room MIT implementation.
 */
export function generateL1Abstract(entry: MemoryEntry): L1Abstract {
  const plainContent = cleanPlainText(entry.content);

  // 1. Summary: First 1-2 sentences up to 250 characters
  const sentences = plainContent
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  let summary = "";
  if (sentences.length > 0) {
    summary = sentences.slice(0, 2).join(" ");
  } else {
    summary = plainContent.slice(0, 250);
  }
  if (summary.length > 250) {
    summary = `${summary.slice(0, 247)}...`;
  }

  // 2. Key Takeaways: Extract bullet points or key declarative sentences
  const takeaways: string[] = [];
  const lines = entry.content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const bulletText = cleanPlainText(trimmed.replace(/^[-*•\d.]+\s+/, ""));
      if (bulletText.length >= 8 && bulletText.length <= 160) {
        takeaways.push(bulletText);
        if (takeaways.length >= 4) break;
      }
    }
  }

  // If no bullets found, use remaining sentences as takeaways
  if (takeaways.length === 0 && sentences.length > 1) {
    for (let i = 1; i < Math.min(sentences.length, 4); i++) {
      const s = sentences[i];
      if (s.length >= 10 && s.length <= 160) {
        takeaways.push(s);
      }
    }
  }

  if (takeaways.length === 0) {
    takeaways.push(summary);
  }

  // 3. Extracted Entities: AST symbols, tags, backticked code tokens
  const entitySet = new Set<string>();
  for (const tag of entry.tags ?? []) {
    entitySet.add(tag);
  }
  for (const sym of entry.graph?.symbol_names ?? []) {
    entitySet.add(sym);
  }
  for (const p of entry.graph?.affected_paths ?? []) {
    entitySet.add(p);
  }

  // Extract backticked symbols from raw content
  const backtickMatches = entry.content.match(/`([^`]+)`/g);
  if (backtickMatches) {
    for (const m of backtickMatches) {
      const sym = m.replace(/`/g, "").trim();
      if (sym.length >= 2 && sym.length <= 40 && !sym.includes(" ")) {
        entitySet.add(sym);
      }
    }
  }

  const entities = Array.from(entitySet).slice(0, 10);

  // 4. Estimated tokens (~4 chars per token)
  const l1Text = `${summary} ${takeaways.join(" ")} ${entities.join(" ")}`;
  const estimated_tokens = Math.max(1, Math.ceil(l1Text.length / 4));

  return {
    summary,
    key_takeaways: takeaways,
    entities,
    estimated_tokens,
  };
}

/**
 * Builds a complete AbstractSidecar from a MemoryEntry.
 */
export function buildAbstractSidecar(entry: MemoryEntry): AbstractSidecar {
  const l0 = generateL0Abstract(entry);
  const l1 = generateL1Abstract(entry);
  const source_content_hash = computeMemoryContentHash(entry.title, entry.content);
  const generated_at = new Date().toISOString();

  return {
    id: entry.id,
    l0,
    l1,
    source_content_hash,
    generated_at,
  };
}

/** Path to file sidecar: <memoryDir>/abstracts/<id>.json */
export function sidecarFilePath(memoryDir: string, id: string): string {
  const dir = join(memoryDir, "abstracts");
  return join(dir, `${id}.json`);
}

/**
 * Saves abstract sidecar to filesystem.
 */
export function saveAbstractSidecar(memoryDir: string, sidecar: AbstractSidecar): void {
  const dir = join(memoryDir, "abstracts");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(sidecarFilePath(memoryDir, sidecar.id), JSON.stringify(sidecar, null, 2), "utf8");
}

/**
 * Loads abstract sidecar from filesystem. Returns null if missing or invalid.
 */
export function loadAbstractSidecar(memoryDir: string, id: string): AbstractSidecar | null {
  const path = sidecarFilePath(memoryDir, id);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as AbstractSidecar;
  } catch {
    return null;
  }
}

/**
 * Lists all abstract sidecars stored on disk.
 */
export function listAbstractSidecars(memoryDir: string): AbstractSidecar[] {
  const dir = join(memoryDir, "abstracts");
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir);
  const sidecars: AbstractSidecar[] = [];
  for (const file of entries) {
    if (file.endsWith(".json")) {
      try {
        const raw = readFileSync(join(dir, file), "utf8");
        sidecars.push(JSON.parse(raw));
      } catch {}
    }
  }
  return sidecars;
}

/**
 * Initializes SQLite table for caching abstract sidecars.
 */
export function initSidecarTable(db: SqliteDatabase): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS abstract_sidecars (
      id TEXT PRIMARY KEY,
      l0 TEXT NOT NULL,
      l1 TEXT NOT NULL,
      source_content_hash TEXT,
      generated_at TEXT NOT NULL
    )
  `);
}

/**
 * Saves abstract sidecar to SQLite cache.
 */
export function saveAbstractSidecarToDb(db: SqliteDatabase, sidecar: AbstractSidecar): void {
  initSidecarTable(db);
  db.run(
    `
    INSERT INTO abstract_sidecars (id, l0, l1, source_content_hash, generated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      l0 = excluded.l0,
      l1 = excluded.l1,
      source_content_hash = excluded.source_content_hash,
      generated_at = excluded.generated_at
  `,
    [sidecar.id, sidecar.l0, JSON.stringify(sidecar.l1), sidecar.source_content_hash, sidecar.generated_at],
  );
}

/**
 * Loads abstract sidecar from SQLite cache.
 */
export function loadAbstractSidecarFromDb(db: SqliteDatabase, id: string): AbstractSidecar | null {
  initSidecarTable(db);
  const row = db.query<{
    id: string;
    l0: string;
    l1: string;
    source_content_hash: string;
    generated_at: string;
  }>(`SELECT id, l0, l1, source_content_hash, generated_at FROM abstract_sidecars WHERE id = ?`).get([id]);

  if (!row) return null;
  try {
    return {
      id: row.id,
      l0: row.l0,
      l1: JSON.parse(row.l1),
      source_content_hash: row.source_content_hash,
      generated_at: row.generated_at,
    };
  } catch {
    return null;
  }
}

/**
 * Ensures an abstract sidecar exists and is up to date with entry content hash.
 * Persists to disk and SQLite if store.db is active.
 */
export function ensureAbstractSidecar(
  store: Store,
  entry: MemoryEntry,
  options: { force?: boolean } = {},
): AbstractSidecar {
  const currentHash = computeMemoryContentHash(entry.title, entry.content);

  // 1. Try cache if not forced
  if (!options.force) {
    if (store.db) {
      const cached = loadAbstractSidecarFromDb(store.db, entry.id);
      if (cached && cached.source_content_hash === currentHash) {
        return cached;
      }
    }

    if (store.memoryDir) {
      const fileCached = loadAbstractSidecar(store.memoryDir, entry.id);
      if (fileCached && fileCached.source_content_hash === currentHash) {
        if (store.db) saveAbstractSidecarToDb(store.db, fileCached);
        return fileCached;
      }
    }
  }

  // 2. Generate new sidecar
  const sidecar = buildAbstractSidecar(entry);

  // 3. Persist
  if (store.memoryDir) {
    saveAbstractSidecar(store.memoryDir, sidecar);
  }
  if (store.db) {
    saveAbstractSidecarToDb(store.db, sidecar);
  }

  return sidecar;
}
