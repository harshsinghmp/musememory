import { getCurrent, setCurrent } from "../current.ts";
import { getUserProfile, setUserProfile, initUserProfile, userFilePath, type UserArchetype } from "../user.ts";
import { getGlobalMemoryDir } from "../root.ts";
import { requireRoot, type ParsedArgs } from "./shared.ts";

function usageError(msg: string): number {
  console.error(`Error: ${msg}`);
  return 2;
}

function fail(msg: string): number {
  console.error(`Error: ${msg}`);
  return 1;
}

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
