import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import yaml from "js-yaml";
import type { MigratedRecord, ProviderAdapter } from "../types.ts";
import { normalizeMemoryType } from "../types.ts";

export const GenericAdapter: ProviderAdapter = {
  id: "generic",
  extract(sourcePath: string, options: { defaultProject?: string } = {}): MigratedRecord[] {
    const results: MigratedRecord[] = [];
    if (!existsSync(sourcePath)) return results;

    const IGNORED_FILENAMES = new Set([
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "bun.lockb",
      "yarn.lock",
      "pnpm-lock.yaml",
      ".gitignore",
      ".npmrc",
      ".editorconfig",
    ]);

    const processFile = (filePath: string, filename: string) => {
      const lower = filename.toLowerCase();
      if (IGNORED_FILENAMES.has(lower) || lower.startsWith("license")) {
        return;
      }

      try {
        const raw = readFileSync(filePath, "utf8");

        // Try JSON
        if (filename.endsWith(".json") || filename.endsWith(".jsonl")) {
          try {
            const parsed = JSON.parse(raw);
            let list: any[] = [];
            if (Array.isArray(parsed)) {
              list = parsed;
            } else if (parsed && typeof parsed === "object") {
              if (Array.isArray(parsed.memories)) list = parsed.memories;
              else if (Array.isArray(parsed.entries)) list = parsed.entries;
              else if (Array.isArray(parsed.checkpoints)) list = parsed.checkpoints;
              else if (Array.isArray(parsed.loops)) list = parsed.loops;
              else if (Array.isArray(parsed.notes)) list = parsed.notes;
              else if (Array.isArray(parsed.records)) list = parsed.records;
              else if (parsed.content || parsed.text || parsed.description) {
                list = [parsed];
              }
            }

            for (const item of list) {
              if (!item) continue;
              if (typeof item === "string") {
                const trimmed = item.trim();
                if (trimmed.length < 20) continue;
                results.push({
                  title: trimmed.slice(0, 60).replace(/[\r\n]+/g, " "),
                  content: trimmed,
                  project: options.defaultProject || "default",
                  status: "candidate",
                  type: "discovery",
                  tags: ["imported"],
                  source: `migrated:${filename}`,
                });
              } else if (typeof item === "object") {
                const content = (item.content || item.description || item.text || item.summary || item.instruction || "").trim();
                if (!content || content.length < 5) continue;
                const isArchived = item.status === "archived" || item.status === "superseded" || item.status === "closed" || item.is_active === false;
                const isConstraint = item.isConstraint === true || item.type === "rule" || item.type === "constraint" || item.open_loop === true;

                results.push({
                  id: item.id ? `m_${String(item.id).replace(/[^a-zA-Z0-9_-]/g, "_")}` : undefined,
                  title: item.title || content.slice(0, 60).replace(/[\r\n]+/g, " "),
                  content,
                  project: item.project || options.defaultProject || "default",
                  status: isArchived ? "superseded" : "candidate",
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
            const content = (doc.content || doc.description || (typeof doc === "string" ? doc : "")).trim();
            if (!content || content.length < 5) return;
            const isArchived = doc.status === "archived" || doc.status === "superseded" || doc.status === "stale";
            results.push({
              title: doc.title || filename.replace(/\.(yaml|yml)$/, ""),
              content,
              project: doc.project || options.defaultProject || "default",
              status: isArchived ? (doc.status === "stale" ? "stale" : "superseded") : "candidate",
              type: normalizeMemoryType(doc.type),
              tags: Array.isArray(doc.tags) ? doc.tags : ["yaml-imported"],
              source: `migrated:${filename}`,
            });
            return;
          }
        }

        if (filename.endsWith(".md") || filename.endsWith(".markdown") || filename.endsWith(".txt")) {
          const trimmed = raw.trim();
          if (trimmed.length >= 20) {
            const capped = trimmed.length > 10000 ? trimmed.slice(0, 10000) + "\n\n[TRUNCATED_DOC_MIGRATION]" : trimmed;
            results.push({
              title: filename.replace(/\.(md|markdown|txt)$/, "").replace(/[-_]/g, " "),
              content: capped,
              project: options.defaultProject || "default",
              status: "candidate",
              type: "discovery",
              tags: ["doc-imported"],
              source: `migrated:${filename}`,
            });
          }
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
      processFile(sourcePath, basename(sourcePath));
    }

    return results;
  }
};
