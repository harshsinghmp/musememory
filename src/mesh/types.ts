import type { MemoryEntry } from "../types.ts";

export type MeshNodeType = "monorepo_root" | "package" | "linked_repo" | "standalone";

export type WorkspaceType = "pnpm" | "npm" | "bun" | "lerna" | "multi_repo" | "none";

export interface MeshNode {
  id: string;
  name: string;
  path: string;
  nodeType: MeshNodeType;
  memoryDir: string;
  hasStore: boolean;
  dependencies: string[];
  isCurrent: boolean;
}

export interface MeshTopology {
  rootPath: string;
  isMonorepo: boolean;
  workspaceType: WorkspaceType;
  nodes: MeshNode[];
  linkedPaths: string[];
  updatedAt: string;
}

export interface MeshQueryResult {
  memory: MemoryEntry;
  sourceNode: {
    id: string;
    name: string;
    path: string;
  };
  score: number;
  originProject: string;
}

export interface MeshContractItem {
  sourcePackage: string;
  targetPackage: string;
  symbol: string;
  status: "valid" | "missing" | "drifted";
  detail: string;
}

export interface MeshContractAuditResult {
  total_contracts_checked: number;
  valid_contracts: number;
  broken_contracts: number;
  items: MeshContractItem[];
  summary: string;
}
