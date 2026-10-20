import type { MemoryEntry } from "../types.ts";

export const DEFAULT_REINJECTION_WINDOW = 6;

export interface InjectedRecord {
  turn: number;
  timestamp: string;
}

export interface SuppressionFilterResult<T> {
  allowed: T[];
  suppressed: Array<{
    item: T;
    turnsAgo: number;
    injectedAtTurn: number;
  }>;
}

/**
 * T-108: Re-injection suppression per session with 6-turn LRU.
 * Tracks recently injected memories to eliminate redundant context pollution
 * across consecutive session turns.
 */
export class SessionReinjectionTracker {
  private readonly defaultWindow: number;
  // Map<sessionId, Map<memoryId, InjectedRecord>>
  private sessions: Map<string, Map<string, InjectedRecord>> = new Map();
  // Current turn per session (1-indexed)
  private turns: Map<string, number> = new Map();

  constructor(defaultWindow = DEFAULT_REINJECTION_WINDOW) {
    this.defaultWindow = defaultWindow;
  }

  getCurrentTurn(sessionId: string): number {
    return this.turns.get(sessionId) ?? 1;
  }

  advanceTurn(sessionId: string): number {
    const nextTurn = this.getCurrentTurn(sessionId) + 1;
    this.turns.set(sessionId, nextTurn);
    return nextTurn;
  }

  setTurn(sessionId: string, turn: number): void {
    this.turns.set(sessionId, Math.max(1, turn));
  }

  recordInjected(sessionId: string, memoryIds: string[], turn?: number): void {
    const activeTurn = turn ?? this.getCurrentTurn(sessionId);
    let sessionMap = this.sessions.get(sessionId);
    if (!sessionMap) {
      sessionMap = new Map();
      this.sessions.set(sessionId, sessionMap);
    }

    const now = new Date().toISOString();
    for (const id of memoryIds) {
      sessionMap.set(id, { turn: activeTurn, timestamp: now });
    }

    // Bounded cleanup: prune entries older than 2x window
    for (const [id, rec] of sessionMap.entries()) {
      if (activeTurn - rec.turn >= this.defaultWindow * 2) {
        sessionMap.delete(id);
      }
    }
  }

  isSuppressed(
    sessionId: string,
    memoryId: string,
    currentTurn?: number,
    window = this.defaultWindow
  ): { suppressed: boolean; turnsAgo?: number; injectedAtTurn?: number } {
    const sessionMap = this.sessions.get(sessionId);
    if (!sessionMap) {
      return { suppressed: false };
    }
    const rec = sessionMap.get(memoryId);
    if (!rec) {
      return { suppressed: false };
    }
    const activeTurn = currentTurn ?? this.getCurrentTurn(sessionId);
    const turnsAgo = activeTurn - rec.turn;
    if (turnsAgo >= 0 && turnsAgo < window) {
      return { suppressed: true, turnsAgo, injectedAtTurn: rec.turn };
    }
    return { suppressed: false, turnsAgo, injectedAtTurn: rec.turn };
  }

  filterSuppressed<T extends { id: string; type?: string; temporal_mode?: string }>(
    sessionId: string,
    entries: T[],
    options: {
      turn?: number;
      window?: number;
      exemptTypes?: string[];
      allowExempt?: boolean;
    } = {}
  ): SuppressionFilterResult<T> {
    const window = options.window ?? this.defaultWindow;
    const activeTurn = options.turn ?? this.getCurrentTurn(sessionId);
    const exempt = new Set(options.exemptTypes ?? ["constraint"]);
    const allowExempt = options.allowExempt !== false;

    const allowed: T[] = [];
    const suppressed: SuppressionFilterResult<T>["suppressed"] = [];

    for (const entry of entries) {
      if (allowExempt && (exempt.has(entry.type ?? "") || entry.temporal_mode === "timeless")) {
        allowed.push(entry);
        continue;
      }

      const check = this.isSuppressed(sessionId, entry.id, activeTurn, window);
      if (check.suppressed && check.turnsAgo !== undefined) {
        suppressed.push({
          item: entry,
          turnsAgo: check.turnsAgo,
          injectedAtTurn: check.injectedAtTurn ?? (activeTurn - check.turnsAgo),
        });
      } else {
        allowed.push(entry);
      }
    }

    return { allowed, suppressed };
  }

  resetSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.turns.delete(sessionId);
  }

  clearAll(): void {
    this.sessions.clear();
    this.turns.clear();
  }
}

export const defaultReinjectionTracker = new SessionReinjectionTracker();

/**
 * T-109: Self-echo suppression horizon (10 minutes).
 * Memories captured within this window by the active session are suppressed
 * unless corroborated or verified by user/authoritative sources.
 */
export const DEFAULT_ECHO_HORIZON_MS = 10 * 60 * 1000;

export interface SelfEchoCheckResult {
  isEcho: boolean;
  reason?: string;
  ageMs?: number;
}

export function isSelfEcho(
  entry: MemoryEntry,
  context: {
    sessionId?: string;
    now?: number;
    echoHorizonMs?: number;
    agent?: string;
  }
): SelfEchoCheckResult {
  if (!context.sessionId && !context.agent) {
    return { isEcho: false };
  }

  // Exempt authoritative or user-originated/confirmed memories
  if (
    entry.source === "user" ||
    entry.source === "human" ||
    entry.verification?.level === "authoritative" ||
    entry.verification?.level === "user-confirmed"
  ) {
    return { isEcho: false };
  }

  const now = context.now ?? Date.now();
  const createdTime = Date.parse(entry.created_at);
  if (isNaN(createdTime)) {
    return { isEcho: false };
  }

  const ageMs = now - createdTime;
  const horizon = context.echoHorizonMs ?? DEFAULT_ECHO_HORIZON_MS;
  if (ageMs < 0 || ageMs > horizon) {
    return { isEcho: false, ageMs };
  }

  // Session provenance check
  const sameSession = Boolean(context.sessionId && entry.session_id === context.sessionId);
  // Source agent provenance check
  const sameAgent = Boolean(
    context.agent &&
      entry.source &&
      entry.source.toLowerCase().includes(context.agent.toLowerCase())
  );

  if (sameSession || sameAgent) {
    const ageSec = Math.round(ageMs / 1000);
    const creatorDesc = sameSession
      ? `active session ${context.sessionId}`
      : `agent ${context.agent}`;
    return {
      isEcho: true,
      ageMs,
      reason: `self_echo_suppressed: created by ${creatorDesc} ${ageSec}s ago (within ${Math.round(horizon / 1000)}s echo horizon)`,
    };
  }

  return { isEcho: false, ageMs };
}

export function filterSelfEchoes(
  entries: MemoryEntry[],
  context: {
    sessionId?: string;
    now?: number;
    echoHorizonMs?: number;
    agent?: string;
    allowSelfEcho?: boolean;
  }
): {
  allowed: MemoryEntry[];
  suppressed: Array<{ entry: MemoryEntry; reason: string; ageMs: number }>;
} {
  if (context.allowSelfEcho) {
    return { allowed: entries, suppressed: [] };
  }

  const allowed: MemoryEntry[] = [];
  const suppressed: Array<{ entry: MemoryEntry; reason: string; ageMs: number }> = [];

  for (const entry of entries) {
    const check = isSelfEcho(entry, context);
    if (check.isEcho) {
      suppressed.push({
        entry,
        reason: check.reason ?? "self_echo_suppressed",
        ageMs: check.ageMs ?? 0,
      });
    } else {
      allowed.push(entry);
    }
  }

  return { allowed, suppressed };
}

/**
 * T-111: Seen-chunk TTL in retrieval (default: 5 minutes / 300,000ms).
 * Tracks chunks and memory entries already served to a session, suppressing
 * redundant re-serving within their active TTL window.
 */
export const DEFAULT_SEEN_CHUNK_TTL_MS = 5 * 60 * 1000;

export interface SeenChunkRecord {
  chunkKey: string;
  seenAt: number;
  ttlMs: number;
}

export function computeChunkKey(entry: {
  id: string;
  content?: string;
  content_hash?: string;
}): string {
  if (entry.content_hash && entry.content_hash.trim()) {
    return entry.content_hash;
  }
  if (entry.content && entry.content.length > 0) {
    return `${entry.id}:${entry.content.slice(0, 60)}`;
  }
  return entry.id;
}

export class SeenChunkTracker {
  private readonly defaultTtlMs: number;
  // Map<sessionId, Map<chunkKey, SeenChunkRecord>>
  private sessions: Map<string, Map<string, SeenChunkRecord>> = new Map();

  constructor(defaultTtlMs = DEFAULT_SEEN_CHUNK_TTL_MS) {
    this.defaultTtlMs = defaultTtlMs;
  }

  recordSeen(
    sessionId: string,
    items: Array<{ id: string; content?: string; content_hash?: string }>,
    options: { now?: number; ttlMs?: number } = {}
  ): void {
    if (!sessionId || !items.length) return;
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;

    let sessionMap = this.sessions.get(sessionId);
    if (!sessionMap) {
      sessionMap = new Map();
      this.sessions.set(sessionId, sessionMap);
    }

    for (const item of items) {
      const key = computeChunkKey(item);
      sessionMap.set(key, { chunkKey: key, seenAt: now, ttlMs });
    }

    // Prune expired records (older than 2x effective TTL)
    for (const [key, rec] of sessionMap.entries()) {
      if (now - rec.seenAt >= rec.ttlMs * 2) {
        sessionMap.delete(key);
      }
    }
  }

  isSeen(
    sessionId: string,
    item: { id: string; content?: string; content_hash?: string },
    options: { now?: number; ttlMs?: number } = {}
  ): { seen: boolean; remainingTtlMs?: number; seenAt?: number } {
    const sessionMap = this.sessions.get(sessionId);
    if (!sessionMap) return { seen: false };

    const key = computeChunkKey(item);
    const rec = sessionMap.get(key);
    if (!rec) return { seen: false };

    const now = options.now ?? Date.now();
    const effectiveTtl = options.ttlMs ?? rec.ttlMs ?? this.defaultTtlMs;
    const elapsed = now - rec.seenAt;

    if (elapsed >= 0 && elapsed < effectiveTtl) {
      return {
        seen: true,
        remainingTtlMs: effectiveTtl - elapsed,
        seenAt: rec.seenAt,
      };
    }

    return { seen: false, remainingTtlMs: 0, seenAt: rec.seenAt };
  }

  filterSeen<
    T extends {
      id: string;
      content?: string;
      content_hash?: string;
      type?: string;
      temporal_mode?: string;
    }
  >(
    sessionId: string,
    entries: T[],
    options: {
      now?: number;
      ttlMs?: number;
      exemptTypes?: string[];
      allowExempt?: boolean;
    } = {}
  ): {
    allowed: T[];
    suppressed: Array<{
      item: T;
      chunkKey: string;
      remainingTtlMs: number;
      seenAt: number;
      reason: string;
    }>;
  } {
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    const exempt = new Set(options.exemptTypes ?? ["constraint"]);
    const allowExempt = options.allowExempt !== false;

    const allowed: T[] = [];
    const suppressed: Array<{
      item: T;
      chunkKey: string;
      remainingTtlMs: number;
      seenAt: number;
      reason: string;
    }> = [];

    for (const entry of entries) {
      if (allowExempt && (exempt.has(entry.type ?? "") || entry.temporal_mode === "timeless")) {
        allowed.push(entry);
        continue;
      }

      const check = this.isSeen(sessionId, entry, { now, ttlMs });
      if (check.seen && check.remainingTtlMs !== undefined) {
        const sec = Math.ceil(check.remainingTtlMs / 1000);
        suppressed.push({
          item: entry,
          chunkKey: computeChunkKey(entry),
          remainingTtlMs: check.remainingTtlMs,
          seenAt: check.seenAt ?? now,
          reason: `seen_chunk_suppressed: served ${Math.round((now - (check.seenAt ?? now)) / 1000)}s ago (${sec}s TTL remaining)`,
        });
      } else {
        allowed.push(entry);
      }
    }

    return { allowed, suppressed };
  }

  resetSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  clearAll(): void {
    this.sessions.clear();
  }
}

export const defaultSeenChunkTracker = new SeenChunkTracker();
