import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acquireStoreLock,
  releaseStoreLock,
  withStoreLock,
  StoreLockError,
  appendJsonlWithFsync,
} from "../src/lock.ts";
import { recordAuditEvent, getAuditTrail } from "../src/audit.ts";

describe("T-044: single-writer flock and fsync JSONL event log", () => {
  test("acquires and releases store lock cleanly", () => {
    const dir = mkdtempSync(join(tmpdir(), "lock-test-"));
    const handle = acquireStoreLock(dir, { timeoutMs: 500 });
    expect(existsSync(handle.lockPath)).toBe(true);

    releaseStoreLock(handle);
    expect(existsSync(handle.lockPath)).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  test("fails loud with StoreLockError when lock is held beyond timeout", () => {
    const dir = mkdtempSync(join(tmpdir(), "lock-timeout-"));
    const handle = acquireStoreLock(dir, { timeoutMs: 1000 });

    let threw = false;
    try {
      // Second attempt on the same directory should fail loud
      acquireStoreLock(dir, { timeoutMs: 100, pollIntervalMs: 10 });
    } catch (err: any) {
      threw = true;
      expect(err).toBeInstanceOf(StoreLockError);
      expect(err.message).toContain("Failed to acquire store lock");
      expect(err.holderPid).toBe(process.pid);
    }

    expect(threw).toBe(true);
    releaseStoreLock(handle);
    rmSync(dir, { recursive: true, force: true });
  });

  test("withStoreLock executes work and guarantees lock release on error", () => {
    const dir = mkdtempSync(join(tmpdir(), "with-lock-test-"));
    const lockPath = join(dir, ".lock");

    expect(() => {
      withStoreLock(dir, () => {
        expect(existsSync(lockPath)).toBe(true);
        throw new Error("Deliberate failure inside critical section");
      });
    }).toThrow("Deliberate failure");

    // Lock must be released even after thrown error
    expect(existsSync(lockPath)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  test("recovers stale lock from dead PID", () => {
    const dir = mkdtempSync(join(tmpdir(), "stale-pid-test-"));
    const lockPath = join(dir, ".lock");

    // Write a lock claiming to belong to dead PID (e.g. 999999)
    const deadInfo = {
      pid: 9999999,
      hostname: "localhost",
      timestamp: new Date().toISOString(),
      nonce: "dead-nonce-123",
    };
    Bun.write(lockPath, JSON.stringify(deadInfo));

    // Acquire should detect PID 9999999 is dead, break lock, and succeed
    const handle = acquireStoreLock(dir, { timeoutMs: 500 });
    expect(handle).toBeDefined();
    expect(handle.info.pid).toBe(process.pid);

    releaseStoreLock(handle);
    rmSync(dir, { recursive: true, force: true });
  });

  test("appendJsonlWithFsync and recordAuditEvent write durably with fsync", () => {
    const dir = mkdtempSync(join(tmpdir(), "fsync-jsonl-"));
    const file = join(dir, "events.jsonl");

    appendJsonlWithFsync(file, JSON.stringify({ event: 1, name: "write" }));
    appendJsonlWithFsync(file, JSON.stringify({ event: 2, name: "verify" }));

    const content = readFileSync(file, "utf8").trim().split("\n");
    expect(content.length).toBe(2);
    expect(JSON.parse(content[0]).name).toBe("write");
    expect(JSON.parse(content[1]).name).toBe("verify");

    // Test recordAuditEvent
    recordAuditEvent(dir, {
      operation: "propose",
      entry_id: "m_test",
      actor: "test_runner",
      details: { fsync_verified: true },
    });

    const trail = getAuditTrail(dir);
    expect(trail.length).toBe(1);
    expect(trail[0].entry_id).toBe("m_test");

    rmSync(dir, { recursive: true, force: true });
  });
});
