import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { AGENT_REGISTRY } from "./registry.ts";
import type { DetectedAgent, AgentDefinition } from "./types.ts";

const BINARY_CACHE = new Map<string, string | null>();

/**
 * Check if binary exists in PATH or common global bin directories.
 */
export function findBinary(binName: string, home: string = homedir()): string | null {
  if (BINARY_CACHE.has(binName)) {
    return BINARY_CACHE.get(binName)!;
  }

  // Fast direct path checks
  const commonDirs = [
    join(home, ".local", "bin", binName),
    join(home, ".bun", "bin", binName),
    join(home, ".cargo", "bin", binName),
    join(home, ".nvm", "versions", "node", process.version, "bin", binName),
    `/usr/local/bin/${binName}`,
    `/usr/bin/${binName}`,
  ];

  for (const p of commonDirs) {
    if (existsSync(p)) {
      BINARY_CACHE.set(binName, p);
      return p;
    }
  }

  try {
    const stdout = execSync(`which ${binName} 2>/dev/null`, { encoding: "utf8", timeout: 200 }).trim();
    if (stdout && existsSync(stdout)) {
      BINARY_CACHE.set(binName, stdout);
      return stdout;
    }
  } catch {
    // Ignore which failures
  }

  BINARY_CACHE.set(binName, null);
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
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, ".config");
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
