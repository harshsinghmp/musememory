import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MigratedRecord, ProviderAdapter } from "../types.ts";
import { normalizeMemoryType } from "../types.ts";
import type { MemoryStatus } from "../../types.ts";

export const BeadsAdapter: ProviderAdapter = {
  id: "beads",
  extract(sourcePath: string, options: { defaultProject?: string } = {}): MigratedRecord[] {
    const results: MigratedRecord[] = [];
    if (!existsSync(sourcePath)) return results;

    // Case 1: beads.json
    let jsonPath = sourcePath;
    if (statSync(sourcePath).isDirectory()) {
      const p = join(sourcePath, "beads.json");
      if (existsSync(p)) jsonPath = p;
    }

    if (existsSync(jsonPath) && !statSync(jsonPath).isDirectory()) {
      try {
        const raw = readFileSync(jsonPath, "utf8");
        const parsed = JSON.parse(raw);
        const beads = Array.isArray(parsed) ? parsed : (parsed.beads || Object.values(parsed));

        for (const b of beads as any[]) {
          if (!b || typeof b !== "object") continue;
          const content = b.description || b.content || b.title || "";
          if (!content) continue;

          const title = b.title || content.slice(0, 60);
          const rawStatus = (b.status || "open").toLowerCase();
          const isClosed = rawStatus === "closed" || rawStatus === "done" || rawStatus === "archived";
          const status: MemoryStatus = isClosed ? "superseded" : "confirmed";
          const isConstraint = !isClosed && (rawStatus === "in_progress" || b.priority === "high");
          const type = normalizeMemoryType(b.type || "operation");

          results.push({
            id: b.id ? `m_bead_${String(b.id).replace(/[^a-zA-Z0-9_-]/g, "_")}` : undefined,
            title,
            content,
            project: b.project || options.defaultProject || "default",
            status,
            type,
            tags: Array.isArray(b.tags) ? b.tags.map(String) : ["beads"],
            source: "migrated:beads",
            isConstraint,
            created_at: b.created_at || new Date().toISOString(),
            updated_at: b.updated_at || new Date().toISOString(),
          });
        }
      } catch {
        // Fallback to directory scan
      }
    }

    // Case 2: Markdown files in .beads/ directory
    if (statSync(sourcePath).isDirectory()) {
      try {
        const files = readdirSync(sourcePath);
        for (const file of files) {
          if (!file.endsWith(".md") && !file.endsWith(".markdown")) continue;
          const fullPath = join(sourcePath, file);
          const content = readFileSync(fullPath, "utf8");
          const title = file.replace(/\.md$/, "").replace(/[-_]/g, " ");

          results.push({
            title,
            content,
            project: options.defaultProject || "default",
            status: "confirmed",
            type: "discovery",
            tags: ["beads", "markdown"],
            source: `migrated:beads:${file}`,
          });
        }
      } catch {
        // Ignore read errors
      }
    }

    return results;
  }
};
