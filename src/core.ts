import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { scanSecrets } from "./secrets.ts";

/** Letta/MemGPT-style permanent operating guideline tiers stored in CORE.md. */
export const CORE_TIERS = ["identity", "directives", "conventions", "context"] as const;
export type CoreTier = (typeof CORE_TIERS)[number];

export function coreFilePath(memoryDir: string): string {
  return join(memoryDir, "CORE.md");
}

function isCoreTier(val: string): val is CoreTier {
  return (CORE_TIERS as readonly string[]).includes(val);
}

/**
 * Parse CORE.md into per-tier line arrays. Unrecognized content is ignored so
 * hand-edited files never crash reads.
 */
export function readCore(memoryDir: string): Record<CoreTier, string[]> {
  const result: Record<CoreTier, string[]> = { identity: [], directives: [], conventions: [], context: [] };
  const p = coreFilePath(memoryDir);
  if (!existsSync(p)) return result;
  let current: CoreTier | null = null;
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    const header = line.match(/^##\s+(.+)$/);
    if (header && isCoreTier(header[1].trim())) {
      current = header[1].trim() as CoreTier;
      continue;
    }
    if (current && line) result[current].push(line);
  }
  return result;
}

function writeCore(memoryDir: string, tiers: Record<CoreTier, string[]>): void {
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
  const blocks = CORE_TIERS.map((tier) => [`## ${tier}`, ...tiers[tier]].join("\n"));
  writeFileSync(coreFilePath(memoryDir), `# CORE MEMORY\n\n${blocks.join("\n\n")}\n`, "utf8");
}

/** Replace a tier's content in place with the given text. Throws on detected secrets. */
export function setCore(memoryDir: string, tier: CoreTier, text: string): Record<CoreTier, string[]> {
  const secrets = scanSecrets(text);
  if (secrets.length > 0) {
    throw new Error(`Secret detected in CORE.md: ${secrets.join(", ")}`);
  }
  const tiers = readCore(memoryDir);
  tiers[tier] = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  writeCore(memoryDir, tiers);
  return tiers;
}

/** Clear a tier's content in place. */
export function removeCore(memoryDir: string, tier: CoreTier): Record<CoreTier, string[]> {
  const tiers = readCore(memoryDir);
  tiers[tier] = [];
  writeCore(memoryDir, tiers);
  return tiers;
}

/** Render all non-empty tiers as a Markdown block for prompt injection; null when CORE.md absent/empty. */
export function formatCoreBlock(memoryDir?: string): string | null {
  if (!memoryDir) return null;
  const tiers = readCore(memoryDir);
  const parts: string[] = [];
  for (const tier of CORE_TIERS) {
    if (tiers[tier].length > 0) {
      parts.push(`**${tier}**`);
      for (const line of tiers[tier]) parts.push(`- ${line}`);
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}
