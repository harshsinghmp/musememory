import { requireRoot, type ParsedArgs } from "./shared.ts";

/**
 * T-320: `memory conflicts` — inspect the contradiction engine's output.
 *
 * Without flags it lists the conflicts recorded in the keep-both conflicts
 * table. With `--dry-run` it performs a read-only scan of the store and
 * reports the memory pairs the engine WOULD flag if automatic contradiction
 * detection were enabled. Nothing is mutated in either mode.
 */
export async function handleConflictsCommand(parsed: ParsedArgs): Promise<number> {
  const ctx = requireRoot(parsed.flags);
  if (!ctx) {
    console.error("Error: Could not resolve project root or initialize .memory directory.");
    return 1;
  }
  const { store } = ctx;

  const isTrue = (val: unknown): boolean => val === true || val === "true" || val === "";
  const dryRun = isTrue(parsed.flags["dry-run"]) || isTrue(parsed.flags["n"]);
  const project = parsed.flags["project"] as string | undefined;

  const { listConflicts, scanPotentialConflicts } = await import("../quality/contradiction.ts");

  const recorded = listConflicts(store, { status: "open" });
  const resolved = listConflicts(store, { status: "resolved" });

  if (dryRun) {
    const potential = scanPotentialConflicts(store, { project });

    if (parsed.flags.json) {
      console.log(
        JSON.stringify(
          {
            mode: "dry-run",
            project: project ?? null,
            recorded_open: recorded.length,
            recorded_resolved: resolved.length,
            potential_conflicts: potential,
          },
          null,
          2,
        ),
      );
      return 0;
    }

    const bold = "\x1b[1m";
    const reset = "\x1b[0m";
    const yellow = "\x1b[33m";
    const red = "\x1b[31m";

    console.log(`\n${bold}🔍 CONTRADICTION ENGINE — DRY RUN${reset}`);
    console.log(`${"=".repeat(56)}`);
    console.log(`Project:            ${bold}${project ?? "all"}${reset}`);
    console.log(`Recorded (open):    ${recorded.length}`);
    console.log(`Recorded (resolved):${resolved.length}`);
    console.log(`Potential pairs:    ${potential.length}\n`);

    if (potential.length === 0) {
      console.log("  ✅ No memory pairs would be flagged as contradictory.\n");
      return 0;
    }

    console.log(`${yellow}Would be flagged (nothing was changed):${reset}`);
    for (const pair of potential) {
      console.log(`  ${red}✗${reset} ${pair.entry_a_title}`);
      console.log(`      ${pair.entry_a_id}`);
      console.log(`    ${red}✗${reset} ${pair.entry_b_title}`);
      console.log(`      ${pair.entry_b_id}`);
      console.log(`      reason: ${pair.reason ?? "unknown"}`);
      console.log("");
    }
    console.log(
      `${bold}Note${reset}: flagging a pair moves BOTH memories to 'conflicted' (25 health points each)\n` +
        `and removes both from every future sync broadcast. Resolve with 'memory_resolve_conflict'.\n`,
    );
    return 0;
  }

  if (parsed.flags.json) {
    console.log(
      JSON.stringify(
        { mode: "recorded", open: recorded, resolved: resolved.length },
        null,
        2,
      ),
    );
    return 0;
  }

  const bold = "\x1b[1m";
  const reset = "\x1b[0m";

  console.log(`\n${bold}⚖️  CONFLICTS${reset}`);
  console.log(`${"=".repeat(56)}`);
  console.log(`Open:     ${recorded.length}`);
  console.log(`Resolved: ${resolved.length}\n`);

  if (recorded.length === 0) {
    console.log("  ✅ No open conflicts.\n");
    return 0;
  }

  for (const conflict of recorded) {
    console.log(`${bold}${conflict.memory_a_id}${reset} ↔ ${bold}${conflict.memory_b_id}${reset}`);
    console.log(`  type: ${conflict.conflict_type}   confidence: ${conflict.confidence}`);
    console.log(`  reason: ${conflict.reason ?? "unknown"}`);
    console.log(`  detected: ${conflict.detected_at}`);
    console.log("");
  }

  console.log(`${bold}Tip${reset}: run 'memory conflicts --dry-run' to preview what would be flagged.\n`);
  return 0;
}
