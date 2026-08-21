import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MigratedRecord, ProviderAdapter } from "../types.ts";
import { normalizeMemoryType } from "../types.ts";
import type { MemoryStatus } from "../../types.ts";

export const Mem0Adapter: ProviderAdapter = {
  id: "mem0",
  extract(sourcePath: string, options: { defaultProject?: string } = {}): MigratedRecord[] {
    const results: MigratedRecord[] = [];
    if (!existsSync(sourcePath)) return results;

    let jsonPath = sourcePath;
    if (statSync(sourcePath).isDirectory()) {
      const cand = join(sourcePath, "mem0.json");
      if (existsSync(cand)) jsonPath = cand;
    }

    if (existsSync(jsonPath) && !statSync(jsonPath).isDirectory()) {
      try {
        const raw = readFileSync(jsonPath, "utf8");
        const parsed = JSON.parse(raw);
        const mems = Array.isArray(parsed) ? parsed : (parsed.memories || parsed.results || Object.values(parsed));

        for (const m of mems as any[]) {
          if (!m || typeof m !== "object") continue;
          const content = m.memory || m.content || m.text || "";
          if (!content) continue;

          const title = m.title || content.slice(0, 60);
          const isDeleted = m.deleted === true || m.is_active === false;
          const status: MemoryStatus = isDeleted ? "superseded" : "confirmed";

          results.push({
            id: m.id ? `m_mem0_${String(m.id).replace(/[^a-zA-Z0-9_-]/g, "_")}` : undefined,
            title,
            content,
            project: m.project || m.agent_id || options.defaultProject || "default",
            status,
            type: normalizeMemoryType(m.type),
            tags: Array.isArray(m.tags) ? m.tags.map(String) : ["mem0"],
            source: "migrated:mem0",
            created_at: m.created_at || new Date().toISOString(),
            updated_at: m.updated_at || new Date().toISOString(),
          });
        }
      } catch {
        // Ignore JSON error
      }
    }

    return results;
  }
};
