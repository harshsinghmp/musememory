import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireRoot, usageError } from "./shared.ts";
import type { ParsedArgs } from "./shared.ts";
import { resolveProjectIdentity } from "../retrieval/code_context.ts";

export async function handleProjectCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const name = positional[0];
  if (!name) {
    const identity = resolveProjectIdentity(ctx.store);
    console.log(`${identity.project} (${identity.source})`);
    return 0;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return usageError("project name must match [A-Za-z0-9._-]+");
  const configPath = join(ctx.memoryDir, "config.json");
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    } catch {
      return usageError(`cannot parse ${configPath}`);
    }
  }
  config.project = name;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  console.log(`project set to ${name}`);
  return 0;
}
