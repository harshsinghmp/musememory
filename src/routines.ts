import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

export interface Routine {
  /** Cron expression; consumed by the user's own crontab — musememory never schedules anything itself. */
  schedule: string;
  /** Memory subcommand steps executed in order, e.g. ["brief", "nudge"]. */
  run: string[];
}

export interface RoutinesFile {
  routines: Record<string, Routine>;
}

export function routinesPath(memoryDir: string): string {
  return join(memoryDir, "routines.yaml");
}

/** Allowed subcommands that unattended routines are permitted to execute (T-399). */
export const ROUTINE_STEP_ALLOWLIST = new Set([
  "brief",
  "nudge",
  "recall",
  "compact",
  "distill",
  "verify",
]);

/** Load and validate .memory/routines.yaml. Missing file = zero routines. Throws on malformed entries. */
export function loadRoutines(memoryDir: string): RoutinesFile {
  const p = routinesPath(memoryDir);
  if (!existsSync(p)) return { routines: {} };
  const doc = (yaml.load(readFileSync(p, "utf8"), { schema: yaml.JSON_SCHEMA }) ?? {}) as Partial<RoutinesFile>;
  const routines = doc.routines ?? {};
  for (const [name, r] of Object.entries(routines as Record<string, Partial<Routine>>)) {
    if (!r || typeof r.schedule !== "string" || !r.schedule.trim()) {
      throw new Error(`routine '${name}': missing schedule`);
    }
    if (!Array.isArray(r.run) || r.run.length === 0 || r.run.some((s) => typeof s !== "string")) {
      throw new Error(`routine '${name}': run must be a non-empty array of command strings`);
    }
    for (const step of r.run) {
      const tokens = step.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) {
        throw new Error(`routine '${name}': empty command string`);
      }
      const baseCmd = tokens[0];
      if (!ROUTINE_STEP_ALLOWLIST.has(baseCmd)) {
        throw new Error(
          `routine '${name}': step '${baseCmd}' is not permitted (must be one of: ${Array.from(ROUTINE_STEP_ALLOWLIST).join(", ")})`,
        );
      }
      for (const tok of tokens) {
        if (tok.startsWith("-")) {
          throw new Error(
            `routine '${name}': flags and options are not permitted in routine steps ('${step}')`,
          );
        }
      }
    }
  }
  return { routines: routines as Record<string, Routine> };
}

/**
 * The crontab line for a routine. `memory routine install` only PRINTS this —
 * installing into the system crontab is the user's action (no system mutation,
 * no cron/launchd/systemd platform variance).
 */
export function crontabLine(name: string, routine: Routine): string {
  return `${routine.schedule} memory routine run ${name} # musememory routine`;
}

export interface RunOptions {
  /** Step executor override (tests). Default dynamically dispatches through the CLI router. */
  exec?: (step: string, options?: RunOptions) => Promise<number>;
  /** Re-entrancy recursion depth tracker (T-399). Throws when depth > 5. */
  depth?: number;
}

/** Execute a named routine's steps in order. Returns nonzero if any step fails. */
export async function runRoutine(memoryDir: string, name: string, options: RunOptions = {}): Promise<number> {
  const currentDepth = (options.depth ?? 0) + 1;
  if (currentDepth > 5) {
    throw new Error("routine re-entrancy limit exceeded: depth > 5");
  }

  const { routines } = loadRoutines(memoryDir);
  const routine = routines[name];
  if (!routine) throw new Error(`unknown routine: ${name} (define it in .memory/routines.yaml)`);
  const exec = options.exec ?? defaultExec;
  let failures = 0;
  for (const step of routine.run) {
    const code = await exec(step, { ...options, depth: currentDepth });
    if (code !== 0) failures++;
  }
  return failures > 0 ? 1 : 0;
}

async function defaultExec(step: string): Promise<number> {
  // Dynamic import breaks the cli <-> lifecycle <-> routines module cycle at eval time.
  const cli = await import("./cli.ts");
  return cli.main(step.trim().split(/\s+/));
}
