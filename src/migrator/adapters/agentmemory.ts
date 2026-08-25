import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MigratedRecord, ProviderAdapter } from "../types.ts";
import { normalizeMemoryType } from "../types.ts";
import type { MemoryStatus } from "../../types.ts";

export const AgentMemoryAdapter: ProviderAdapter = {
  id: "agentmemory",
  extract(sourcePath: string, options: { defaultProject?: string } = {}): MigratedRecord[] {
    const results: MigratedRecord[] = [];

    // Check if target is directory or file
    let jsonPath = sourcePath;
    if (existsSync(sourcePath) && statSync(sourcePath).isDirectory()) {
      const candidates = [
        join(sourcePath, "standalone.json"),
        join(sourcePath, "engine-state.json"),
      ];
      for (const cand of candidates) {
        if (existsSync(cand)) {
          jsonPath = cand;
          break;
        }
      }
    }

    if (!existsSync(jsonPath) || statSync(jsonPath).isDirectory()) {
      return results;
    }

    try {
      const raw = readFileSync(jsonPath, "utf8");
      const parsed = JSON.parse(raw);
      const memObj = parsed["mem:memories"] || parsed["memories"] || parsed;

      const items = Array.isArray(memObj) ? memObj : Object.values(memObj);

      for (const item of items as any[]) {
        if (!item || typeof item !== "object") continue;
        const content = item.content || item.text || item.description || "";
        if (!content || typeof content !== "string") continue;

        const title = item.title || content.slice(0, 60).replace(/[\r\n]+/g, " ");
        const isLatest = item.isLatest !== false && item.archived !== true;
        const status: MemoryStatus = isLatest ? "confirmed" : "superseded";
        const type = normalizeMemoryType(item.type);

        const tags = Array.isArray(item.concepts) ? item.concepts : (Array.isArray(item.tags) ? item.tags : []);

        results.push({
          id: item.id ? `m_${String(item.id).replace(/[^a-zA-Z0-9_-]/g, "_")}` : undefined,
          title,
          content,
          project: item.project || options.defaultProject || "default",
          status,
          type,
          tags: tags.map(String),
          source: "migrated:agentmemory",
          verification: {
            level: "independently-verified",
            verified_by: "migrator:agentmemory"
          },
        });
      }
    } catch {
      // Ignore parse failure
    }

    return results;
  }
};
