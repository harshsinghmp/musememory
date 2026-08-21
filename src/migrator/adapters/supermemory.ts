import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MigratedRecord, ProviderAdapter } from "../types.ts";

export const SupermemoryAdapter: ProviderAdapter = {
  id: "supermemory",
  extract(sourcePath: string, options: { defaultProject?: string } = {}): MigratedRecord[] {
    const results: MigratedRecord[] = [];
    if (!existsSync(sourcePath)) return results;

    const parseJsonContent = (raw: string, label: string) => {
      try {
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : (parsed.memories || parsed.documents || Object.values(parsed));
        for (const item of list as any[]) {
          if (!item || typeof item !== "object") continue;
          const content = item.content || item.text || item.summary || "";
          if (!content) continue;
          const title = item.title || content.slice(0, 60);
          const isArchived = item.is_archived === true || item.archived === true;

          results.push({
            id: item.id ? `m_sm_${String(item.id).replace(/[^a-zA-Z0-9_-]/g, "_")}` : undefined,
            title,
            content,
            project: item.project || options.defaultProject || "default",
            status: isArchived ? "superseded" : "confirmed",
            type: "discovery",
            tags: Array.isArray(item.tags) ? item.tags.map(String) : ["supermemory"],
            source: `migrated:supermemory:${label}`,
            created_at: item.created_at || new Date().toISOString(),
            updated_at: item.updated_at || new Date().toISOString(),
          });
        }
      } catch {
        // Line-by-line log / jsonl fallback
        const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (line.includes("Plugin init:") || line.includes("Model limits")) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.content || obj.text) {
              results.push({
                title: (obj.title || obj.content || obj.text).slice(0, 60),
                content: obj.content || obj.text,
                project: options.defaultProject || "default",
                status: "confirmed",
                type: "discovery",
                tags: ["supermemory"],
                source: `migrated:supermemory:${label}`,
              });
            }
          } catch {
            // Skip non-json log lines
          }
        }
      }
    };

    if (statSync(sourcePath).isDirectory()) {
      try {
        const files = readdirSync(sourcePath);
        for (const file of files) {
          if (file.endsWith(".json") || file.endsWith(".jsonl") || file.endsWith(".log")) {
            parseJsonContent(readFileSync(join(sourcePath, file), "utf8"), file);
          }
        }
      } catch {
        // Ignore
      }
    } else {
      parseJsonContent(readFileSync(sourcePath, "utf8"), "log");
    }

    return results;
  }
};
