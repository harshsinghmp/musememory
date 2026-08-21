import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MigratedRecord, ProviderAdapter } from "../types.ts";

export const ByteRoverAdapter: ProviderAdapter = {
  id: "byterover",
  extract(sourcePath: string, options: { defaultProject?: string } = {}): MigratedRecord[] {
    const results: MigratedRecord[] = [];
    if (!existsSync(sourcePath)) return results;

    const walk = (dir: string, domain: string = "") => {
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const full = join(dir, entry);
          const stat = statSync(full);
          if (stat.isDirectory()) {
            walk(full, domain ? `${domain}/${entry}` : entry);
          } else if (entry.endsWith(".md") || entry.endsWith(".json")) {
            const content = readFileSync(full, "utf8").trim();
            if (!content) continue;
            const title = entry.replace(/\.(md|json)$/, "").replace(/[-_]/g, " ");
            results.push({
              title,
              content,
              project: options.defaultProject || "default",
              status: "confirmed",
              type: "architecture",
              tags: domain ? ["byterover", ...domain.split("/")] : ["byterover"],
              source: `migrated:byterover:${domain}/${entry}`,
            });
          }
        }
      } catch {
        // Ignore errors
      }
    };

    if (statSync(sourcePath).isDirectory()) {
      walk(sourcePath);
    } else {
      const content = readFileSync(sourcePath, "utf8");
      results.push({
        title: "ByteRover Context Tree",
        content,
        project: options.defaultProject || "default",
        status: "confirmed",
        type: "architecture",
        tags: ["byterover"],
        source: "migrated:byterover",
      });
    }

    return results;
  }
};
