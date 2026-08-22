import type { Store } from "./store.ts";
import { propose, list, save, nowIso } from "./store.ts";
import type { MemoryEntry } from "./types.ts";

export function recordSessionStart(
  store: Store,
  project: string,
  note?: string,
): { entry: MemoryEntry; sessionId: string } {
  const sessionId = `s_${Date.now()}`;
  const entry = propose(store, {
    content: note ? `Session started: ${note}` : `Session started for project ${project}`,
    project,
    title: `Session ${sessionId} start`,
    type: "session",
    tags: ["session", "timeline"],
    confirmed: true,
  });
  entry.session_id = sessionId;
  save(store, entry);
  return { entry, sessionId };
}

export function findSession(store: Store, sessionId: string): MemoryEntry | null {
  const entries = list(store);
  return entries.find((e) => e.session_id === sessionId && e.type === "session") ?? null;
}

export function recordSessionEnd(
  store: Store,
  sessionId: string,
  project: string,
  summary?: string,
): MemoryEntry | null {
  const start = findSession(store, sessionId);
  const now = nowIso();
  const entry = propose(store, {
    content: summary ? `Session ended: ${summary}` : `Session ${sessionId} completed`,
    project: start?.project ?? project,
    title: `Session ${sessionId} end`,
    type: "session",
    tags: ["session", "timeline", "completed"],
    confirmed: true,
  });
  entry.session_id = sessionId;
  save(store, entry);
  return entry;
}

/**
 * Retrieve all memories produced or linked within a specific working session.
 */
export function getSessionMemories(store: Store, sessionId: string): MemoryEntry[] {
  return list(store).filter((e) => e.session_id === sessionId && e.type !== "session");
}

/**
 * Link an array of memory IDs directly to a session timeline node.
 */
export function linkMemoriesToSession(
  store: Store,
  sessionId: string,
  memoryIds: string[],
): MemoryEntry[] {
  const updated: MemoryEntry[] = [];
  const entries = list(store);
  for (const id of memoryIds) {
    const entry = entries.find((e) => e.id === id);
    if (entry) {
      entry.session_id = sessionId;
      save(store, entry);
      updated.push(entry);
    }
  }
  return updated;
}
