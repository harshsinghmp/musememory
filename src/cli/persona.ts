import { WorkspaceGovernor, getCurrent, setCurrent, syncConstraints } from "../governor.ts";
import { getUserProfile, setUserProfile, initUserProfile, userFilePath, type UserArchetype } from "../user.ts";
import { CORE_TIERS, readCore, setCore, removeCore, type CoreTier } from "../core.ts";
import { getGlobalMemoryDir } from "../root.ts";
import { requireRoot, usageError, fail, type ParsedArgs } from "./shared.ts";

export async function handleCurrentCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const sub = positional[0];
  if (!sub || sub === "get") {
    const lines = syncConstraints(ctx.memoryDir, ctx.store);
    for (const l of lines) console.log(l);
    return 0;
  }
  if (sub === "status") {
    const lines = syncConstraints(ctx.memoryDir, ctx.store);
    const activeState = WorkspaceGovernor.getActiveState(ctx.store, ctx.memoryDir);
    const handoff = activeState.handoff;
    console.log(`=== Active Working Constraints (${lines.length}) ===`);
    for (const l of lines) console.log(`  - ${l}`);
    console.log(`\n=== In-Flight Session State ===`);
    if (!handoff) {
      console.log(`  (No active in-flight session)`);
    } else {
      console.log(`  Status: [${handoff.status}]`);
      if (handoff.agent) console.log(`  Agent: ${handoff.agent}`);
      if (handoff.task) console.log(`  Active Task: ${handoff.task}`);
      if (handoff.lastQuery) console.log(`  Last Query: "${handoff.lastQuery}"`);
      if (handoff.updatedAt) console.log(`  Last Updated: ${handoff.updatedAt}`);
      if (handoff.progress) {
        console.log(`  Progress:`);
        for (const p of handoff.progress) console.log(`    ${p}`);
      }
      if (handoff.discoveries) {
        console.log(`  Learned Discoveries:`);
        for (const d of handoff.discoveries) console.log(`    ${d}`);
      }
    }
    return 0;
  }
  if (sub === "checkpoint") {
    const task = positional.slice(1).join(" ") || flags["task"];
    if (!task) return usageError("current checkpoint requires <task description>");
    const progressList = flags["progress"] ? [flags["progress"]] : undefined;
    const handoff = WorkspaceGovernor.checkpointSession(ctx.memoryDir, {
      status: "IN-PROGRESS",
      task,
      agent: flags["agent"] || process.env.AGENT_NAME || "User/CLI",
      progress: progressList,
    });
    console.log(`[+] Checkpointed in-flight work in CURRENT.md:`);
    console.log(`  Task: ${handoff.task}`);
    console.log(`  Status: [${handoff.status}]`);
    return 0;
  }
  if (sub === "done") {
    const summary = positional.slice(1).join(" ") || "Task completed";
    WorkspaceGovernor.completeSession(ctx.memoryDir, summary);
    console.log(`[+] Marked in-flight session completed in CURRENT.md: "${summary}"`);
    return 0;
  }
  if (sub === "set") {
    const text = positional[1];
    const project = flags["project"];
    if (!text || !project) return usageError("current set requires <text> --project P");
    const lines = setCurrent(ctx.memoryDir, text, project);
    syncConstraints(ctx.memoryDir, ctx.store);
    console.log(`CURRENT.md now has ${lines.length} lines`);
    return 0;
  }
  return usageError("current requires get|set|status|checkpoint|done");
}

export async function handleUserCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const isGlobal = flags["global"] === "true" || flags["g"] === "true";
  const targetDir = isGlobal ? getGlobalMemoryDir() : (requireRoot(flags)?.memoryDir ?? getGlobalMemoryDir());
  const sub = positional[0];

  if (!sub || sub === "get") {
    const query = positional.slice(1).join(" ");
    const profile = getUserProfile(targetDir, { query: query || undefined });
    const pPath = userFilePath(targetDir);
    if (!profile) {
      console.log(`No USER.md profile found in ${targetDir}.`);
      console.log(`Run 'memory user init' to create one with standard defaults.`);
      return 0;
    }
    console.log(`=== User Profile (${pPath}) ===\n`);
    console.log(profile);
    return 0;
  }

  if (sub === "scope") {
    const query = positional.slice(1).join(" ");
    if (!query) return usageError("user scope requires <query/task description>");
    const { detectScopeArchetype } = await import("../user.ts");
    const detected = detectScopeArchetype(query);
    const profile = getUserProfile(targetDir, { query });
    console.log(`Detected Scope Archetype: [${detected.toUpperCase()}]\n`);
    console.log(`=== Rendered Profile ===\n`);
    console.log(profile);
    return 0;
  }

  if (sub === "init") {
    const archetype = positional[1] as UserArchetype | undefined;
    const overwrite = flags["overwrite"] === "true";
    const isLocal = !isGlobal && targetDir !== getGlobalMemoryDir() && !archetype;
    const content = initUserProfile(targetDir, archetype ?? "developer", overwrite, isLocal);
    console.log(`[+] Initialized USER.md ${isLocal ? "(inheriting global)" : `with '${archetype ?? "developer"}' archetype`} in ${targetDir}:`);
    console.log(content);
    return 0;
  }

  if (sub === "set") {
    const content = positional.slice(1).join(" ");
    if (!content) return usageError("user set requires <content>");
    try {
      setUserProfile(targetDir, content);
      console.log(`[+] Updated USER.md in ${targetDir}`);
      return 0;
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  return usageError("user requires get|scope|init|set");
}

export async function handleCoreCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const tier = positional[0] as CoreTier | undefined;

  // Bare `memory core`: list all tiers
  if (!tier) {
    const tiers = readCore(ctx.memoryDir);
    for (const t of CORE_TIERS) {
      console.log(`=== ${t} ===`);
      if (tiers[t].length === 0) console.log("(empty)");
      else for (const line of tiers[t]) console.log(line);
    }
    return 0;
  }

  if (!(CORE_TIERS as readonly string[]).includes(tier)) {
    return usageError(`unknown core tier "${tier}" (expected: ${CORE_TIERS.join("|")})`);
  }

  if (flags["set"] !== undefined) {
    try {
      const tiers = setCore(ctx.memoryDir, tier, flags["set"]);
      console.log(`[+] CORE.md '${tier}' now has ${tiers[tier].length} lines`);
      return 0;
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  if (flags["remove"] !== undefined || flags["remove"] === "") {
    const tiers = removeCore(ctx.memoryDir, tier);
    console.log(`[-] CORE.md '${tier}' cleared (${tiers[tier].length} lines)`);
    return 0;
  }

  // Default / --show: print the tier
  const lines = readCore(ctx.memoryDir)[tier];
  if (lines.length === 0) {
    console.log(`(empty)`);
    return 0;
  }
  for (const line of lines) console.log(line);
  return 0;
}
