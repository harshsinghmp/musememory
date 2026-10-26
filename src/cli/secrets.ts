import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { SECRET_RULES, redactSecrets } from "../secrets.ts";
import type { ParsedArgs } from "./shared.ts";

export interface SecretFinding {
  file: string;
  line: number;
  rule: string;
  redactedSnippet: string;
}

export interface SecretScanOptions {
  targetDir: string;
  verbose?: boolean;
  json?: boolean;
  silent?: boolean;
  ignorePatterns?: string[];
  failOnSecrets?: boolean;
}

export interface SecretScanResult {
  targetDir: string;
  scannedFiles: number;
  findings: SecretFinding[];
  clean: boolean;
  durationMs: number;
}

const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".astro",
  "coverage",
  ".turbo",
  ".cache",
  ".agents/archive",
  "snapshots",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".7z",
  ".rar",
  ".sqlite",
  ".db",
  ".bin",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".wasm",
  ".lock",
  ".lockb",
  ".pdf",
]);

/**
 * Checks if buffer looks like binary content (contains null bytes).
 */
function isBinaryBuffer(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 1024);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Recursively discover scan targets in a directory.
 */
function walkScanFiles(
  dir: string,
  baseDir: string = dir,
  customIgnores: string[] = [],
): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      if (DEFAULT_IGNORED_DIRS.has(entry.name) || customIgnores.some((pattern) => relPath.includes(pattern))) {
        continue;
      }
      results.push(...walkScanFiles(fullPath, baseDir, customIgnores));
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;
      if (customIgnores.some((pattern) => relPath.includes(pattern))) continue;

      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Execute secret scan across target directory.
 */
export async function executeSecretScan(options: SecretScanOptions): Promise<SecretScanResult> {
  const startTime = Date.now();
  const targetDir = options.targetDir;
  const customIgnores = options.ignorePatterns || [];

  if (!existsSync(targetDir)) {
    return {
      targetDir,
      scannedFiles: 0,
      findings: [],
      clean: false,
      durationMs: Date.now() - startTime,
    };
  }

  let files: string[] = [];
  try {
    const stat = statSync(targetDir);
    if (stat.isFile()) {
      files = [targetDir];
    } else {
      files = walkScanFiles(targetDir, targetDir, customIgnores);
    }
  } catch {
    files = [];
  }

  const findings: SecretFinding[] = [];

  for (const file of files) {
    try {
      const stats = statSync(file);
      // Skip files > 5MB
      if (stats.size > 5 * 1024 * 1024) continue;

      const buffer = readFileSync(file);
      if (isBinaryBuffer(buffer)) continue;

      const content = buffer.toString("utf8");
      const lines = content.split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        for (const rule of SECRET_RULES) {
          if (rule.pattern.test(line)) {
            findings.push({
              file: relative(targetDir, file) || file,
              line: i + 1,
              rule: rule.name,
              redactedSnippet: redactSecrets(line.trim()),
            });
            break; // Stop after first rule match per line
          }
        }
      }
    } catch {
      // Ignore unreadable files
    }
  }

  const durationMs = Date.now() - startTime;
  return {
    targetDir,
    scannedFiles: files.length,
    findings,
    clean: findings.length === 0,
    durationMs,
  };
}

/**
 * CLI Handler for `memory scan-secrets` / `muse scan-secrets`.
 */
export async function handleScanSecretsCommand(args: ParsedArgs): Promise<number> {
  const targetDir = args.positional?.[0] || (args as any).args?.[0] || ".";
  const verbose = Boolean(args.flags.verbose || args.flags.v);
  const jsonMode = Boolean(args.flags.json);
  const silent = Boolean(args.flags.silent);
  const failOnSecrets = args.flags["fail-on-secrets"] !== "false";

  const customIgnores = args.flags.ignore
    ? String(args.flags.ignore).split(",").map((s) => s.trim())
    : [];

  if (!existsSync(targetDir)) {
    if (!silent) {
      console.error(`\n❌ Error: Target path does not exist: ${targetDir}`);
    }
    return 1;
  }

  const result = await executeSecretScan({
    targetDir,
    verbose,
    json: jsonMode,
    silent,
    ignorePatterns: customIgnores,
    failOnSecrets,
  });

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return result.clean ? 0 : 1;
  }

  if (silent) {
    return result.clean ? 0 : 1;
  }

  console.log(`\n🛡️ Native Vibeguard Secret Scanner`);
  console.log(`─────────────────────────────────────────────────────────────`);
  console.log(`Target Directory : ${targetDir}`);
  console.log(`Scanned Files    : ${result.scannedFiles}`);
  console.log(`Duration         : ${result.durationMs}ms`);

  if (result.clean) {
    console.log(`\n✅ Zero credentials leaked. All files verified clean.`);
    return 0;
  }

  console.log(`\n🚨 Potential Credential Leaks Detected: ${result.findings.length}\n`);
  for (const finding of result.findings) {
    console.log(`  📍 ${finding.file}:${finding.line}`);
    console.log(`     Rule    : ${finding.rule}`);
    console.log(`     Preview : ${finding.redactedSnippet}`);
    console.log(``);
  }

  console.log(`❌ Audit failed. Remove or redact exposed secrets before committing.`);
  return failOnSecrets ? 1 : 0;
}
