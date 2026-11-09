import { requireRoot, usageError } from "./shared.ts";
import type { ParsedArgs } from "./shared.ts";
import {
  createBranchOverlay,
  currentGitBranch,
  dropBranchOverlay,
  listBranchMemories,
  loadBranchOverlay,
  mergeBranchOverlay,
  writeBranchEntry,
  deleteBranchEntry,
} from "../store/branch.ts";
import { get } from "../store.ts";

export async function handleOverlayCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const sub = positional[0] ?? "show";
  const branch = positional[1] ?? flags["branch"] ?? currentGitBranch(ctx.root) ?? undefined;
  if (!branch && sub !== "list") return usageError("branch requires a branch name or a git checkout");

  try {
  switch (sub) {
    case "list": {
      const branchName = branch ?? currentGitBranch(ctx.root);
      const overlay = branchName ? loadBranchOverlay(ctx.memoryDir, branchName) : null;
      console.log(branchName ?? "(detached)");
      if (overlay) console.log(`overlay: ${overlay.entries.length} entry(ies), ${overlay.deleted_ids.length} deletion(s)`);
      else console.log("overlay: none");
      return 0;
    }
    case "create": {
      const overlay = createBranchOverlay(ctx.store, { branch, baseBranch: flags["base"] });
      console.log(`branch overlay ready: ${overlay.meta.branch}`);
      return 0;
    }
    case "show": {
      const overlay = loadBranchOverlay(ctx.memoryDir, branch!);
      if (!overlay) return usageError(`no overlay for '${branch}'`);
      console.log(`${overlay.meta.branch} (base ${overlay.meta.base_branch ?? "?"})`);
      for (const entry of overlay.entries) console.log(`  ${entry.id} ${entry.status} ${entry.title}`);
      return 0;
    }
    case "set": {
      const id = positional[2];
      const content = flags["content"];
      if (!id || !content) return usageError("overlay set <branch> <id> --content <text>");
      const base = get(ctx.store, id);
      const overlay = loadBranchOverlay(ctx.memoryDir, branch!);
      const existing = overlay?.entries.find((entry) => entry.id === id) ?? base;
      if (!existing) return usageError(`no memory '${id}'`);
      writeBranchEntry(ctx.store, branch!, {
        ...existing,
        content,
        title: flags["title"] ?? existing.title,
        status: (flags["status"] as typeof existing.status) ?? existing.status,
        updated_at: new Date().toISOString(),
      });
      console.log(`overlay ${branch}: set ${id}`);
      return 0;
    }
    case "rm": {
      const id = positional[2];
      if (!id) return usageError("overlay rm <branch> <id>");
      deleteBranchEntry(ctx.store, branch!, id);
      console.log(`overlay ${branch}: removed ${id}`);
      return 0;
    }
    case "merge": {
      const strategy = (flags["strategy"] ?? "semantic") as "ours" | "theirs" | "semantic";
      const report = mergeBranchOverlay(ctx.store, branch!, { strategy });
      if (report.conflicts.length > 0) {
        console.error(`merge blocked: ${report.conflicts.length} conflict(s)`);
        for (const conflict of report.conflicts) console.error(`  ${conflict.id} (${conflict.reason})`);
        return 1;
      }
      console.log(`merged ${report.branch}: ${report.applied.length} applied, ${report.archived.length} archived`);
      return 0;
    }
    case "drop": {
      if (!dropBranchOverlay(ctx.store, branch!)) return usageError(`no overlay for '${branch}'`);
      console.log(`dropped ${branch}`);
      return 0;
    }
    case "entries": {
      for (const entry of listBranchMemories(ctx.store, branch!)) console.log(`${entry.id} ${entry.status} ${entry.title}`);
      return 0;
    }
    default:
      return usageError(`unknown overlay subcommand '${sub}' (expected list | create | show | entries | set | rm | merge | drop)`);
  }
  } catch (err) {
    return usageError(err instanceof Error ? err.message : String(err));
  }
}
