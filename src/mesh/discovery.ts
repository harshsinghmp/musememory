import fs from "node:fs";
import path from "node:path";
import type { MeshNode, MeshTopology, WorkspaceType, MeshNodeType } from "./types.ts";

const MESH_LINKS_FILE = "mesh_links.json";

/**
 * Load explicitly linked external repository or package paths from .memory/mesh_links.json
 */
export function listMeshLinks(memoryDir: string): string[] {
  const filePath = path.join(memoryDir, MESH_LINKS_FILE);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.linked)) {
      return parsed.linked.filter((p: unknown) => typeof p === "string" && fs.existsSync(p));
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Add an explicit link to an external repository or package
 */
export function addMeshLink(memoryDir: string, targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Target path does not exist: ${resolved}`);
  }
  const current = listMeshLinks(memoryDir);
  if (!current.includes(resolved)) {
    current.push(resolved);
  }
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  const filePath = path.join(memoryDir, MESH_LINKS_FILE);
  fs.writeFileSync(filePath, JSON.stringify({ linked: current, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
  return true;
}

/**
 * Remove an explicit link from .memory/mesh_links.json
 */
export function removeMeshLink(memoryDir: string, targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const current = listMeshLinks(memoryDir);
  const updated = current.filter((p) => p !== resolved);
  const filePath = path.join(memoryDir, MESH_LINKS_FILE);
  if (fs.existsSync(memoryDir)) {
    fs.writeFileSync(filePath, JSON.stringify({ linked: updated, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
  }
  return true;
}

/**
 * Find monorepo root by looking upward for pnpm-workspace.yaml, lerna.json, or package.json with workspaces
 */
export function findMonorepoRoot(startDir: string): { root: string; type: WorkspaceType; patterns: string[] } | null {
  let curr = path.resolve(startDir);
  const rootAnchor = path.parse(curr).root;

  while (curr && curr !== rootAnchor) {
    // 1. pnpm-workspace.yaml
    const pnpmPath = path.join(curr, "pnpm-workspace.yaml");
    if (fs.existsSync(pnpmPath)) {
      const content = fs.readFileSync(pnpmPath, "utf-8");
      const patterns: string[] = [];
      const lines = content.split("\n");
      let inPackages = false;
      for (const line of lines) {
        if (/^packages:/.test(line)) {
          inPackages = true;
          continue;
        }
        if (inPackages) {
          const match = line.match(/^\s*-\s*['"]?([^'"]+)['"]?/);
          if (match) patterns.push(match[1]);
          else if (/^\S/.test(line)) break;
        }
      }
      return { root: curr, type: "pnpm", patterns: patterns.length > 0 ? patterns : ["packages/*"] };
    }

    // 2. lerna.json
    const lernaPath = path.join(curr, "lerna.json");
    if (fs.existsSync(lernaPath)) {
      try {
        const lerna = JSON.parse(fs.readFileSync(lernaPath, "utf-8"));
        const patterns = Array.isArray(lerna.packages) ? lerna.packages : ["packages/*"];
        return { root: curr, type: "lerna", patterns };
      } catch {
        return { root: curr, type: "lerna", patterns: ["packages/*"] };
      }
    }

    // 3. package.json with workspaces
    const pkgPath = path.join(curr, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces) {
          const patterns = Array.isArray(pkg.workspaces)
            ? pkg.workspaces
            : Array.isArray(pkg.workspaces.packages)
            ? pkg.workspaces.packages
            : ["packages/*"];
          const isBun = fs.existsSync(path.join(curr, "bun.lockb")) || fs.existsSync(path.join(curr, "bunfig.toml"));
          return { root: curr, type: isBun ? "bun" : "npm", patterns };
        }
      } catch {
        // continue search upward
      }
    }

    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }

  return null;
}

/**
 * Expands glob-like package patterns (e.g., 'packages/*', 'apps/*', 'backend/modules/*')
 */
function resolvePackageDirs(rootDir: string, patterns: string[]): string[] {
  const dirs: string[] = [];

  for (const pat of patterns) {
    const cleanPat = pat.replace(/[\/\*]+$/, "");
    const baseDir = path.resolve(rootDir, cleanPat);
    if (!fs.existsSync(baseDir)) continue;

    const stat = fs.statSync(baseDir);
    if (!stat.isDirectory()) continue;

    if (pat.endsWith("/*") || pat.endsWith("/**")) {
      const subEntries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const ent of subEntries) {
        if (ent.isDirectory() && !ent.name.startsWith(".")) {
          const subPath = path.join(baseDir, ent.name);
          dirs.push(subPath);
        }
      }
    } else {
      dirs.push(baseDir);
    }
  }

  return Array.from(new Set(dirs));
}

/**
 * Inspect a directory and build a MeshNode description
 */
export function inspectNode(dirPath: string, nodeType: MeshNodeType, currentDir: string): MeshNode {
  const absPath = path.resolve(dirPath);
  const isCurrent = absPath === path.resolve(currentDir);
  let name = path.basename(absPath);
  const dependencies: string[] = [];

  const pkgPath = path.join(absPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (typeof pkg.name === "string") name = pkg.name;
      if (pkg.dependencies && typeof pkg.dependencies === "object") {
        dependencies.push(...Object.keys(pkg.dependencies));
      }
      if (pkg.devDependencies && typeof pkg.devDependencies === "object") {
        dependencies.push(...Object.keys(pkg.devDependencies));
      }
    } catch {
      // fallback to basename
    }
  }

  const memoryDir = path.join(absPath, ".memory");
  const hasStore = fs.existsSync(memoryDir);

  return {
    id: name,
    name,
    path: absPath,
    nodeType,
    memoryDir,
    hasStore,
    dependencies,
    isCurrent,
  };
}

/**
 * Discover full workspace and cross-project mesh topology
 */
export function discoverWorkspaceMesh(currentDir: string, currentMemoryDir: string): MeshTopology {
  const resolvedCurrent = path.resolve(currentDir);
  const monorepo = findMonorepoRoot(resolvedCurrent);
  const nodes: MeshNode[] = [];
  const visitedPaths = new Set<string>();

  let rootPath = resolvedCurrent;
  let isMonorepo = false;
  let workspaceType: WorkspaceType = "none";

  if (monorepo) {
    rootPath = monorepo.root;
    isMonorepo = true;
    workspaceType = monorepo.type;

    // Add monorepo root node
    const rootNode = inspectNode(monorepo.root, "monorepo_root", resolvedCurrent);
    nodes.push(rootNode);
    visitedPaths.add(rootNode.path);

    // Discover package nodes
    const pkgDirs = resolvePackageDirs(monorepo.root, monorepo.patterns);
    for (const pkgDir of pkgDirs) {
      if (!visitedPaths.has(pkgDir)) {
        nodes.push(inspectNode(pkgDir, "package", resolvedCurrent));
        visitedPaths.add(pkgDir);
      }
    }
  } else {
    // Check if standalone or part of multi-repo sibling group
    const rootNode = inspectNode(resolvedCurrent, "standalone", resolvedCurrent);
    nodes.push(rootNode);
    visitedPaths.add(rootNode.path);

    // Inspect parent directory for sibling git repositories
    const parentDir = path.dirname(resolvedCurrent);
    if (parentDir && parentDir !== resolvedCurrent) {
      try {
        const siblings = fs.readdirSync(parentDir, { withFileTypes: true });
        for (const sib of siblings) {
          if (sib.isDirectory() && !sib.name.startsWith(".")) {
            const sibPath = path.join(parentDir, sib.name);
            if (sibPath !== resolvedCurrent && !visitedPaths.has(sibPath)) {
              const hasGit = fs.existsSync(path.join(sibPath, ".git"));
              const hasPkg = fs.existsSync(path.join(sibPath, "package.json"));
              const hasMem = fs.existsSync(path.join(sibPath, ".memory"));
              if (hasGit || hasPkg || hasMem) {
                nodes.push(inspectNode(sibPath, "linked_repo", resolvedCurrent));
                visitedPaths.add(sibPath);
                workspaceType = "multi_repo";
              }
            }
          }
        }
      } catch {
        // ignore parent permission issues
      }
    }
  }

  // Add explicitly linked paths from mesh_links.json
  const explicitLinks = listMeshLinks(currentMemoryDir);
  for (const linkPath of explicitLinks) {
    if (!visitedPaths.has(linkPath) && fs.existsSync(linkPath)) {
      nodes.push(inspectNode(linkPath, "linked_repo", resolvedCurrent));
      visitedPaths.add(linkPath);
    }
  }

  return {
    rootPath,
    isMonorepo,
    workspaceType,
    nodes,
    linkedPaths: explicitLinks,
    updatedAt: new Date().toISOString(),
  };
}
