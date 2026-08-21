import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { MigratedRecord, ProviderAdapter } from "../types.ts";
import { normalizeMemoryType } from "../types.ts";
import type { MemoryStatus } from "../../types.ts";

export const EverOsAdapter: ProviderAdapter = {
  id: "everos",
  extract(sourcePath: string, options: { defaultProject?: string } = {}): MigratedRecord[] {
    const results: MigratedRecord[] = [];
    if (!existsSync(sourcePath)) return results;

    const parseMdFile = (filePath: string, filename: string) => {
      try {
        const raw = readFileSync(filePath, "utf8");
        // Check for YAML frontmatter
        const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        let title = filename.replace(/\.md$/, "").replace(/[-_]/g, " ");
        let content = raw;
        let status: MemoryStatus = "confirmed";
        let rawType: string | undefined = undefined;
        let tags: string[] = ["everos"];
        let project = options.defaultProject || "default";

        if (match) {
          const frontmatter = yaml.load(match[1]) as any;
          content = match[2].trim();
          if (frontmatter) {
            if (frontmatter.title) title = frontmatter.title;
            if (frontmatter.status === "archived" || frontmatter.status === "deprecated") {
              status = "superseded";
            }
            if (frontmatter.type) {
              rawType = String(frontmatter.type);
            }
            if (Array.isArray(frontmatter.tags)) {
              tags = frontmatter.tags.map(String);
            }
            if (frontmatter.project) {
              project = frontmatter.project;
            }
          }
        }

        if (content) {
          results.push({
            title,
            content,
            project,
            status,
            type: normalizeMemoryType(rawType),
            tags,
            source: `migrated:everos:${filename}`,
          });
        }
      } catch {
        // Ignore file read/parse errors
      }
    };

    if (statSync(sourcePath).isDirectory()) {
      try {
        const files = readdirSync(sourcePath);
        for (const file of files) {
          if (file.endsWith(".md") || file.endsWith(".markdown")) {
            parseMdFile(join(sourcePath, file), file);
          }
        }
      } catch {
        // Ignore
      }
    } else if (sourcePath.endsWith(".md") || sourcePath.endsWith(".markdown")) {
      parseMdFile(sourcePath, "memory.md");
    }

    return results;
  }
};
