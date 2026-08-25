import { getCurrent, setCurrent } from "../current.ts";
import { getUserProfile, setUserProfile, initUserProfile, userFilePath, type UserArchetype } from "../user.ts";
import { CORE_TIERS, readCore, setCore, removeCore, type CoreTier } from "../core.ts";
import { getGlobalMemoryDir } from "../root.ts";
import { requireRoot, usageError, fail, type ParsedArgs } from "./shared.ts";

export async function handleCurrentCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const sub = positional[0];
  if (sub === "get") {
    const lines = getCurrent(ctx.memoryDir);
    for (const l of lines) console.log(l);
    return 0;
  }
  if (sub === "set") {
    const text = positional[1];
    const project = flags["project"];
    if (!text || !project) return usageError("current set requires <text> --project P");
    const lines = setCurrent(ctx.memoryDir, text, project);
    console.log(`CURRENT.md now has ${lines.length} lines`);
    return 0;
  }
  return usageError("current requires get|set");
}

export async function handleUserCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const isGlobal = flags["global"] === "true" || flags["g"] === "true";
  const targetDir = isGlobal ? getGlobalMemoryDir() : (requireRoot(flags)?.memoryDir ?? getGlobalMemoryDir());
  const sub = positional[0];

  if (!sub || sub === "get") {
    const profile = getUserProfile(targetDir);
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

  if (sub === "init") {
    const archetype = (positional[1] as UserArchetype) ?? "developer";
    const overwrite = flags["overwrite"] === "true";
    const content = initUserProfile(targetDir, archetype, overwrite);
    console.log(`[+] Initialized USER.md with '${archetype}' archetype in ${targetDir}:`);
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

  return usageError("user requires get|init|set");
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
