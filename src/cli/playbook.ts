import { findOrCreateProjectRoot } from "../root.ts";
import {
  formatPlaybook,
  getPlaybook,
  listPlaybooks,
  recordPlaybookOutcome,
} from "../cognition/playbooks.ts";
import type { ParsedArgs } from "./shared.ts";

export async function handlePlaybookCommand(args: ParsedArgs): Promise<number> {
  const startDir = args.flags.dir || process.cwd();
  const { memoryDir } = findOrCreateProjectRoot(startDir, { global: Boolean(args.flags.global) });

  // D7: `--run` used to be a silent show alias, so `memory playbook --run <id>`
  // looked like it executed the trajectory and actually just printed it.
  // Playbook steps carry arbitrary shell commands, so executing them needs a
  // confirmation gate and its own security review; until that exists this flag
  // refuses loudly instead of implying it ran something.
  if (args.flags.run !== undefined) {
    console.error(
      "playbook --run is not implemented: playbooks are advisory, not executable.\n" +
        "Inspect the steps with `memory playbook <id>` and run them yourself.",
    );
    return 2;
  }

  const id = args.flags.id || args.flags.show || args.positional[0];
  const wantsList = Boolean(args.flags.list) || !id;

  try {
  if (wantsList) {
    const playbooks = listPlaybooks(memoryDir, args.flags.tag);
    if (playbooks.length === 0) {
      console.log("No playbooks recorded.");
      return 0;
    }
    for (const playbook of playbooks) {
      console.log(`${playbook.id}  ${playbook.title}  (${playbook.successCount} success / ${playbook.failureCount} failure)`);
    }
    return 0;
  }

  const playbook = getPlaybook(memoryDir, id);
  if (!playbook) {
    console.error(`playbook '${id}' not found`);
    return 1;
  }

  let shown = playbook;
  const recordSuccess = args.flags.success !== undefined;
  const recordFailure = args.flags.fail !== undefined || args.flags.failure !== undefined;
  if (recordSuccess || recordFailure) {
    const updated = recordPlaybookOutcome(memoryDir, playbook.id, recordSuccess);
    if (!updated) {
      console.error(`Could not record outcome for '${id}'`);
      return 1;
    }
    console.log(`Recorded ${recordSuccess ? "success" : "failure"} for '${updated.title}'.`);
    shown = updated;
  }

  console.log(formatPlaybook(shown));
  return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
