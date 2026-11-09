import { requireRoot, usageError } from "./shared.ts";
import type { ParsedArgs } from "./shared.ts";
import {
  createBranchOverlay,
  currentGitBranch,
  dropBranchOverlay,
  listBranchMemories,
  loadBranchOverlay,
  mergeBranchOverlay,
} from "../store/branch.ts";

export async function handleOverlayCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const sub = positional[0] ?? "show";
  const branch = positional[1] ?? flags["branch"] ?? currentGitBranch(ctx.root) ?? undefined;
  if (!branch && sub !== "list") return usageError("branch requires a branch name or a git checkout");

  switch (sub) {
    case "list": {
      const branchName = currentGitBranch(ctx.root);
      const overlay = branchName ? loadBranchOverlay(ctx.memoryDir, branchName) : null;
      console.log(branchName ?? "(detached)");
      if (overlay) console.log(`overlay: ${overlay.entries.length} entry(ies), ${overlay.deleted_ids.length} deletion(s)`);
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
    case "merge": {
      const report = mergeBranchOverlay(ctx.store, branch!);
      console.log(`merged ${report.branch}: ${report.applied.length} applied, ${report.deleted.length} archived`);
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
      return usageError(`unknown overlay subcommand '${sub}' (expected list | create | show | entries | merge | drop)`);
  }
}
