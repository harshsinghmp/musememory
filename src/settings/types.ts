export type MemoryType = 
  | "session" | "decision" | "fix" | "failure" 
  | "architecture" | "operation" | "constraint" | "preference" | "discovery";

export type EntityType = "person" | "product" | "organization" | "file" | "concept";
export type DisclosureDepth = "L1" | "L2" | "L3";
export type RetrievalMode = "tree" | "vector" | "hybrid";
export type GraphLayout = "force" | "circular" | "hierarchical";
export type Theme = "dark" | "light" | "auto";
export type GraphEngine = "barnes-hut" | "webgl" | "auto";

export interface RetrievalSettings {
  defaultMode: RetrievalMode;
  defaultTokenBudget: number;
  defaultDisclosureDepth: DisclosureDepth;
  treeMaxDepth: number;
  enableLLMReasoning: boolean;
  hybridVectorWeight: number;
  hybridTreeWeight: number;
}

export interface WikiSettings {
  autoCompile: boolean;
  compileIntervalMinutes: number;
  minClusterSize: number;
  clusteringThreshold: number;
  conceptOverlapThreshold: number;
  includeTypes: MemoryType[];
  outputDir: string;
  incremental: boolean;
}

export interface EntitySettings {
  autoExtract: boolean;
  minMentionsForPage: number;
  cooccurrenceThreshold: number;
  enabledTypes: EntityType[];
  customPatterns: Record<string, string>;
  aliasMap: Record<string, string>;
}

export interface PageIndexSettings {
  enabled: boolean;
  maxIndexesPerProject: number;
  maxDepth: number;
  enableLLMReasoning: boolean;
  reasoningModel?: string;
  localMode: boolean;
  storagePath: string;
}

export interface UISettings {
  defaultMode: "tree" | "graph" | "timeline" | "cluster";
  graphLayout: GraphLayout;
  graphEngine: GraphEngine;
  theme: Theme;
  animationEnabled: boolean;
  sidebarWidth: number;
  detailPaneWidth: number;
  autoRefresh: boolean;
  refreshIntervalMs: number;
}

export interface MCPSettings {
  enabledTools: string[];
  pageindexEnabled: boolean;
  autoConnectAgents: boolean;
  defaultProject: string;
  permissionsAutoApprove: boolean;
}

export interface SkillSettings {
  autoDistill: boolean;
  minCount: number;
  outputDir: string;
  dryRunByDefault: boolean;
}

export interface ImportSettings {
  allowedProviders: string[];
  secretScanEnabled: boolean;
  overwriteByDefault: boolean;
  dryRunByDefault: boolean;
}

export interface CommandSettings {
  defaultProject: string;
  confirmPrompt: boolean;
  verboseByDefault: boolean;
  outputFormat: "table" | "json" | "yaml";
}

export interface GlobalSettings {
  version: number;
  retrieval: RetrievalSettings;
  wiki: WikiSettings;
  entities: EntitySettings;
  pageindex: PageIndexSettings;
  ui: UISettings;
  mcp: MCPSettings;
  skills: SkillSettings;
  imports: ImportSettings;
  commands: CommandSettings;
}

export interface ProjectSettings extends Partial<GlobalSettings> {
  project: string;
}

export interface SettingsStore {
  version: number;
  global: GlobalSettings;
  projects: Record<string, ProjectSettings>;
}
