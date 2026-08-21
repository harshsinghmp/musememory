import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function currentFilePath(memoryDir: string): string {
  return join(memoryDir, "CURRENT.md");
}

export function getCurrent(memoryDir: string): string[] {
  const p = currentFilePath(memoryDir);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function setCurrent(memoryDir: string, text: string, project: string): string[] {
  const p = currentFilePath(memoryDir);
  const existing = getCurrent(memoryDir);
  const now = new Date().toISOString();
  const newLine = `[${now}] (${project}) ${text}`;
  const updated = [...existing, newLine];
  writeFileSync(p, updated.join("\n") + "\n", "utf8");
  return updated;
}
