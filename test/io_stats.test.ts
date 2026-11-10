import { describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectIoReport, parseProcIo, readProcIo, storeDiskUsage } from "../src/io_stats.ts";
import { recordAuditEvent } from "../src/audit.ts";

describe("R29: I/O budget telemetry", () => {
  test("parses /proc/self/io counters and ignores unknown lines", () => {
    const parsed = parseProcIo(
      ["rchar: 1234", "wchar: 5678", "syscr: 9", "syscw: 10", "read_bytes: 2048", "write_bytes: 4096", "junk line"].join("\n"),
    );
    expect(parsed.rchar).toBe(1234);
    expect(parsed.wchar).toBe(5678);
    expect(parsed.read_bytes).toBe(2048);
    expect(parsed.write_bytes).toBe(4096);
    expect(Object.keys(parsed)).toHaveLength(6);
  });

  test("reports unavailable when the proc file does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "muse-io-missing-"));
    try {
      expect(readProcIo(join(root, "nope"))).toBeNull();
      const report = collectIoReport(root, join(root, "nope"));
      expect(report.available).toBe(false);
      expect(report.counters).toEqual({});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("sums SQLite, WAL, audit and observation bytes for the store", () => {
    const root = mkdtempSync(join(tmpdir(), "muse-io-store-"));
    try {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "memory.db"), Buffer.alloc(100));
      writeFileSync(join(root, "memory.db-wal"), Buffer.alloc(50));
      writeFileSync(join(root, "observations.jsonl"), Buffer.alloc(25));
      recordAuditEvent(root, { operation: "propose", entry_id: "io-1" });

      const usage = storeDiskUsage(root);
      expect(usage.memory_db_bytes).toBe(100);
      expect(usage.wal_bytes).toBe(50);
      expect(usage.observations_bytes).toBe(25);
      expect(usage.audit_bytes).toBeGreaterThan(0);
      expect(usage.total_bytes).toBe(
        usage.memory_db_bytes + usage.wal_bytes + usage.audit_bytes + usage.observations_bytes,
      );

      const proc = join(root, "io");
      writeFileSync(proc, "read_bytes: 11\nwrite_bytes: 22\n");
      const report = collectIoReport(root, proc);
      expect(report.available).toBe(true);
      expect(report.counters.write_bytes).toBe(22);
      expect(report.disk.total_bytes).toBe(usage.total_bytes);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
