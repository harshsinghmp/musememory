import type { GlobalSettings, SettingsStore } from "./types.ts";

export const DEFAULT_SETTINGS: GlobalSettings = {
  version: 1,
  retrieval: {
    defaultMode: "hybrid",
    defaultTokenBudget: 2000,
    defaultDisclosureDepth: "L2",
    treeMaxDepth: 5,
    enableLLMReasoning: false,
    hybridVectorWeight: 0.5,
    hybridTreeWeight: 0.5,
  },
  wiki: {
    autoCompile: false,
    compileIntervalMinutes: 60,
    minClusterSize: 3,
    clusteringThreshold: 0.5,
    conceptOverlapThreshold: 0.3,
    includeTypes: ["fix", "decision", "architecture", "operation", "failure", "constraint", "preference", "discovery"],
    outputDir: "wiki",
    incremental: true,
  },
  entities: {
    autoExtract: false,
    minMentionsForPage: 2,
    cooccurrenceThreshold: 2,
    enabledTypes: ["person", "product", "organization", "file", "concept"],
    customPatterns: {},
    aliasMap: {},
  },
  pageindex: {
    enabled: true,
    maxIndexesPerProject: 100,
    maxDepth: 5,
    enableLLMReasoning: false,
    localMode: true,
    storagePath: "pageindex",
  },
  ui: {
    defaultMode: "graph",
    graphLayout: "force",
    graphEngine: "auto",
    theme: "auto",
    animationEnabled: true,
    sidebarWidth: 380,
    detailPaneWidth: 420,
    autoRefresh: true,
    refreshIntervalMs: 30000,
  },
  mcp: {
    enabledTools: [],
    pageindexEnabled: true,
    autoConnectAgents: false,
    defaultProject: "default",
    permissionsAutoApprove: false,
  },
  skills: {
    autoDistill: false,
    minCount: 3,
    outputDir: ".agents/skills",
    dryRunByDefault: true,
  },
  imports: {
    allowedProviders: ["agentmemory", "beads", "mem0", "letta", "everos"],
    secretScanEnabled: true,
    overwriteByDefault: false,
    dryRunByDefault: true,
  },
  commands: {
    defaultProject: "default",
    confirmPrompt: true,
    verboseByDefault: false,
    outputFormat: "table",
  },
};

export const DEFAULT_SETTINGS_STORE: SettingsStore = {
  version: 1,
  global: DEFAULT_SETTINGS,
  projects: {},
};
