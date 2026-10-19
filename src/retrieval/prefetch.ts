/**
 * T-112: Topic-overlap >0.6 prefetch skip in retrieval.
 * Tracks consecutive session queries and skips redundant prefetch/retrieval
 * when incoming queries share high topic overlap (>0.6) with the previous query.
 */

import { computeJaccardSimilarity } from "../quality/dedup.ts";

export const DEFAULT_TOPIC_OVERLAP_THRESHOLD = 0.6;
export const DEFAULT_PREFETCH_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface PrefetchSkipDecision {
  skip: boolean;
  overlap: number;
  priorQuery?: string;
  reason?: string;
}

export function computeQueryTopicOverlap(queryA: string, queryB: string): number {
  if (!queryA || !queryB) return 0;
  const qA = queryA.trim().toLowerCase();
  const qB = queryB.trim().toLowerCase();
  if (qA === qB) return 1.0;

  return computeJaccardSimilarity(qA, qB);
}

export interface CachedPrefetchEntry<T = any> {
  query: string;
  timestamp: number;
  data: T;
  ttlMs: number;
}

export class SessionPrefetchCache<T = any> {
  private readonly defaultThreshold: number;
  private readonly defaultTtlMs: number;
  // Map<sessionId, CachedPrefetchEntry<T>>
  private sessions: Map<string, CachedPrefetchEntry<T>> = new Map();

  constructor(
    defaultThreshold = DEFAULT_TOPIC_OVERLAP_THRESHOLD,
    defaultTtlMs = DEFAULT_PREFETCH_TTL_MS
  ) {
    this.defaultThreshold = defaultThreshold;
    this.defaultTtlMs = defaultTtlMs;
  }

  checkPrefetchSkip(
    sessionId: string,
    query: string,
    options: {
      threshold?: number;
      ttlMs?: number;
      now?: number;
    } = {}
  ): PrefetchSkipDecision {
    if (!sessionId || !query || !query.trim()) {
      return { skip: false, overlap: 0 };
    }

    const cached = this.sessions.get(sessionId);
    if (!cached) {
      return { skip: false, overlap: 0 };
    }

    const now = options.now ?? Date.now();
    const effectiveTtl = options.ttlMs ?? cached.ttlMs ?? this.defaultTtlMs;
    if (now - cached.timestamp > effectiveTtl) {
      this.sessions.delete(sessionId);
      return { skip: false, overlap: 0 };
    }

    const overlap = computeQueryTopicOverlap(cached.query, query);
    const threshold = options.threshold ?? this.defaultThreshold;

    if (overlap > threshold) {
      return {
        skip: true,
        overlap,
        priorQuery: cached.query,
        reason: `topic_overlap_skip: overlap ${overlap.toFixed(2)} > ${threshold} with prior query "${cached.query}"`,
      };
    }

    return {
      skip: false,
      overlap,
      priorQuery: cached.query,
    };
  }

  recordPrefetch(
    sessionId: string,
    query: string,
    data: T,
    options: { now?: number; ttlMs?: number } = {}
  ): void {
    if (!sessionId || !query || !query.trim()) return;
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;

    this.sessions.set(sessionId, {
      query: query.trim(),
      timestamp: now,
      data,
      ttlMs,
    });
  }

  getCached(sessionId: string, options: { now?: number; ttlMs?: number } = {}): T | undefined {
    const cached = this.sessions.get(sessionId);
    if (!cached) return undefined;

    const now = options.now ?? Date.now();
    const effectiveTtl = options.ttlMs ?? cached.ttlMs ?? this.defaultTtlMs;
    if (now - cached.timestamp > effectiveTtl) {
      this.sessions.delete(sessionId);
      return undefined;
    }

    return cached.data;
  }

  invalidate(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  clearAll(): void {
    this.sessions.clear();
  }
}

export const defaultPrefetchCache = new SessionPrefetchCache();
