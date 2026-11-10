import { requireRoot } from "./shared.ts";
import type { ParsedArgs } from "./shared.ts";
import { collectIoReport } from "../io_stats.ts";

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export async function handleIoCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;

  const procPath = flags["proc"] || undefined;
  const report = collectIoReport(ctx.memoryDir, procPath);

  if (flags["json"] !== undefined) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  if (report.available) {
    console.log("Process I/O since start");
    for (const key of ["read_bytes", "write_bytes", "rchar", "wchar"]) {
      if (report.counters[key] !== undefined) {
        console.log(`  ${key.padEnd(12)} ${humanBytes(report.counters[key])}`);
      }
    }
  } else {
    console.log("Process I/O: unavailable (no readable /proc/self/io on this platform)");
  }

  console.log("Store disk usage");
  console.log(`  ${"memory.db".padEnd(16)} ${humanBytes(report.disk.memory_db_bytes)}`);
  console.log(`  ${"WAL/SHM".padEnd(16)} ${humanBytes(report.disk.wal_bytes)}`);
  console.log(`  ${"audit".padEnd(16)} ${humanBytes(report.disk.audit_bytes)}`);
  console.log(`  ${"observations".padEnd(16)} ${humanBytes(report.disk.observations_bytes)}`);
  console.log(`  ${"total".padEnd(16)} ${humanBytes(report.disk.total_bytes)}`);
  return 0;
}
