import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MigratedRecord, ProviderAdapter } from "../types.ts";

export const LettaAdapter: ProviderAdapter = {
  id: "letta",
  extract(sourcePath: string, options: { defaultProject?: string } = {}): MigratedRecord[] {
    const results: MigratedRecord[] = [];
    if (!existsSync(sourcePath)) return results;

    const processJson = (raw: string, filename: string) => {
      try {
        const parsed = JSON.parse(raw);
        // Letta Core Memory blocks: human and persona
        if (parsed.memory || parsed.core_memory) {
          const core = parsed.memory || parsed.core_memory;
          if (core.human) {
            results.push({
              title: "Letta Core Memory: Human Profile",
              content: typeof core.human === "string" ? core.human : JSON.stringify(core.human),
              project: options.defaultProject || "default",
              status: "confirmed",
              type: "preference",
              tags: ["letta", "core-memory", "human"],
              source: `migrated:letta:${filename}`,
              isConstraint: true,
            });
          }
          if (core.persona) {
            results.push({
              title: "Letta Core Memory: Agent Persona",
              content: typeof core.persona === "string" ? core.persona : JSON.stringify(core.persona),
              project: options.defaultProject || "default",
              status: "confirmed",
              type: "architecture",
              tags: ["letta", "core-memory", "persona"],
              source: `migrated:letta:${filename}`,
              isConstraint: true,
            });
          }
        }

        // Archival passages
        const archival = parsed.archival_memory || parsed.passages || [];
        if (Array.isArray(archival)) {
          for (const item of archival) {
            const text = typeof item === "string" ? item : (item.text || item.content || "");
            if (text) {
              results.push({
                title: text.slice(0, 60).replace(/[\r\n]+/g, " "),
                content: text,
                project: options.defaultProject || "default",
                status: "confirmed",
                type: "discovery",
                tags: ["letta", "archival"],
                source: `migrated:letta:${filename}`,
              });
            }
          }
        }
      } catch {
        // Ignore
      }
    };

    if (statSync(sourcePath).isDirectory()) {
      try {
        const entries = readdirSync(sourcePath);
        for (const file of entries) {
          if (file.endsWith(".json")) {
            const raw = readFileSync(join(sourcePath, file), "utf8");
            processJson(raw, file);
          }
        }
      } catch {
        // Ignore
      }
    } else {
      processJson(readFileSync(sourcePath, "utf8"), "letta.json");
    }

    return results;
  }
};
