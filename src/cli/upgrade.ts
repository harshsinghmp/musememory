import { execSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getGlobalMemoryDir, resolveMemoryDir, findOrCreateProjectRoot } from "../root.ts";
import { initUserProfile, userFilePath } from "../user.ts";
import { connectAgent } from "../connect.ts";
import { indexGraph } from "../graph.ts";
import { installGitHook } from "../hook.ts";
import { scanSecrets } from "../secrets.ts";
import { type ParsedArgs, usageError } from "./shared.ts";

export interface UpgradeMilestone {
  stage: string;
  description: string;
  level: number;
}

export interface UpgradeStep {
  title: string;
  level: number;
  action: () => Promise<void> | void;
}

export interface RepairOptions {
  workspaceRoot?: string;
  memoryDir?: string;
  global?: boolean;
  skipAgentConnect?: boolean;
  dryRun?: boolean;
}

export interface RepairResult {
  repaired: boolean;
  actionsTaken: string[];
  agentsConnected: number;
  memoryDir: string;
  errors?: string[];
}

export interface PandaProgressOptions {
  panda?: string | string[];
  trailChar?: string;
  trackChar?: string;
  target?: string;
  frame?: number;
}

export interface PandaLoaderOptions {
  title?: string;
  width?: number;
  isTTY?: boolean;
  stream?: NodeJS.WritableStream;
  fps?: number;
  target?: string;
  panda?: string | string[];
  trailChar?: string;
  trackChar?: string;
  tickIntervalMs?: number;
}

export interface PandaLoaderResult {
  success: boolean;
  failedSteps: Array<{ step: UpgradeStep; error: any }>;
}

export const DEFAULT_PANDA_FRAMES = [
  "ʕ•ᴥ•ʔ",
  "ʕ •ᴥ•ʔ",
  "ʕ-ᴥ-ʔ",
  "ʕ•ᴥ•ʔﾉ",
];

/**
 * Formats a dynamic single-line ASCII progress bar featuring a panda moving towards 100%.
 */
export function formatPandaProgressBar(
  percent: number,
  width: number = 20,
  options: PandaProgressOptions = {},
): string {
  const p = Math.max(0, Math.min(100, percent));
  const trailChar = options.trailChar ?? "━";
  const trackChar = options.trackChar ?? "─";
  const target = options.target;
  const frame = options.frame ?? 0;

  let pandaChar = "ʕ•ᴥ•ʔ";
  if (Array.isArray(options.panda) && options.panda.length > 0) {
    pandaChar = options.panda[frame % options.panda.length];
  } else if (typeof options.panda === "string") {
    pandaChar = options.panda;
  }

  const pos = Math.round((p / 100) * width);
  const trail = trailChar.repeat(pos);

  let empty = "";
  if (target) {
    if (pos >= width) {
      empty = target;
    } else {
      const remaining = width - pos;
      empty = trackChar.repeat(remaining) + target;
    }
  } else {
    empty = trackChar.repeat(Math.max(0, width - pos));
  }

  return `[${trail}${pandaChar}${empty}] ${Math.round(p)}%`;
}

/**
 * Formats a clean gamified ASCII progress bar.
 */
export function formatProgressBar(percent: number, width: number = 20): string {
  const p = Math.max(0, Math.min(100, percent));
  const filledCount = Math.round((p / 100) * width);
  const emptyCount = Math.max(0, width - filledCount);
  const filled = "█".repeat(filledCount);
  const empty = "░".repeat(emptyCount);
  return `[${filled}${empty}] ${Math.round(p)}%`;
}

/**
 * Detects the active package manager on the host system.
 */
export function detectPackageManager(): "bun" | "npm" | "pnpm" | "yarn" {
  try {
    // Check if running under Bun runtime
    if (typeof (process as any).isBun !== "undefined" || process.versions.bun) {
      return "bun";
    }
  } catch {}

  // Check which binaries are available in PATH
  try {
    execSync("bun --version", { stdio: "ignore" });
    return "bun";
  } catch {}

  try {
    execSync("pnpm --version", { stdio: "ignore" });
    return "pnpm";
  } catch {}

  try {
    execSync("yarn --version", { stdio: "ignore" });
    return "yarn";
  } catch {}

  return "npm";
}

const SAFE_NPM_NAME_REGEX = /^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/;

/**
 * Fetches the latest published release version from npm registry.
 */
export async function getLatestNpmVersion(packageName: string = "musememory"): Promise<string | null> {
  if (!packageName || typeof packageName !== "string" || !SAFE_NPM_NAME_REGEX.test(packageName)) {
    return null;
  }

  try {
    const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data: any = await res.json();
      if (data && typeof data.version === "string") {
        return data.version;
      }
    }
  } catch {}

  // Fallback to npm view via execFileSync (no shell interpolation)
  try {
    const out = execFileSync("npm", ["show", packageName, "version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out && !out.includes("error")) return out;
  } catch {}

  return null;
}

/**
 * Returns structured gamified upgrade milestones.
 */
export function getUpgradeMilestones(): UpgradeMilestone[] {
  return [
    {
      level: 1,
      stage: "LEVEL 1 [🛡️ Vibeguard Pre-Flight Check]",
      description: "Auditing environment credentials & storage integrity",
    },
    {
      level: 2,
      stage: "LEVEL 2 [📦 Package Manager Synchronization]",
      description: "Querying package registry and pulling latest release binaries",
    },
    {
      level: 3,
      stage: "LEVEL 3 [🧠 Synaptic Database & Schema Alignment]",
      description: "Validating SQLite tables, CURRENT.md constraints & USER.md profiles",
    },
    {
      level: 4,
      stage: "LEVEL 4 [🤖 Agent Auto-Wiring Matrix]",
      description: "Scanning workstation platforms and auto-wiring newly detected agents",
    },
    {
      level: 5,
      stage: "LEVEL 5 [✨ Cognitive Ascendance Complete]",
      description: "Upgraded to latest version! All agent skills synchronized",
    },
  ];
}

/**
 * Plays a dynamic single-line animated ASCII panda progress loader.
 */
export async function playPandaLoader(
  steps: UpgradeStep[],
  options: PandaLoaderOptions = {},
): Promise<PandaLoaderResult> {
  const stream = options.stream ?? process.stdout;
  const isTTY = options.isTTY ?? (typeof (stream as any).isTTY === "boolean" ? (stream as any).isTTY : process.stdout.isTTY ?? false);
  const width = options.width ?? 20;
  const total = steps.length;
  const tickIntervalMs = options.tickIntervalMs ?? 60;
  const target = options.target;
  const panda = options.panda ?? DEFAULT_PANDA_FRAMES;

  const cleanTitle = options.title || "SYSTEM LEVEL-UP & RECOVERY MATRIX";
  const titleLine = `\n┌──────────────────────────────────────────────────────────────────┐\n│  🧠 MUSE MEMORY · ${cleanTitle.padEnd(46)}│\n└──────────────────────────────────────────────────────────────────┘\n`;
  stream.write(titleLine);

  let frameIndex = 0;
  let currentPercent = 0;
  const failedSteps: Array<{ step: UpgradeStep; error: any }> = [];

  for (let i = 0; i < total; i++) {
    const step = steps[i];
    const targetPercent = Math.round(((i + 1) / total) * 100);
    const stepStartPercent = Math.round((i / total) * 100);
    currentPercent = stepStartPercent;

    let timer: ReturnType<typeof setInterval> | null = null;
    let stepFailed = false;

    if (isTTY) {
      // Dynamic single-line ticking while action is in-flight
      timer = setInterval(() => {
        frameIndex++;
        if (currentPercent < targetPercent - 1) {
          currentPercent += Math.max(0.5, (targetPercent - currentPercent) * 0.15);
        }
        const bar = formatPandaProgressBar(Math.round(currentPercent), width, {
          panda,
          frame: frameIndex,
          target,
          trailChar: options.trailChar,
          trackChar: options.trackChar,
        });
        stream.write(`\r\x1b[K  ${bar} 🐾 [${i + 1}/${total}] ${step.title}...`);
      }, tickIntervalMs);

      // Initial render for step
      const bar = formatPandaProgressBar(stepStartPercent, width, {
        panda,
        frame: frameIndex,
        target,
        trailChar: options.trailChar,
        trackChar: options.trackChar,
      });
      stream.write(`\r\x1b[K  ${bar} 🐾 [${i + 1}/${total}] ${step.title}...`);
    } else {
      const bar = formatPandaProgressBar(targetPercent, width, {
        panda,
        frame: i,
        target,
        trailChar: options.trailChar,
        trackChar: options.trackChar,
      });
      stream.write(`  ${bar} 🐾 [${i + 1}/${total}] ${step.title}\n`);
    }

    try {
      await step.action();
    } catch (err: any) {
      stepFailed = true;
      failedSteps.push({ step, error: err });
      if (timer) clearInterval(timer);
      if (isTTY) {
        stream.write(`\n  [!] Warning during step "${step.title}": ${err.message || err}\n`);
      } else {
        stream.write(`  [!] Warning during step "${step.title}": ${err.message || err}\n`);
      }
    } finally {
      if (timer) clearInterval(timer);
    }

    if (isTTY) {
      currentPercent = targetPercent;
      frameIndex++;
      const bar = formatPandaProgressBar(targetPercent, width, {
        panda,
        frame: frameIndex,
        target,
        trailChar: options.trailChar,
        trackChar: options.trackChar,
      });
      if (stepFailed) {
        stream.write(`\r\x1b[K  ${bar} ✗ [${i + 1}/${total}] ${step.title} [FAILED]\n`);
      } else {
        stream.write(`\r\x1b[K  ${bar} ✓ [${i + 1}/${total}] ${step.title} [OK]`);
      }
      // Micro-pause for dynamic feel
      await new Promise((r) => setTimeout(r, 40));
    } else {
      if (stepFailed) {
        const bar = formatPandaProgressBar(targetPercent, width, {
          panda,
          frame: i,
          target,
          trailChar: options.trailChar,
          trackChar: options.trackChar,
        });
        stream.write(`  ${bar} ✗ [${i + 1}/${total}] ${step.title} [FAILED]\n`);
      }
    }
  }

  const finalBar = formatPandaProgressBar(100, width, {
    panda,
    frame: frameIndex,
    target: target ?? "🎋",
    trailChar: options.trailChar,
    trackChar: options.trackChar,
  });

  if (failedSteps.length > 0) {
    const msg = `  ${finalBar} ⚠️ [${total - failedSteps.length}/${total}] Completed with ${failedSteps.length} error(s).\n\n`;
    if (isTTY) {
      stream.write(`\r\x1b[K${msg}`);
    } else {
      stream.write(msg);
    }
  } else {
    const msg = `  ${finalBar} ✨ [${total}/${total}] Complete!\n\n`;
    if (isTTY) {
      stream.write(`\r\x1b[K${msg}`);
    } else {
      stream.write(msg);
    }
  }

  return {
    success: failedSteps.length === 0,
    failedSteps,
  };
}

/**
 * Backward-compatible alias for playPandaLoader.
 */
export const playGamifiedLoader = playPandaLoader;

/**
 * Recovers lost files, ensures CURRENT.md and USER.md exist, auto-connects agents, and indexes AST symbols.
 */
export async function repairInstallation(options: RepairOptions = {}): Promise<RepairResult> {
  const root = options.workspaceRoot || process.cwd();
  const isGlobal = options.global === true;
  const isDryRun = options.dryRun === true;
  const memoryDir = options.memoryDir || (isGlobal ? getGlobalMemoryDir() : resolveMemoryDir({ root }));
  const actionsTaken: string[] = [];
  const errors: string[] = [];

  // 1. Ensure .memory directory and memories folder exist
  const memoriesDir = join(memoryDir, "memories");
  if (!existsSync(memoriesDir)) {
    if (!isDryRun) {
      try {
        mkdirSync(memoriesDir, { recursive: true });
      } catch (err: unknown) {
        errors.push(`Failed creating memories directory: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    actionsTaken.push(isDryRun ? `[dry-run] Would create missing memories directory: ${memoriesDir}` : `Created missing memories directory: ${memoriesDir}`);
  }

  // 2. Ensure CURRENT.md exists
  const currentPath = join(memoryDir, "CURRENT.md");
  if (!existsSync(currentPath)) {
    if (!isDryRun) {
      try {
        writeFileSync(currentPath, "# Active Project Constraints\n\n- [ ] Initial session constraints initialized.\n", "utf8");
      } catch (err: unknown) {
        errors.push(`Failed creating CURRENT.md: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    actionsTaken.push(isDryRun ? `[dry-run] Would recover missing CURRENT.md at ${currentPath}` : `Recovered missing CURRENT.md at ${currentPath}`);
  }

  // 3. Ensure USER.md exists
  const uPath = userFilePath(memoryDir);
  if (!existsSync(uPath)) {
    if (!isDryRun) {
      try {
        initUserProfile(memoryDir, "developer", false, !isGlobal);
      } catch (err: unknown) {
        errors.push(`Failed initializing USER.md: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    actionsTaken.push(isDryRun ? `[dry-run] Would recover missing USER.md profile at ${uPath}` : `Recovered missing USER.md profile at ${uPath}`);
  }

  // 4. Re-wire agents if not skipped
  let agentsConnected = 0;
  if (!options.skipAgentConnect) {
    try {
      const reports = connectAgent("all", undefined, { dryRun: isDryRun, force: false });
      agentsConnected = reports.filter((r) => r.updated || r.installed).length;
      if (agentsConnected > 0) {
        actionsTaken.push(isDryRun ? `[dry-run] Would auto-wire ${agentsConnected} detected agent platform(s)` : `Auto-wired ${agentsConnected} detected agent platform(s)`);
      }
    } catch (err: unknown) {
      errors.push(`Failed auto-wiring agents: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 5. Re-index AST symbols if provider exists
  if (!isGlobal && existsSync(root)) {
    if (!isDryRun) {
      try {
        const index = indexGraph(root, memoryDir);
        if (index.symbolCount > 0) {
          actionsTaken.push(`Indexed ${index.symbolCount} AST symbols from ${index.provider}`);
        }
      } catch (err: unknown) {
        errors.push(`Failed indexing AST symbols: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      actionsTaken.push(`[dry-run] Would re-index AST symbols from active provider`);
    }

    // Check git pre-commit hook
    if (existsSync(join(root, ".git"))) {
      if (!isDryRun) {
        try {
          const hookRes = installGitHook(root);
          if (hookRes.installed) {
            actionsTaken.push(`Installed Git pre-commit transcript harvester hook`);
          }
        } catch (err: unknown) {
          errors.push(`Failed installing Git pre-commit hook: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        actionsTaken.push(`[dry-run] Would install Git pre-commit transcript harvester hook`);
      }
    }
  }

  return {
    repaired: errors.length === 0,
    actionsTaken,
    agentsConnected,
    memoryDir,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export interface HealBunOptions {
  enabled?: boolean;
  backup?: boolean;
  packagePath?: string;
}

export interface HealBunResult {
  healed: boolean;
  backupCreated: boolean;
  skipped: boolean;
  reason?: string;
  error?: string;
}

/**
 * Sanitizes ~/.bun/install/global/package.json from empty/corrupted dependency keys.
 * Gated behind explicit opt-in (enabled: true or MUSE_HEAL_BUN_CONFIG=true).
 * Creates a .bak backup before writing changes and surfaces errors cleanly.
 */
export function healBunGlobalConfig(options: HealBunOptions = {}): HealBunResult {
  const isOptedIn =
    options.enabled === true ||
    process.env.MUSE_HEAL_BUN_CONFIG === "1" ||
    process.env.MUSE_HEAL_BUN_CONFIG === "true";

  if (!isOptedIn) {
    return {
      healed: false,
      backupCreated: false,
      skipped: true,
      reason: "Opt-in required via enabled: true or MUSE_HEAL_BUN_CONFIG=true",
    };
  }

  const globalPkgPath =
    options.packagePath ||
    (() => {
      const home = process.env.HOME || process.env.USERPROFILE || "";
      return home ? join(home, ".bun", "install", "global", "package.json") : "";
    })();

  if (!globalPkgPath || !existsSync(globalPkgPath)) {
    return {
      healed: false,
      backupCreated: false,
      skipped: true,
      reason: `Global bun package.json not found at ${globalPkgPath || "unknown"}`,
    };
  }

  try {
    const raw = readFileSync(globalPkgPath, "utf-8");
    const pkg = JSON.parse(raw);
    let changed = false;

    if (pkg.dependencies && typeof pkg.dependencies === "object") {
      for (const key of Object.keys(pkg.dependencies)) {
        if (!key || key.trim() === "") {
          delete pkg.dependencies[key];
          changed = true;
        }
      }
    }

    if (changed) {
      if (options.backup !== false) {
        writeFileSync(`${globalPkgPath}.bak`, raw, "utf-8");
      }
      writeFileSync(globalPkgPath, JSON.stringify(pkg, null, 2), "utf-8");
      return {
        healed: true,
        backupCreated: options.backup !== false,
        skipped: false,
      };
    }

    return {
      healed: false,
      backupCreated: false,
      skipped: false,
      reason: "No corrupt empty keys found in package.json",
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      healed: false,
      backupCreated: false,
      skipped: false,
      error: `Failed to heal bun global package.json: ${errorMsg}`,
    };
  }
}

/**
 * Executes a package manager update command.
 */
export function executePackageUpgrade(
  pm: "bun" | "npm" | "pnpm" | "yarn",
  dryRun: boolean = false,
  options: { healBunConfig?: boolean } = {},
): string {
  let cmd = "";
  switch (pm) {
    case "bun":
      if (options.healBunConfig) {
        healBunGlobalConfig({ enabled: true });
      }
      cmd = "bun add -g musememory@latest";
      break;
    case "pnpm":
      cmd = "pnpm add -g musememory@latest";
      break;
    case "yarn":
      cmd = "yarn global add musememory@latest";
      break;
    default:
      cmd = "npm install -g musememory@latest";
      break;
  }

  if (!dryRun) {
    try {
      execSync(cmd, { stdio: "inherit" });
    } catch (err: any) {
      throw new Error(`Failed running upgrade command "${cmd}": ${err.message || err}`);
    }
  }
  return cmd;
}

export function getCurrentVersion(): string {
  try {
    const pkgPath = join(__dirname, "..", "..", "package.json");
    if (existsSync(pkgPath)) {
      const data = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (data.version) return data.version;
    }
  } catch {}
  try {
    const pkgPath = join(__dirname, "..", "package.json");
    if (existsSync(pkgPath)) {
      const data = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (data.version) return data.version;
    }
  } catch {}
  return "2.1.0";
}

/**
 * Main CLI handler for `memory upgrade` and `memory update`.
 */
export async function handleUpgradeCommand({ flags }: ParsedArgs): Promise<number> {
  try {
    const isGlobal = flags["global"] === "true" || flags["g"] === "true";
    const dryRun = flags["dry-run"] === "true";
    const force = flags["force"] === "true";
    const checkOnly = flags["check"] === "true";
    const failOnUpdate = flags["fail-on-update"] === "true" || flags["strict"] === "true";

    const pm = detectPackageManager();
    const currentVersion = getCurrentVersion();

    console.log(`[Upgrade] Checking for updates (detected package manager: ${pm})...`);
    const latestVersion = await getLatestNpmVersion();

    if (latestVersion) {
      console.log(`  * Installed version: v${currentVersion}`);
      console.log(`  * Latest release:    v${latestVersion}`);
    }

    if (checkOnly) {
      if (!latestVersion) {
        console.error(`\n❌ Failed to check for updates: Could not reach registry or resolve latest version.`);
        return 1;
      }
      if (latestVersion !== currentVersion) {
        console.log(`\n💡 Update available: v${currentVersion} ➔ v${latestVersion}`);
        console.log(`   Run 'memory upgrade' or '${pm === "bun" ? "bun add -g" : "npm install -g"} musememory@latest' to update.`);
        return failOnUpdate ? 1 : 0;
      } else {
        console.log(`\n✓ Muse Memory is up to date (v${currentVersion}).`);
        return 0;
      }
    }

  let repairInfo: RepairResult | undefined;

  const steps: UpgradeStep[] = [
    {
      level: 1,
      title: "Vibeguard Security & Credential Audit",
      action: async () => {
        const memDir = isGlobal ? getGlobalMemoryDir() : resolveMemoryDir();
        const currentPath = join(memDir, "CURRENT.md");
        const uPath = userFilePath(memDir);
        const leaked: string[] = [];
        if (existsSync(currentPath)) {
          const secrets = scanSecrets(readFileSync(currentPath, "utf-8"));
          if (secrets.length > 0) leaked.push(`CURRENT.md (${secrets.length} secret[s])`);
        }
        if (existsSync(uPath)) {
          const secrets = scanSecrets(readFileSync(uPath, "utf-8"));
          if (secrets.length > 0) leaked.push(`USER.md (${secrets.length} secret[s])`);
        }
        if (leaked.length > 0) {
          throw new Error(`Vibeguard audit detected unmasked secrets: ${leaked.join(", ")}`);
        }
      },
    },
    {
      level: 2,
      title: `Package Manager Sync (${pm})`,
      action: async () => {
        if (!dryRun) {
          executePackageUpgrade(pm, dryRun);
        }
      },
    },
    {
      level: 3,
      title: "Synaptic Storage & Schema Alignment",
      action: async () => {
        repairInfo = await repairInstallation({ global: isGlobal, dryRun, skipAgentConnect: true });
        if (repairInfo.errors && repairInfo.errors.length > 0) {
          throw new Error(`Storage alignment failed: ${repairInfo.errors.join("; ")}`);
        }
      },
    },
    {
      level: 4,
      title: "Agent Platforms & Skills Auto-Wiring",
      action: async () => {
        try {
          const reports = connectAgent("all", undefined, { dryRun, force: false });
          const connected = reports.filter((r) => r.updated || r.installed).length;
          if (repairInfo) {
            repairInfo.agentsConnected = connected;
            if (connected > 0) {
              repairInfo.actionsTaken.push(
                dryRun
                  ? `[dry-run] Would auto-wire ${connected} detected agent platform(s)`
                  : `Auto-wired ${connected} detected agent platform(s)`
              );
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (repairInfo) {
            if (!repairInfo.errors) repairInfo.errors = [];
            repairInfo.errors.push(`Failed auto-wiring agents: ${msg}`);
          }
          throw new Error(`Agent platform wiring failed: ${msg}`);
        }
      },
    },
    {
      level: 5,
      title: "Cognitive Ascendance Complete",
      action: async () => {
        const memDir = repairInfo?.memoryDir || (isGlobal ? getGlobalMemoryDir() : resolveMemoryDir());
        if (!existsSync(memDir)) {
          throw new Error(`Verification failed: Memory directory missing at ${memDir}`);
        }
      },
    },
  ];

  const loaderResult = await playGamifiedLoader(steps, { title: "SYSTEM LEVEL-UP & UPGRADE MATRIX" });

  if (!loaderResult.success) {
    console.error(`\n❌ [UPGRADE FAILED] One or more upgrade steps failed:`);
    for (const f of loaderResult.failedSteps) {
      console.error(`  ✗ ${f.step.title}: ${f.error?.message || f.error}`);
    }
    return 1;
  }

  console.log(`🏆 [LEVEL-UP COMPLETE] Muse Memory is now fully armed and up to date!`);
  if (repairInfo && repairInfo.actionsTaken.length > 0) {
    console.log(`\n🔧 Self-Healing Actions Applied:`);
    for (const act of repairInfo.actionsTaken) {
      console.log(`  ✓ ${act}`);
    }
  }
  if (repairInfo && repairInfo.errors && repairInfo.errors.length > 0) {
    console.warn(`\n⚠️ Self-Healing Warnings:`);
    for (const err of repairInfo.errors) {
      console.warn(`  ! ${err}`);
    }
  }

  console.log(`\n🚀 Available Upgrade Commands for Reference:`);
  console.log(`  • Bun:   bun add -g musememory@latest`);
  console.log(`  • NPM:   npm install -g musememory@latest`);
  console.log(`  • NPX:   npx musememory@latest`);
  console.log(`  • Auto:  memory upgrade\n`);

    return 0;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ [UPGRADE FAILED] ${errorMsg}`);
    return 1;
  }
}
