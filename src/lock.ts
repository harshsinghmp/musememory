import {
  openSync,
  closeSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  writeSync,
  fsyncSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

export class StoreLockError extends Error {
  constructor(message: string, public readonly lockPath: string, public readonly holderPid?: number) {
    super(message);
    this.name = "StoreLockError";
  }
}

export interface LockInfo {
  pid: number;
  hostname: string;
  timestamp: string;
  nonce: string;
}

export interface StoreLockHandle {
  lockPath: string;
  fd: number;
  info: LockInfo;
}

function isPidAlive(pid: number): boolean {
  try {
    // Sending signal 0 checks for process existence without killing it
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // ESRCH means process does not exist
    return err?.code !== "ESRCH";
  }
}

function readLockInfo(lockPath: string): LockInfo | null {
  try {
    const raw = readFileSync(lockPath, "utf8");
    return JSON.parse(raw) as LockInfo;
  } catch {
    return null;
  }
}

/**
 * T-044: Single-writer file lock that protects dual-write YAML and JSONL ledgers across processes.
 * Fails loud if the lock is held beyond `timeoutMs`. Automatically breaks stale locks from dead processes.
 */
export function acquireStoreLock(
  memoryDir: string,
  options: { timeoutMs?: number; pollIntervalMs?: number; staleAgeMs?: number } = {},
): StoreLockHandle {
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  const lockPath = join(memoryDir, ".lock");
  const timeoutMs = options.timeoutMs ?? 5000;
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  const staleAgeMs = options.staleAgeMs ?? 30000; // 30s stale threshold for crashed processes
  const start = Date.now();

  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const lockInfo: LockInfo = {
    pid: process.pid,
    hostname: typeof process.env.HOSTNAME === "string" ? process.env.HOSTNAME : "localhost",
    timestamp: new Date().toISOString(),
    nonce,
  };

  while (true) {
    try {
      // O_CREAT | O_EXCL ('wx') atomically fails if the file already exists
      const fd = openSync(lockPath, "wx");
      const payload = JSON.stringify(lockInfo);
      writeSync(fd, payload, 0, "utf8");
      fsyncSync(fd);

      return {
        lockPath,
        fd,
        info: lockInfo,
      };
    } catch (err: any) {
      if (err?.code !== "EEXIST") {
        throw err;
      }

      // Lockfile already exists. Inspect if it's stale or from a deceased process.
      const existingInfo = readLockInfo(lockPath);
      let isStale = false;

      if (existingInfo) {
        // If holder PID is on same machine and dead, lock is definitely stale
        if (typeof existingInfo.pid === "number" && !isPidAlive(existingInfo.pid)) {
          isStale = true;
        } else if (existingInfo.timestamp) {
          const lockAge = Date.now() - new Date(existingInfo.timestamp).getTime();
          if (lockAge > staleAgeMs) {
            isStale = true;
          }
        }
      } else {
        // Unparseable lock file older than 5s
        try {
          const stat = statSync(lockPath);
          if (Date.now() - stat.mtimeMs > 5000) isStale = true;
        } catch {}
      }

      if (isStale) {
        try {
          unlinkSync(lockPath);
          continue; // Immediate retry after unlinking dead lock
        } catch {}
      }

      const elapsed = Date.now() - start;
      if (elapsed >= timeoutMs) {
        throw new StoreLockError(
          `Failed to acquire store lock on '${lockPath}' after ${elapsed}ms (lock held by PID ${existingInfo?.pid ?? "unknown"})`,
          lockPath,
          existingInfo?.pid,
        );
      }

      // Busy-wait sleep with sync pause
      const sleepEnd = Date.now() + pollIntervalMs;
      while (Date.now() < sleepEnd) {
        // spin wait in small increments
      }
    }
  }
}

export function releaseStoreLock(handle: StoreLockHandle): void {
  try {
    closeSync(handle.fd);
  } catch {}

  try {
    // Only unlink if the lock still belongs to us (matches nonce)
    const current = readLockInfo(handle.lockPath);
    if (!current || current.nonce === handle.info.nonce) {
      unlinkSync(handle.lockPath);
    }
  } catch {}
}

/**
 * T-044: Executes `fn` with the single-writer store lock. Fails loud on timeout.
 */
export function withStoreLock<T>(
  memoryDir: string,
  fn: () => T,
  options: { timeoutMs?: number; pollIntervalMs?: number; staleAgeMs?: number } = {},
): T {
  const handle = acquireStoreLock(memoryDir, options);
  try {
    return fn();
  } finally {
    releaseStoreLock(handle);
  }
}

/**
 * T-044: Append a line to a JSONL file with guaranteed fsync durability.
 */
export function appendJsonlWithFsync(filePath: string, line: string): void {
  const fd = openSync(filePath, "a");
  try {
    writeSync(fd, line.endsWith("\n") ? line : line + "\n", undefined, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
