import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { AGENT_REGISTRY } from "./registry.ts";
import type { DetectedAgent, AgentDefinition } from "./types.ts";

const BINARY_CACHE = new Map<string, string | null>();

/**
 * Clear cached binary paths (useful for test isolation).
 */
export function clearBinaryCache(): void {
  BINARY_CACHE.clear();
}

/**
 * Fast, pure TypeScript check for binary existence in home bins, PATH, and system bins.
 * Spawns 0 subshells.
 */
export function findBinary(binName: string, home: string = homedir()): string | null {
  const cacheKey = `${home}:${binName}`;
  if (BINARY_CACHE.has(cacheKey)) {
    return BINARY_CACHE.get(cacheKey)!;
  }

  // 1. Direct priority path checks for this home directory
  const candidateDirs = [
    join(home, ".local", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".cargo", "bin"),
    join(home, "bin"),
  ];

  // 2. Only check host system PATH when inspecting the active user's actual home directory
  if (home === homedir()) {
    candidateDirs.push(
      join(home, ".nvm", "versions", "node", process.version, "bin"),
      "/usr/local/bin",
      "/usr/bin",
      "/bin"
    );
    if (process.env.PATH) {
      const pathDirs = process.env.PATH.split(":");
      for (const d of pathDirs) {
        if (d && !candidateDirs.includes(d)) {
          candidateDirs.push(d);
        }
      }
    }
  }

  for (const dir of candidateDirs) {
    const fullPath = join(dir, binName);
    if (existsSync(fullPath)) {
      try {
        if (statSync(fullPath).isFile()) {
          BINARY_CACHE.set(cacheKey, fullPath);
          return fullPath;
        }
      } catch {}
    }
  }

  BINARY_CACHE.set(cacheKey, null);
  return null;
}

/**
 * Check if memory is already wired to this agent's config file.
 */
function isAgentConnected(agent: AgentDefinition, resolvedConfigPath: string | null): boolean {
  if (!resolvedConfigPath || !existsSync(resolvedConfigPath)) return false;
  try {
    const content = readFileSync(resolvedConfigPath, "utf8");
    return content.includes('"memory"') || content.includes("'memory'") || content.includes("command: memory") || content.includes('"command": "memory"');
  } catch {
    return false;
  }
}

/**
 * Detect all installed and configured coding agents on the user's workstation.
 */
export function detectAgents(home: string = homedir()): DetectedAgent[] {
  const xdgConfig = (home === homedir() && process.env.XDG_CONFIG_HOME)
    ? process.env.XDG_CONFIG_HOME
    : join(home, ".config");
  const results: DetectedAgent[] = [];

  for (const def of AGENT_REGISTRY) {
    let foundBinary: string | null = null;
    for (const bin of def.binaries) {
      const p = findBinary(bin, home);
      if (p) {
        foundBinary = p;
        break;
      }
    }

    let foundConfig: string | null = null;
    for (const cPath of def.configPaths) {
      const fullPath = cPath.startsWith(".config/")
        ? join(xdgConfig, cPath.replace(".config/", ""))
        : join(home, cPath);

      if (existsSync(fullPath)) {
        foundConfig = fullPath;
        break;
      }
    }

    const installed = Boolean(foundBinary || foundConfig);
    const connected = installed && isAgentConnected(def, foundConfig);

    results.push({
      id: def.id,
      name: def.name,
      category: def.category,
      stars: def.stars,
      installed,
      binaryPath: foundBinary ?? undefined,
      configPath: foundConfig ?? undefined,
      connected,
      description: def.description,
    });
  }

  return results;
}
