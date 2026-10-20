import type { SqliteDatabase } from "./sqlite.ts";
import type { OutboxEntry, OutboxStatus } from "./types.ts";

export interface EnqueueOutboxOptions {
  entry_id: string;
  operation: string;
  payload: Record<string, any> | string;
  idempotency_key?: string;
  auto_replay?: boolean;
}

export interface DbOutboxRow {
  id: string;
  entry_id: string;
  operation: string;
  payload: string;
  status: string;
  idempotency_key: string | null;
  auto_replay: number;
  attempts: number;
  last_attempt_at: string | null;
  locked_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToOutboxEntry(row: DbOutboxRow): OutboxEntry {
  return {
    id: row.id,
    entry_id: row.entry_id,
    operation: row.operation,
    payload: row.payload,
    status: row.status as OutboxStatus,
    idempotency_key: row.idempotency_key,
    auto_replay: Boolean(row.auto_replay),
    attempts: Number(row.attempts || 0),
    last_attempt_at: row.last_attempt_at,
    locked_at: row.locked_at,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

let lastOutboxTs = 0;
let outboxSeq = 0;

function makeOutboxId(): string {
  const now = Date.now();
  if (now <= lastOutboxTs) {
    outboxSeq++;
  } else {
    lastOutboxTs = now;
    outboxSeq = 0;
  }
  const idTimestamp = outboxSeq === 0 ? String(now) : `${now}${String(outboxSeq).padStart(3, "0")}`;
  return `ob_${idTimestamp}`;
}

/**
 * T-041: Enqueues an entry into the write outbox ledger.
 * Non-idempotent operations should set auto_replay=false (T-043: defaults to held on lock expiration/failure).
 */
export function enqueueOutbox(db: SqliteDatabase, opts: EnqueueOutboxOptions): OutboxEntry {
  const now = new Date().toISOString();
  const id = makeOutboxId();
  const payloadStr = typeof opts.payload === "string" ? opts.payload : JSON.stringify(opts.payload);
  const autoReplayVal = opts.auto_replay === false ? 0 : 1;

  db.run(
    `INSERT INTO outbox (
      id, entry_id, operation, payload, status, idempotency_key,
      auto_replay, attempts, last_attempt_at, locked_at, error,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, 0, NULL, NULL, NULL, ?, ?)`,
    [
      id,
      opts.entry_id,
      opts.operation,
      payloadStr,
      opts.idempotency_key ?? null,
      autoReplayVal,
      now,
      now,
    ],
  );

  return {
    id,
    entry_id: opts.entry_id,
    operation: opts.operation,
    payload: payloadStr,
    status: "pending",
    idempotency_key: opts.idempotency_key ?? null,
    auto_replay: autoReplayVal === 1,
    attempts: 0,
    last_attempt_at: null,
    locked_at: null,
    error: null,
    created_at: now,
    updated_at: now,
  };
}

export function getOutboxEntry(db: SqliteDatabase, id: string): OutboxEntry | null {
  try {
    const row = db.query<DbOutboxRow>(`SELECT * FROM outbox WHERE id = ? LIMIT 1`).get([id]);
    return row ? rowToOutboxEntry(row) : null;
  } catch {
    return null;
  }
}

export function listOutbox(
  db: SqliteDatabase,
  filters?: { status?: OutboxStatus; limit?: number },
): OutboxEntry[] {
  try {
    let sql = `SELECT * FROM outbox`;
    const params: unknown[] = [];
    if (filters?.status) {
      sql += ` WHERE status = ?`;
      params.push(filters.status);
    }
    sql += ` ORDER BY created_at ASC`;
    if (filters?.limit) {
      sql += ` LIMIT ?`;
      params.push(filters.limit);
    }
    const rows = db.query<DbOutboxRow>(sql).all(params);
    return rows.map(rowToOutboxEntry);
  } catch {
    return [];
  }
}

/**
 * Atomically claims up to `limit` pending outbox entries, transitioning them to 'processing'
 * and stamping `locked_at` and incrementing `attempts`.
 */
export function claimOutboxBatch(db: SqliteDatabase, limit = 10): OutboxEntry[] {
  try {
    const pending = db
      .query<DbOutboxRow>(`SELECT * FROM outbox WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`)
      .all([limit]);

    if (pending.length === 0) return [];

    const now = new Date().toISOString();
    const claimed: OutboxEntry[] = [];

    for (const row of pending) {
      db.run(
        `UPDATE outbox SET status = 'processing', locked_at = ?, last_attempt_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'pending'`,
        [now, now, now, row.id],
      );
      claimed.push({
        ...rowToOutboxEntry(row),
        status: "processing",
        locked_at: now,
        last_attempt_at: now,
        attempts: Number(row.attempts || 0) + 1,
        updated_at: now,
      });
    }

    return claimed;
  } catch {
    return [];
  }
}

/**
 * Transitions outbox entry to 'sent' terminal state.
 */
export function markOutboxSent(db: SqliteDatabase, id: string): void {
  const now = new Date().toISOString();
  db.run(
    `UPDATE outbox SET status = 'sent', locked_at = NULL, error = NULL, updated_at = ? WHERE id = ?`,
    [now, id],
  );
}

/**
 * Transitions outbox entry to 'held' (requires manual intervention/replay).
 */
export function markOutboxHeld(db: SqliteDatabase, id: string, reason?: string): void {
  const now = new Date().toISOString();
  db.run(
    `UPDATE outbox SET status = 'held', locked_at = NULL, error = ?, updated_at = ? WHERE id = ?`,
    [reason ?? null, now, id],
  );
}

/**
 * Handles failed outbox attempts. If maxAttempts is exceeded, transitions to 'failed'.
 * Otherwise, transitions to 'pending' (if auto_replay=1) or 'held' (if auto_replay=0).
 */
export function markOutboxFailed(
  db: SqliteDatabase,
  id: string,
  error: string,
  maxAttempts = 3,
): void {
  const entry = getOutboxEntry(db, id);
  if (!entry) return;

  const now = new Date().toISOString();
  if (entry.attempts >= maxAttempts) {
    db.run(
      `UPDATE outbox SET status = 'failed', locked_at = NULL, error = ?, updated_at = ? WHERE id = ?`,
      [error, now, id],
    );
  } else if (!entry.auto_replay) {
    db.run(
      `UPDATE outbox SET status = 'held', locked_at = NULL, error = ?, updated_at = ? WHERE id = ?`,
      [error, now, id],
    );
  } else {
    db.run(
      `UPDATE outbox SET status = 'pending', locked_at = NULL, error = ?, updated_at = ? WHERE id = ?`,
      [error, now, id],
    );
  }
}

/**
 * T-042: Stale-lock recovery sweep (300s expiration).
 * If a worker crashed or was killed while processing an outbox entry, its lock will expire.
 * Auto-replay entries revert to 'pending' to be safely re-attempted.
 * Non-idempotent (auto_replay=0) entries transition to 'held' for manual review.
 */
export function recoverStaleLocks(
  db: SqliteDatabase,
  staleAgeSeconds = 300,
): { recovered: number; held: number } {
  try {
    const rows = db
      .query<DbOutboxRow>(`SELECT * FROM outbox WHERE status = 'processing' AND locked_at IS NOT NULL`)
      .all();

    if (rows.length === 0) return { recovered: 0, held: 0 };

    const thresholdMs = Date.now() - staleAgeSeconds * 1000;
    const now = new Date().toISOString();
    let recovered = 0;
    let held = 0;

    for (const row of rows) {
      if (!row.locked_at) continue;
      const lockedMs = new Date(row.locked_at).getTime();
      if (isNaN(lockedMs) || lockedMs <= thresholdMs) {
        if (row.auto_replay) {
          db.run(
            `UPDATE outbox SET status = 'pending', locked_at = NULL, error = 'lock expired (stale worker recovered)', updated_at = ? WHERE id = ?`,
            [now, row.id],
          );
          recovered++;
        } else {
          db.run(
            `UPDATE outbox SET status = 'held', locked_at = NULL, error = 'lock expired on non-idempotent op (held for manual review)', updated_at = ? WHERE id = ?`,
            [now, row.id],
          );
          held++;
        }
      }
    }

    return { recovered, held };
  } catch {
    return { recovered: 0, held: 0 };
  }
}

/**
 * Processes a batch of outbox items with a custom handler.
 */
export async function processOutbox(
  db: SqliteDatabase,
  handler: (entry: OutboxEntry) => Promise<boolean> | boolean,
  options: { batchSize?: number; maxAttempts?: number } = {},
): Promise<{ processed: number; sent: number; failed: number; held: number }> {
  const batch = claimOutboxBatch(db, options.batchSize ?? 10);
  let sent = 0;
  let failed = 0;
  let held = 0;

  for (const entry of batch) {
    try {
      const ok = await handler(entry);
      if (ok) {
        markOutboxSent(db, entry.id);
        sent++;
      } else {
        markOutboxFailed(db, entry.id, "Handler returned false", options.maxAttempts ?? 3);
        const updated = getOutboxEntry(db, entry.id);
        if (updated?.status === "held") held++;
        else if (updated?.status === "failed") failed++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      markOutboxFailed(db, entry.id, msg, options.maxAttempts ?? 3);
      const updated = getOutboxEntry(db, entry.id);
      if (updated?.status === "held") held++;
      else if (updated?.status === "failed") failed++;
    }
  }

  return { processed: batch.length, sent, failed, held };
}
