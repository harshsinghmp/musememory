import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { DEFAULT_SETTINGS } from "../settings/defaults.ts";
import type { GlobalSettings } from "../settings/types.ts";

export type ConfigHonestyStatus = "WIRED" | "DORMANT" | "UNREAD";

export interface ConfigUsageSite {
  file: string;
  line: number;
  snippet: string;
}

export interface ConfigAuditEntry {
  path: string;
  section: string;
  key: string;
  status: ConfigHonestyStatus;
  referencesCount: number;
  usageSites: ConfigUsageSite[];
}

export interface ConfigHonestyReport {
  totalKeys: number;
  wiredCount: number;
  dormantCount: number;
  unreadCount: number;
  honestyScore: number;
  entries: ConfigAuditEntry[];
  wiredKeys: string[];
  dormantKeys: string[];
  unreadKeys: string[];
  passed: boolean;
  errors?: string[];
}

export interface ConfigHonestyOptions {
  strict?: boolean;
  allowedDormant?: string[];
  allowedUnread?: string[];
  failOnUnread?: boolean;
  minHonestyScore?: number;
  excludePatterns?: RegExp[];
}

export class ConfigHonestyError extends Error {
  public report: ConfigHonestyReport;
  constructor(message: string, report: ConfigHonestyReport) {
    super(message);
    this.name = "ConfigHonestyError";
    this.report = report;
  }
}

/**
 * Collect all leaf settings paths from DEFAULT_SETTINGS.
 */
export function extractConfigPaths(settings: GlobalSettings = DEFAULT_SETTINGS): Array<{ section: string; key: string; path: string }> {
  const result: Array<{ section: string; key: string; path: string }> = [];

  for (const [sectionKey, sectionVal] of Object.entries(settings)) {
    if (sectionKey === "version") continue;
    if (typeof sectionVal === "object" && sectionVal !== null && !Array.isArray(sectionVal)) {
      for (const propKey of Object.keys(sectionVal)) {
        result.push({
          section: sectionKey,
          key: propKey,
          path: `${sectionKey}.${propKey}`,
        });
      }
    }
  }

  // Also include optional known settings from types
  const knownOptionals: Array<{ section: string; key: string }> = [
    { section: "retrieval", key: "embedderUrl" },
    { section: "retrieval", key: "embedderModel" },
    { section: "mcp", key: "bearerToken" },
    { section: "mcp", key: "bearerTokens" },
    { section: "mcp", key: "allowedPeers" },
    { section: "mcp", key: "allowedOrigins" },
    { section: "mcp", key: "allowedHosts" },
    { section: "pageindex", key: "reasoningModel" },
  ];

  for (const opt of knownOptionals) {
    if (!result.some((r) => r.path === `${opt.section}.${opt.key}`)) {
      result.push({
        section: opt.section,
        key: opt.key,
        path: `${opt.section}.${opt.key}`,
      });
    }
  }

  return result;
}

/**
 * Recursively find all TypeScript source files under root directory.
 */
function findSourceFiles(dir: string, excludePaths: Set<string>): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === ".memory") continue;
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...findSourceFiles(fullPath, excludePaths));
      } else if (stat.isFile() && (entry.endsWith(".ts") || entry.endsWith(".tsx"))) {
        if (!excludePaths.has(fullPath)) {
          files.push(fullPath);
        }
      }
    }
  } catch {}
  return files;
}

/**
 * T-129: Audit codebase for configuration honesty across WIRED, DORMANT, and UNREAD states.
 */
export function auditConfigHonesty(
  srcDir: string = join(process.cwd(), "src"),
  options: ConfigHonestyOptions = {}
): ConfigHonestyReport {
  const configKeys = extractConfigPaths();
  const allowedDormantSet = new Set(options.allowedDormant ?? []);
  const allowedUnreadSet = new Set(options.allowedUnread ?? []);

  // Exclude settings definition files from consumer usage scanning
  const defFiles = new Set([
    join(srcDir, "settings", "defaults.ts"),
    join(srcDir, "settings", "types.ts"),
    join(srcDir, "settings", "schema.ts"),
    join(srcDir, "settings", "index.ts"),
  ]);

  const sourceFiles = findSourceFiles(srcDir, defFiles);
  const fileContents = sourceFiles.map((file) => ({
    file,
    relPath: relative(process.cwd(), file),
    content: readFileSync(file, "utf8"),
    lines: readFileSync(file, "utf8").split("\n"),
  }));

  const entries: ConfigAuditEntry[] = [];
  const wiredKeys: string[] = [];
  const dormantKeys: string[] = [];
  const unreadKeys: string[] = [];
  const errors: string[] = [];

  for (const { section, key, path } of configKeys) {
    const usageSites: ConfigUsageSite[] = [];

    // Regex to match access like settings.section.key, settings.key, or .key in context of section
    const exactPropRegex = new RegExp(`(?:\\.${key}\\b|\\[["']${key}["']\\])`, "g");
    const sectionRegex = new RegExp(`\\b${section}\\b`);

    for (const { relPath, lines, content } of fileContents) {
      // Check if file mentions either the key or section
      if (!content.includes(key)) continue;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (exactPropRegex.test(line)) {
          // Verify if line or nearby context relates to this section or settings
          const hasSectionContext = sectionRegex.test(line) || /settings|config/i.test(line);
          const isUIFile = relPath.includes("ui.ts") || relPath.includes("/ui/");

          if (hasSectionContext || (section === "ui" && isUIFile) || !["enabled", "type", "theme", "status"].includes(key)) {
            usageSites.push({
              file: relPath,
              line: i + 1,
              snippet: line.trim().slice(0, 100),
            });
          }
        }
        exactPropRegex.lastIndex = 0;
      }
    }

    const refCount = usageSites.length;
    let status: ConfigHonestyStatus;

    if (refCount >= 1) {
      status = "WIRED";
      wiredKeys.push(path);
    } else if (allowedDormantSet.has(path) || path.startsWith("ui.")) {
      status = "DORMANT";
      dormantKeys.push(path);
    } else {
      status = "UNREAD";
      unreadKeys.push(path);
    }

    entries.push({
      path,
      section,
      key,
      status,
      referencesCount: refCount,
      usageSites,
    });
  }

  const totalKeys = configKeys.length;
  const wiredCount = wiredKeys.length;
  const dormantCount = dormantKeys.length;
  const unreadCount = unreadKeys.length;
  const honestyScore = totalKeys > 0 ? parseFloat((wiredCount / totalKeys).toFixed(3)) : 1.0;

  let passed = true;

  if (options.strict) {
    const unallowedUnread = unreadKeys.filter((k) => !allowedUnreadSet.has(k));
    if (unallowedUnread.length > 0) {
      passed = false;
      errors.push(`Config honesty audit failed in strict mode: ${unallowedUnread.length} unread key(s) detected: ${unallowedUnread.join(", ")}`);
    }
  }

  if (options.failOnUnread && unreadCount > 0) {
    passed = false;
    errors.push(`Config honesty audit detected ${unreadCount} unread config key(s): ${unreadKeys.join(", ")}`);
  }

  if (typeof options.minHonestyScore === "number" && honestyScore < options.minHonestyScore) {
    passed = false;
    errors.push(`Config honesty score ${honestyScore} is below minimum requirement of ${options.minHonestyScore}`);
  }

  return {
    totalKeys,
    wiredCount,
    dormantCount,
    unreadCount,
    honestyScore,
    entries,
    wiredKeys,
    dormantKeys,
    unreadKeys,
    passed,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Enforces config honesty and throws build-failing ConfigHonestyError if violations exist.
 */
export function enforceConfigHonesty(
  report: ConfigHonestyReport,
  options: ConfigHonestyOptions = {}
): void {
  if (!report.passed) {
    const message = report.errors?.join("\n") || `Config honesty check failed with honesty score ${report.honestyScore}`;
    throw new ConfigHonestyError(message, report);
  }
}
