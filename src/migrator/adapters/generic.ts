import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { MigratedRecord, ProviderAdapter } from "../types.ts";
import { normalizeMemoryType } from "../types.ts";

export const GenericAdapter: ProviderAdapter = {
  id: "generic",
  extract(sourcePath: string, options: { defaultProject?: string } = {}): MigratedRecord[] {
    const results: MigratedRecord[] = [];
    if (!existsSync(sourcePath)) return results;

    const processFile = (filePath: string, filename: string) => {
      try {
        const raw = readFileSync(filePath, "utf8");

        // Try JSON
        if (filename.endsWith(".json") || filename.endsWith(".jsonl")) {
          try {
            const parsed = JSON.parse(raw);
            const list = Array.isArray(parsed) ? parsed : (parsed.memories || parsed.entries || parsed.checkpoints || parsed.loops || Object.values(parsed));
            for (const item of list as any[]) {
              if (!item) continue;
              if (typeof item === "string") {
                results.push({
                  title: item.slice(0, 60),
                  content: item,
                  project: options.defaultProject || "default",
                  status: "confirmed",
                  type: "discovery",
                  tags: ["imported"],
                  source: `migrated:${filename}`,
                });
              } else if (typeof item === "object") {
                const content = item.content || item.description || item.text || item.summary || item.instruction || "";
                if (!content) continue;
                const isArchived = item.status === "archived" || item.status === "superseded" || item.status === "closed" || item.is_active === false;
                const isConstraint = item.isConstraint === true || item.type === "rule" || item.type === "constraint" || item.open_loop === true;

                results.push({
                  id: item.id ? `m_${String(item.id).replace(/[^a-zA-Z0-9_-]/g, "_")}` : undefined,
                  title: item.title || content.slice(0, 60),
                  content,
                  project: item.project || options.defaultProject || "default",
                  status: isArchived ? "superseded" : "confirmed",
                  type: normalizeMemoryType(item.type),
                  tags: Array.isArray(item.tags) ? item.tags.map(String) : ["imported"],
                  source: `migrated:${filename}`,
                  isConstraint,
                });
              }
            }
            return;
          } catch {
            // Not valid JSON, continue to Markdown/YAML
          }
        }

        // Try YAML or Markdown
        if (filename.endsWith(".yaml") || filename.endsWith(".yml")) {
          const doc = yaml.load(raw) as any;
          if (doc && typeof doc === "object") {
            const content = doc.content || doc.description || raw;
            results.push({
              title: doc.title || filename.replace(/\.(yaml|yml)$/, ""),
              content,
              project: doc.project || options.defaultProject || "default",
              status: doc.status || "confirmed",
              type: normalizeMemoryType(doc.type),
              tags: Array.isArray(doc.tags) ? doc.tags : ["yaml-imported"],
              source: `migrated:${filename}`,
            });
            return;
          }
        }

        if (filename.endsWith(".md") || filename.endsWith(".markdown") || filename.endsWith(".txt")) {
          results.push({
            title: filename.replace(/\.(md|markdown|txt)$/, "").replace(/[-_]/g, " "),
            content: raw.trim(),
            project: options.defaultProject || "default",
            status: "confirmed",
            type: "discovery",
            tags: ["doc-imported"],
            source: `migrated:${filename}`,
          });
        }
      } catch {
        // Ignore read/parse errors
      }
    };

    if (statSync(sourcePath).isDirectory()) {
      try {
        const files = readdirSync(sourcePath);
        for (const file of files) {
          processFile(join(sourcePath, file), file);
        }
      } catch {
        // Ignore
      }
    } else {
      processFile(sourcePath, "source");
    }

    return results;
  }
};
