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
  exec?: (step: string) => Promise<number>;
}

/** Execute a named routine's steps in order. Returns nonzero if any step fails. */
export async function runRoutine(memoryDir: string, name: string, options: RunOptions = {}): Promise<number> {
  const { routines } = loadRoutines(memoryDir);
  const routine = routines[name];
  if (!routine) throw new Error(`unknown routine: ${name} (define it in .memory/routines.yaml)`);
  const exec = options.exec ?? defaultExec;
  let failures = 0;
  for (const step of routine.run) {
    const code = await exec(step);
    if (code !== 0) failures++;
  }
  return failures > 0 ? 1 : 0;
}

async function defaultExec(step: string): Promise<number> {
  // Dynamic import breaks the cli <-> lifecycle <-> routines module cycle at eval time.
  const cli = await import("./cli.ts");
  return cli.main(step.trim().split(/\s+/));
}
