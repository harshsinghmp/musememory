import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type GraphProviderType = "codegraph" | "none";

export interface GraphStatus {
  provider: GraphProviderType;
  available: boolean;
  root: string;
  graphRevision?: string;
  symbolCount?: number;
}

/**
 * Detect available graph provider in the project root.
 * Defaults to "none" if no supported provider index is detected.
 */
export function detectProvider(projectRoot: string): GraphProviderType {
  if (!projectRoot || !existsSync(projectRoot)) return "none";
  if (existsSync(join(projectRoot, ".codegraph"))) {
    return "codegraph";
  }
  return "none";
}

export const detectGraphProvider = detectProvider;

/**
 * Check provider status and availability.
 */
export function getGraphStatus(projectRoot: string): GraphStatus {
  const provider = detectProvider(projectRoot);
  if (provider === "codegraph") {
    const codegraphDir = join(projectRoot, ".codegraph");
    let symbolCount: number | undefined;
    let graphRevision: string | undefined;

    try {
      if (existsSync(codegraphDir)) {
        const files = readdirSync(codegraphDir);
        symbolCount = files.length;
        const metaPath = join(codegraphDir, "meta.json");
        if (existsSync(metaPath)) {
          const meta = JSON.parse(readFileSync(metaPath, "utf8"));
          graphRevision = meta.revision ?? meta.commit ?? meta.version;
        }
      }
    } catch {
      // Non-fatal, graceful fallback
    }

    return {
      provider: "codegraph",
      available: true,
      root: codegraphDir,
      graphRevision,
      symbolCount,
    };
  }

  return {
    provider: "none",
    available: false,
    root: projectRoot,
  };
}


