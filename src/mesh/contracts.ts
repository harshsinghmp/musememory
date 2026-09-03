import fs from "node:fs";
import path from "node:path";
import type { Store } from "../store.ts";
import { list } from "../store.ts";
import type { MeshTopology, MeshContractAuditResult, MeshContractItem } from "./types.ts";

/**
 * Cross-Package / Monorepo Mesh Contract Auditor
 * Validates cross-package dependency contracts, shared interfaces, and cross-repo code anchors.
 */
export function auditMeshContracts(topology: MeshTopology, store: Store): MeshContractAuditResult {
  const items: MeshContractItem[] = [];
  const nodesByName = new Map<string, typeof topology.nodes[0]>();
  for (const node of topology.nodes) {
    nodesByName.set(node.name, node);
    nodesByName.set(node.id, node);
  }

  // 1. Audit Cross-Package Dependencies in Monorepo
  for (const sourceNode of topology.nodes) {
    for (const depName of sourceNode.dependencies) {
      if (nodesByName.has(depName)) {
        const targetNode = nodesByName.get(depName)!;
        const targetPkgPath = path.join(targetNode.path, "package.json");

        if (!fs.existsSync(targetPkgPath)) {
          items.push({
            sourcePackage: sourceNode.name,
            targetPackage: targetNode.name,
            symbol: "package.json",
            status: "missing",
            detail: `Shared internal dependency '${depName}' referenced by '${sourceNode.name}' has no package.json at ${targetNode.path}`,
          });
          continue;
        }

        // Check target's exports / main entry point
        try {
          const pkg = JSON.parse(fs.readFileSync(targetPkgPath, "utf-8"));
          const mainEntry = pkg.main || pkg.module || (pkg.exports ? (typeof pkg.exports === "string" ? pkg.exports : pkg.exports["."]) : undefined);
          if (mainEntry && typeof mainEntry === "string") {
            const entryFile = path.resolve(targetNode.path, mainEntry);
            if (!fs.existsSync(entryFile) && !fs.existsSync(`${entryFile}.ts`) && !fs.existsSync(`${entryFile}.js`)) {
              items.push({
                sourcePackage: sourceNode.name,
                targetPackage: targetNode.name,
                symbol: mainEntry,
                status: "drifted",
                detail: `Entrypoint '${mainEntry}' declared in '${depName}' is missing on disk.`,
              });
            } else {
              items.push({
                sourcePackage: sourceNode.name,
                targetPackage: targetNode.name,
                symbol: `package:${depName}`,
                status: "valid",
                detail: `Dependency contract '${depName}' is verified and reachable.`,
              });
            }
          } else {
            items.push({
              sourcePackage: sourceNode.name,
              targetPackage: targetNode.name,
              symbol: `package:${depName}`,
              status: "valid",
              detail: `Dependency '${depName}' exists in mesh workspace.`,
            });
          }
        } catch {
          items.push({
            sourcePackage: sourceNode.name,
            targetPackage: targetNode.name,
            symbol: `package:${depName}`,
            status: "drifted",
            detail: `Failed to parse package.json for dependency '${depName}'.`,
          });
        }
      }
    }
  }

  // 2. Audit Cross-Repo / Cross-Package Code Anchors in Current Store
  const entries = list(store);
  for (const entry of entries) {
    if (entry.status === "archived" || entry.status === "superseded") continue;

    // Check code anchors for repo: or cross-directory prefixes
    for (const anchor of entry.anchors || []) {
      if (anchor.kind === "symbol" || anchor.kind === "file") {
        const val = anchor.file_path || anchor.qualified_name || anchor.symbol_name || "";
        // Check if value refers to an external node: "repo:<name>/<path>" or "@<scope>/<pkg>#<symbol>"
        if (val.startsWith("repo:") || val.includes("packages/")) {
          let targetNodeName = "external";
          let relativePath = val;
          let targetSymbol = anchor.symbol_name || "";

          if (val.includes("#")) {
            const parts = val.split("#");
            relativePath = parts[0];
            targetSymbol = parts[1];
          }

          // Match node
          for (const node of topology.nodes) {
            if (val.includes(node.name) || val.includes(path.basename(node.path))) {
              targetNodeName = node.name;
              break;
            }
          }

          const resolvedPath = path.isAbsolute(relativePath.replace(/^repo:[^/]+\//, ""))
            ? relativePath.replace(/^repo:[^/]+\//, "")
            : path.resolve(topology.rootPath, relativePath.replace(/^repo:[^/]+\//, ""));

          if (!fs.existsSync(resolvedPath)) {
            items.push({
              sourcePackage: path.basename(store.dir),
              targetPackage: targetNodeName,
              symbol: val,
              status: "missing",
              detail: `Cross-project anchor '${val}' points to missing file '${resolvedPath}'`,
            });
          } else if (targetSymbol) {
            const content = fs.readFileSync(resolvedPath, "utf-8");
            if (!content.includes(targetSymbol)) {
              items.push({
                sourcePackage: path.basename(store.dir),
                targetPackage: targetNodeName,
                symbol: val,
                status: "drifted",
                detail: `Cross-project anchor symbol '${targetSymbol}' not found in file '${resolvedPath}'`,
              });
            } else {
              items.push({
                sourcePackage: path.basename(store.dir),
                targetPackage: targetNodeName,
                symbol: val,
                status: "valid",
                detail: `Cross-project anchor symbol '${targetSymbol}' verified in '${resolvedPath}'`,
              });
            }
          } else {
            items.push({
              sourcePackage: path.basename(store.dir),
              targetPackage: targetNodeName,
              symbol: val,
              status: "valid",
              detail: `Cross-project anchor verified in '${resolvedPath}'`,
            });
          }
        }
      }
    }
  }

  const valid_contracts = items.filter((i) => i.status === "valid").length;
  const broken_contracts = items.filter((i) => i.status !== "valid").length;
  const total_contracts_checked = items.length;

  let summary = `Verified ${total_contracts_checked} mesh contracts (${valid_contracts} valid, ${broken_contracts} broken).`;
  if (broken_contracts > 0) {
    summary += ` Warning: ${broken_contracts} cross-package dependencies or anchors are drifted or missing!`;
  }

  return {
    total_contracts_checked,
    valid_contracts,
    broken_contracts,
    items,
    summary,
  };
}
