import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { scanSecrets } from "./secrets.ts";
import type { SourceEntry, SourceType } from "./types.ts";

export type { SourceEntry, SourceType };

export function getSourcesFilePath(memoryDir: string): string {
  return join(memoryDir, "sources.json");
}

export function loadSources(memoryDir: string): SourceEntry[] {
  const filePath = getSourcesFilePath(memoryDir);
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSources(memoryDir: string, sources: SourceEntry[]): void {
  mkdirSync(memoryDir, { recursive: true });
  const filePath = getSourcesFilePath(memoryDir);
  writeFileSync(filePath, JSON.stringify(sources, null, 2), "utf-8");
}

export function addSource(
  memoryDir: string,
  input: {
    url: string;
    title: string;
    source_type?: SourceType;
    excerpt?: string;
    author?: string;
    metadata?: Record<string, any>;
    id?: string;
    retrieved_at?: string;
  },
): SourceEntry {
  const textToScan = `${input.title}\n${input.url}\n${input.excerpt ?? ""}\n${input.author ?? ""}`;
  const secrets = scanSecrets(textToScan);
  if (secrets.length > 0) {
    throw new Error(`Vibeguard: Detected secret in source data: ${secrets.join(", ")}`);
  }

  const sources = loadSources(memoryDir);
  const id = input.id ?? `src_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const retrieved_at = input.retrieved_at ?? new Date().toISOString();

  const sourceEntry: SourceEntry = {
    id,
    url: input.url,
    title: input.title,
    source_type: input.source_type ?? "documentation",
    excerpt: input.excerpt,
    author: input.author,
    retrieved_at,
    metadata: input.metadata,
  };

  const existingIdx = sources.findIndex((s) => s.id === id);
  if (existingIdx >= 0) {
    sources[existingIdx] = sourceEntry;
  } else {
    sources.push(sourceEntry);
  }

  saveSources(memoryDir, sources);
  return sourceEntry;
}

export function getSource(memoryDir: string, id: string): SourceEntry | null {
  const sources = loadSources(memoryDir);
  return sources.find((s) => s.id === id) ?? null;
}

export function listSources(
  memoryDir: string,
  filter?: { source_type?: string; query?: string },
): SourceEntry[] {
  let sources = loadSources(memoryDir);
  if (filter?.source_type) {
    const st = filter.source_type.toLowerCase();
    sources = sources.filter((s) => s.source_type.toLowerCase() === st);
  }
  if (filter?.query && filter.query.trim()) {
    const q = filter.query.toLowerCase().trim();
    sources = sources.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.url.toLowerCase().includes(q) ||
        (s.excerpt && s.excerpt.toLowerCase().includes(q)) ||
        (s.author && s.author.toLowerCase().includes(q)),
    );
  }
  return sources;
}

export function findSources(memoryDir: string, query: string): SourceEntry[] {
  return listSources(memoryDir, { query });
}
