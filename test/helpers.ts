import { mkdtempSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "memory-test-"));
}

/** Temp root with fixture corpus copied into .memory/memories/. */
export function setupFixtureRoot(): { root: string; memoryDir: string } {
  const root = makeTempRoot();
  const memoryDir = join(root, ".memory");
  mkdirSync(join(memoryDir, "memories"), { recursive: true });
  cpSync(join(import.meta.dir, "fixtures"), join(memoryDir, "memories"), { recursive: true });
  return { root, memoryDir };
}

export function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}