import path from "node:path";
import { requireRoot, type ParsedArgs } from "./shared.ts";
import {
  discoverWorkspaceMesh,
  resolveMeshMemories,
  auditMeshContracts,
  addMeshLink,
  removeMeshLink,
  propagateConstraintToMesh,
} from "../mesh/index.ts";

export async function handleMeshCommand(parsed: ParsedArgs): Promise<number> {
  const ctx = requireRoot(parsed.flags);
  if (!ctx) return 1;

  const sub = parsed.positional[1]?.toLowerCase();
  const isJson = parsed.flags["json"] === "true";
  const workspaceRoot = ctx.store.layout?.root || path.dirname(ctx.memoryDir);

  const topology = discoverWorkspaceMesh(workspaceRoot, ctx.memoryDir);

  // 1. memory mesh link <path>
  if (sub === "link") {
    const targetPath = parsed.positional[2] || parsed.flags["path"];
    if (!targetPath) {
      console.error("Error: Please specify target repository or package path to link: memory mesh link <path>");
      return 1;
    }
    try {
      addMeshLink(ctx.memoryDir, targetPath);
      if (isJson) {
        console.log(JSON.stringify({ success: true, linked: targetPath }, null, 2));
      } else {
        console.log(`\x1b[32m✓ Linked external project to mesh:\x1b[0m ${path.resolve(targetPath)}`);
      }
      return 0;
    } catch (err: unknown) {
      console.error(`Error linking project: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  // 2. memory mesh unlink <path>
  if (sub === "unlink") {
    const targetPath = parsed.positional[2] || parsed.flags["path"];
    if (!targetPath) {
      console.error("Error: Please specify target path to unlink: memory mesh unlink <path>");
      return 1;
    }
    removeMeshLink(ctx.memoryDir, targetPath);
    if (isJson) {
      console.log(JSON.stringify({ success: true, unlinked: targetPath }, null, 2));
    } else {
      console.log(`\x1b[33m✓ Unlinked project from mesh:\x1b[0m ${path.resolve(targetPath)}`);
    }
    return 0;
  }

  // 3. memory mesh query <query>
  if (sub === "query" || parsed.flags["query"]) {
    const q = (sub === "query" ? parsed.positional.slice(2).join(" ") : parsed.flags["query"]) || "";
    const limit = parsed.flags["limit"] ? parseInt(parsed.flags["limit"], 10) : 10;
    const targetProjects = parsed.flags["projects"] ? parsed.flags["projects"].split(",") : undefined;

    const results = resolveMeshMemories(ctx.store, topology, {
      query: q,
      limit,
      targetProjects,
    });

    if (isJson) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(`\x1b[1m\x1b[36mCross-Project Mesh Memory Query:\x1b[0m "${q || "*"}" (${results.length} found)\n`);
      if (results.length === 0) {
        console.log("  No matching memories found across mesh workspace.");
      } else {
        for (const res of results) {
          const scorePill = `\x1b[33m[${(res.score * 100).toFixed(0)}%]\x1b[0m`;
          const originPill = `\x1b[35m[${res.originProject}]\x1b[0m`;
          const typePill = `\x1b[36m[${res.memory.type}]\x1b[0m`;
          console.log(`  ${scorePill} ${originPill} ${typePill} \x1b[1m${res.memory.title}\x1b[0m`);
          console.log(`    ${res.memory.content.slice(0, 100).replace(/\n/g, " ")}...`);
          console.log(`    \x1b[2mNode Path: ${res.sourceNode.path}\x1b[0m\n`);
        }
      }
    }
    return 0;
  }

  // 4. memory mesh check / audit
  if (sub === "check" || sub === "audit" || parsed.flags["check"] === "true") {
    const audit = auditMeshContracts(topology, ctx.store);
    if (isJson) {
      console.log(JSON.stringify(audit, null, 2));
    } else {
      console.log(`\x1b[1m\x1b[36mMonorepo / Multi-Repo Mesh Contract Audit:\x1b[0m\n`);
      console.log(`  ${audit.summary}\n`);
      for (const item of audit.items) {
        const color = item.status === "valid" ? "\x1b[32m" : item.status === "drifted" ? "\x1b[33m" : "\x1b[31m";
        console.log(`  ${color}[${item.status.toUpperCase()}]\x1b[0m ${item.sourcePackage} -> ${item.targetPackage} (${item.symbol})`);
        console.log(`    ${item.detail}`);
      }
    }
    return audit.broken_contracts > 0 ? 1 : 0;
  }

  // 5. memory mesh propagate --title <t> --content <c>
  if (sub === "propagate") {
    const title = parsed.flags["title"];
    const content = parsed.flags["content"] || "";
    if (!title) {
      console.error("Error: --title required for propagating mesh constraint");
      return 1;
    }
    const propRes = propagateConstraintToMesh(ctx.store, topology, { title, content });
    if (isJson) {
      console.log(JSON.stringify(propRes, null, 2));
    } else {
      console.log(`\x1b[32m✓ Propagated shared constraint across ${propRes.propagatedNodes.length} mesh projects:\x1b[0m`);
      for (const p of propRes.propagatedNodes) {
        console.log(`    • ${p}`);
      }
    }
    return 0;
  }

  // Default: memory mesh (Show topology overview)
  if (isJson) {
    console.log(JSON.stringify(topology, null, 2));
    return 0;
  }

  console.log(`\x1b[1m\x1b[36m=== Multi-Repo & Monorepo Cross-Project Mesh ===\x1b[0m`);
  console.log(`Workspace Root:  ${topology.rootPath}`);
  console.log(`Workspace Type:  \x1b[32m${topology.workspaceType.toUpperCase()}\x1b[0m`);
  console.log(`Monorepo:        ${topology.isMonorepo ? "Yes" : "No"}`);
  console.log(`Discovered Nodes: ${topology.nodes.length}\n`);

  console.log(`\x1b[1mMesh Topology Nodes:\x1b[0m`);
  for (const node of topology.nodes) {
    const currentTag = node.isCurrent ? " \x1b[32m(CURRENT)\x1b[0m" : "";
    const storeTag = node.hasStore ? "\x1b[36m[Store: Active]\x1b[0m" : "\x1b[2m[Store: None]\x1b[0m";
    const typeTag = `\x1b[35m[${node.nodeType}]\x1b[0m`;
    console.log(`  • \x1b[1m${node.name}\x1b[0m ${currentTag} ${typeTag} ${storeTag}`);
    console.log(`    Path: ${node.path}`);
    if (node.dependencies.length > 0) {
      console.log(`    Deps: ${node.dependencies.slice(0, 5).join(", ")}${node.dependencies.length > 5 ? "..." : ""}`);
    }
  }

  if (topology.linkedPaths.length > 0) {
    console.log(`\n\x1b[1mExplicitly Linked Projects:\x1b[0m`);
    for (const p of topology.linkedPaths) {
      console.log(`  -> ${p}`);
    }
  }

  console.log(`\nCommands:`);
  console.log(`  memory mesh query <search>             Query memories across entire mesh`);
  console.log(`  memory mesh check                      Audit cross-package contract integrity`);
  console.log(`  memory mesh link <path>                Link external repo to mesh`);
  console.log(`  memory mesh propagate --title <t>      Broadcast constraint to all mesh nodes`);

  return 0;
}
