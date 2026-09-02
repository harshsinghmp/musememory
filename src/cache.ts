import type { MemoryEntry } from "./types.ts";
import type { FormattedContext } from "./retrieval.ts";

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  invalidations: number;
  entryCount: number;
  queryCount: number;
  contextCount: number;
  version: number;
}

export interface CacheOptions {
  maxEntries?: number;
  maxQueries?: number;
  maxContexts?: number;
  defaultTtlMs?: number;
}

interface CacheItem<T> {
  value: T;
  expiresAt: number;
  mtimeMs?: number;
}

/**
 * High-performance, zero-dependency in-process L0 Hot Cache for MuseMemory.
 * Provides microsecond-level O(1) entry lookups, query result caching,
 * and L1 prompt context caching with store-version invalidation.
 */
export class MemoryStoreCache {
  private maxEntries: number;
  private maxQueries: number;
  private maxContexts: number;
  private defaultTtlMs: number;

  // L0: Memory entries keyed by ID
  private entries = new Map<string, CacheItem<MemoryEntry>>();

  // L0: Query / listing results keyed by query signature
  private queryCache = new Map<string, CacheItem<MemoryEntry[]>>();

  // L1: Formatted prompt context blocks keyed by context signature
  private contextCache = new Map<string, CacheItem<FormattedContext>>();

  // Invalidation generation counter (incremented on any mutation)
  private version: number = 1;

  // Statistics
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    invalidations: 0,
    entryCount: 0,
    queryCount: 0,
    contextCount: 0,
    version: 1,
  };

  constructor(options: CacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.maxQueries = options.maxQueries ?? 100;
    this.maxContexts = options.maxContexts ?? 50;
    this.defaultTtlMs = options.defaultTtlMs ?? 5 * 60 * 1000; // 5 minutes default
  }

  public getVersion(): number {
    return this.version;
  }

  // --- L0 Entry Cache ---

  public getEntry(id: string, currentMtimeMs?: number): MemoryEntry | undefined {
    const item = this.entries.get(id);
    if (!item) {
      this.stats.misses++;
      return undefined;
    }

    if (Date.now() > item.expiresAt) {
      this.entries.delete(id);
      this.stats.misses++;
      this.stats.entryCount = this.entries.size;
      return undefined;
    }

    // If disk mtime is provided and differs from cached mtime, entry was modified externally
    if (currentMtimeMs !== undefined && item.mtimeMs !== undefined && item.mtimeMs !== currentMtimeMs) {
      this.entries.delete(id);
      this.stats.misses++;
      this.stats.entryCount = this.entries.size;
      return undefined;
    }

    // Refresh LRU order
    this.entries.delete(id);
    this.entries.set(id, item);
    this.stats.hits++;
    // Return clone to protect cache from accidental caller mutations
    return { ...item.value };
  }

  public setEntry(entry: MemoryEntry, ttlMs?: number, mtimeMs?: number): void {
    if (!entry || !entry.id) return;

    if (this.entries.size >= this.maxEntries && !this.entries.has(entry.id)) {
      // Evict oldest (first inserted key in Map)
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
        this.stats.evictions++;
      }
    }

    this.entries.set(entry.id, {
      value: { ...entry },
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
      mtimeMs,
    });
    this.stats.entryCount = this.entries.size;
    this.invalidateQueries();
  }

  public deleteEntry(id: string): void {
    if (this.entries.delete(id)) {
      this.stats.entryCount = this.entries.size;
      this.invalidateQueries();
    }
  }

  // --- L0 Query Cache ---

  public getQuery(key: string, currentDirMtime?: number): MemoryEntry[] | undefined {
    const item = this.queryCache.get(key);
    if (!item) return undefined;

    if (Date.now() > item.expiresAt) {
      this.queryCache.delete(key);
      this.stats.queryCount = this.queryCache.size;
      return undefined;
    }

    if (currentDirMtime !== undefined && item.mtimeMs !== undefined && item.mtimeMs !== currentDirMtime) {
      this.queryCache.delete(key);
      this.stats.queryCount = this.queryCache.size;
      return undefined;
    }

    this.stats.hits++;
    return item.value;
  }

  public setQuery(key: string, results: MemoryEntry[], ttlMs?: number, dirMtime?: number): void {
    if (this.queryCache.size >= this.maxQueries && !this.queryCache.has(key)) {
      const oldestKey = this.queryCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.queryCache.delete(oldestKey);
        this.stats.evictions++;
      }
    }

    this.queryCache.set(key, {
      value: results,
      expiresAt: Date.now() + (ttlMs ?? 60 * 1000), // 1 minute default for query results
      mtimeMs: dirMtime,
    });
    this.stats.queryCount = this.queryCache.size;
  }

  // --- L1 Context Cache ---

  public getContext(key: string): FormattedContext | undefined {
    const item = this.contextCache.get(key);
    if (!item) return undefined;

    if (Date.now() > item.expiresAt) {
      this.contextCache.delete(key);
      this.stats.contextCount = this.contextCache.size;
      return undefined;
    }

    this.stats.hits++;
    return item.value;
  }

  public setContext(key: string, context: FormattedContext, ttlMs?: number): void {
    if (this.contextCache.size >= this.maxContexts && !this.contextCache.has(key)) {
      const oldestKey = this.contextCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.contextCache.delete(oldestKey);
        this.stats.evictions++;
      }
    }

    this.contextCache.set(key, {
      value: context,
      expiresAt: Date.now() + (ttlMs ?? 30 * 1000), // 30 seconds default for hot context
    });
    this.stats.contextCount = this.contextCache.size;
  }

  // --- Invalidation ---

  /**
   * Invalidate query and context caches when entries mutate.
   */
  public invalidateQueries(): void {
    this.version++;
    this.queryCache.clear();
    this.contextCache.clear();
    this.stats.invalidations++;
    this.stats.queryCount = 0;
    this.stats.contextCount = 0;
    this.stats.version = this.version;
  }

  /**
   * Complete flush of all cache tiers.
   */
  public clear(): void {
    this.version++;
    this.entries.clear();
    this.queryCache.clear();
    this.contextCache.clear();
    this.stats.entryCount = 0;
    this.stats.queryCount = 0;
    this.stats.contextCount = 0;
    this.stats.invalidations++;
    this.stats.version = this.version;
  }

  public getStats(): CacheStats {
    return {
      ...this.stats,
      entryCount: this.entries.size,
      queryCount: this.queryCache.size,
      contextCount: this.contextCache.size,
      version: this.version,
    };
  }
}

// Global process-level cache registry keyed by memory directory
const storeCacheRegistry = new Map<string, MemoryStoreCache>();

export function getOrCreateStoreCache(memoryDir: string, options?: CacheOptions): MemoryStoreCache {
  let cache = storeCacheRegistry.get(memoryDir);
  if (!cache) {
    cache = new MemoryStoreCache(options);
    storeCacheRegistry.set(memoryDir, cache);
  }
  return cache;
}

export function resetGlobalCache(): void {
  for (const cache of storeCacheRegistry.values()) {
    cache.clear();
  }
  storeCacheRegistry.clear();
}
