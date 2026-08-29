# Global Settings Module Architecture Design

## Overview
New `src/settings.ts` module providing unified configuration for all musememory adjustable options. Replaces scattered config with single source of truth.

## Goals
- Single configuration surface for retrieval, wiki, entities, pageindex, UI, MCP, skills, imports, commands
- Global (user-level) and project-level overrides
- Hot-reload without restart
- Type-safe with validation
- Import/Export for team sharing

## Settings Schema

```typescript
// src/settings.ts

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
  hybridVectorWeight: number;      // 0-1, weight for vector.ts in hybrid
  hybridTreeWeight: number;        // 0-1, weight for tree-index in hybrid
}

export interface WikiSettings {
  autoCompile: boolean;
  compileIntervalMinutes: number;
  minClusterSize: number;
  clusteringThreshold: number;
  conceptOverlapThreshold: number;
  includeTypes: MemoryType[];
  outputDir: string;               // Relative to .memory/
  incremental: boolean;
}

export interface EntitySettings {
  autoExtract: boolean;
  minMentionsForPage: number;
  cooccurrenceThreshold: number;
  enabledTypes: EntityType[];
  customPatterns: Record<string, string>;  // Regex as strings
  aliasMap: Record<string, string>;
}

export interface PageIndexSettings {
  enabled: boolean;
  maxIndexesPerProject: number;
  maxDepth: number;
  enableLLMReasoning: boolean;
  reasoningModel?: string;
  localMode: boolean;              // true = local, false = cloud (needs API key)
  storagePath: string;
}

export interface UISettings {
  defaultMode: "tree" | "graph" | "timeline" | "cluster";
  graphLayout: GraphLayout;
  graphEngine: GraphEngine;        // NEW: scaling engine
  theme: Theme;
  animationEnabled: boolean;
  sidebarWidth: number;
  detailPaneWidth: number;
  autoRefresh: boolean;
  refreshIntervalMs: number;
}

export interface MCPSettings {
  enabledTools: string[];          // Tool allowlist (subset of ALL_MEMORY_TOOLS)
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
  allowedProviders: string[];      // Subset of 24+ providers
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
  global: GlobalSettings;
  projects: Record<string, ProjectSettings>;
}
```

## Validation Rules

```typescript
// src/settings/schema.ts
import { z } from "zod";  // or AJV if preferred

export const RetrievalSettingsSchema = z.object({
  defaultMode: z.enum(["tree", "vector", "hybrid"]),
  defaultTokenBudget: z.number().int().positive().max(100_000),
  defaultDisclosureDepth: z.enum(["L1", "L2", "L3"]),
  treeMaxDepth: z.number().int().positive().max(20),
  enableLLMReasoning: z.boolean(),
  hybridVectorWeight: z.number().min(0).max(1),
  hybridTreeWeight: z.number().min(0).max(1),
}).refine(
  (data) => Math.abs(data.hybridVectorWeight + data.hybridTreeWeight - 1.0) < 0.001,
  { message: "hybridVectorWeight + hybridTreeWeight must equal 1.0", path: ["hybridVectorWeight"] }
);

export const WikiSettingsSchema = z.object({
  autoCompile: z.boolean(),
  compileIntervalMinutes: z.number().int().positive().max(10_080),  // max 1 week
  minClusterSize: z.number().int().positive().max(100),
  clusteringThreshold: z.number().min(0).max(1),
  conceptOverlapThreshold: z.number().min(0).max(1),
  includeTypes: z.array(z.enum([...])).min(1),
  outputDir: z.string().regex(/^[a-z][a-z0-9_-]*$/),  // No path traversal
  incremental: z.boolean(),
});

export const PageIndexSettingsSchema = z.object({
  enabled: z.boolean(),
  maxIndexesPerProject: z.number().int().positive().max(1000),
  maxDepth: z.number().int().positive().max(20),
  enableLLMReasoning: z.boolean(),
  reasoningModel: z.string().optional(),
  localMode: z.boolean(),
  storagePath: z.string().regex(/^[a-z][a-z0-9_-]*$/),  // No path traversal
});

export const UISettingsSchema = z.object({
  defaultMode: z.enum(["tree", "graph", "timeline", "cluster"]),
  graphLayout: z.enum(["force", "circular", "hierarchical"]),
  graphEngine: z.enum(["barnes-hut", "webgl", "auto"]),
  theme: z.enum(["dark", "light", "auto"]),
  animationEnabled: z.boolean(),
  sidebarWidth: z.number().int().min(200).max(800),
  detailPaneWidth: z.number().int().min(200).max(800),
  autoRefresh: z.boolean(),
  refreshIntervalMs: z.number().int().min(5000).max(300_000),
});

export const MCPSettingsSchema = z.object({
  enabledTools: z.array(z.string()),
  pageindexEnabled: z.boolean(),
  autoConnectAgents: z.boolean(),
  defaultProject: z.string().min(1),
  permissionsAutoApprove: z.boolean(),
});

export const GlobalSettingsSchema = z.object({
  version: z.number().int().positive(),
  retrieval: RetrievalSettingsSchema,
  wiki: WikiSettingsSchema,
  entities: EntitySettingsSchema,  // Similar pattern
  pageindex: PageIndexSettingsSchema,
  ui: UISettingsSchema,
  mcp: MCPSettingsSchema,
  skills: SkillSettingsSchema,
  imports: ImportSettingsSchema,
  commands: CommandSettingsSchema,
});
```

## Path Traversal Protection

```typescript
// src/settings/loader.ts

const SAFE_PATH_REGEX = /^[a-z][a-z0-9_-]*$/;

export function validateSafePath(path: string, context: string): void {
  if (!SAFE_PATH_REGEX.test(path)) {
    throw new Error(`${context}: path "${path}" contains invalid characters. Only lowercase alphanumeric, hyphen, underscore allowed.`);
  }
  // Prevent directory traversal
  if (path.includes("..") || path.includes("/") || path.includes("\\")) {
    throw new Error(`${context}: path traversal not allowed`);
  }
}

export function resolveSettingsPath(baseDir: string, relativePath: string): string {
  validateSafePath(relativePath, "Settings path");
  const resolved = join(baseDir, relativePath);
  // Ensure resolved path is within baseDir
  const normalizedBase = resolve(baseDir);
  const normalizedResolved = resolve(resolved);
  if (!normalizedResolved.startsWith(normalizedBase)) {
    throw new Error(`Path traversal detected: ${relativePath}`);
  }
  return normalizedResolved;
}
```

## Default Values

```typescript
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
    enabledTools: [
      "memory_read", "get_context", "search", "memory_capture", "memory_harvest",
      "memory_import_transcript", "memory_search_transcripts",
      "memory_get_user_profile", "memory_set_user_profile", "memory_recall",
      "memory_confirm", "memory_supersede", "memory_link", "memory_mark_stale",
      "memory_reject", "memory_delete", "memory_audit", "memory_detect_providers",
      "memory_migrate", "memory_detect_agents", "memory_export", "memory_import",
      "memory_validate", "graph_status", "memory_core", "memory_consolidate",
      "memory_trace", "memory_loops", "memory_distill", "memory_verify",
      "memory_pageindex_index", "memory_pageindex_search", "memory_pageindex_import"
    ],
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
```

## Settings API

```typescript
// Core functions
export function getSettings(memoryDir?: string): GlobalSettings;
export function getProjectSettings(project: string, memoryDir?: string): ProjectSettings;
export function setSettings(settings: Partial<GlobalSettings>, memoryDir?: string): GlobalSettings;
export function setProjectSettings(project: string, settings: Partial<ProjectSettings>, memoryDir?: string): ProjectSettings;
export function resetSettings(memoryDir?: string): GlobalSettings;
export function resetProjectSettings(project: string, memoryDir?: string): void;

// File operations
export function loadSettings(memoryDir: string): SettingsStore;
export function saveSettings(store: SettingsStore, memoryDir: string): void;
export function exportSettings(memoryDir?: string): string;  // JSON string
export function importSettings(json: string, memoryDir?: string): SettingsStore;

// Validation
export function validateSettings(settings: unknown): { valid: boolean; errors: string[] };

// Hot-reload
export function watchSettings(memoryDir: string, callback: (settings: GlobalSettings) => void): () => void;
```

## CLI Integration

```bash
# Global settings
memory settings get                    # Show all global settings
memory settings get retrieval.defaultMode
memory settings set retrieval.defaultMode tree
memory settings reset                  # Reset to defaults

# Project settings
memory settings get --project musememory
memory settings set wiki.autoCompile true --project musememory

# Import/Export
memory settings export --output team-settings.json
memory settings import team-settings.json [--global]
```

## MCP Integration
- New tool: `memory_settings_get`, `memory_settings_set`
- Agents can read current settings
- Agents can modify settings (with permission)

## File Layout
```
src/
  settings.ts              # Main module
  settings.test.ts
  settings/
    schema.ts              # Zod/AJV schema for validation
    defaults.ts            # Default values
    loader.ts              # File loading/saving + path validation
    watcher.ts             # File watcher for hot-reload
    migration.ts           # Version migration logic
```

## Persistence
- Global: `~/.memory/settings.json`
- Project: `<project>/.memory/settings.json`
- Project settings merge over global (deep merge)
- Version migration on load

## Hot-Reload
- `watchSettings()` returns cleanup function
- Uses `fs.watch` on settings files
- Debounced (100ms) to avoid rapid reloads
- Notifies all listeners with new merged settings

## Migration Framework

```typescript
// src/settings/migration.ts

interface Migration {
  fromVersion: number;
  toVersion: number;
  migrate: (store: SettingsStore) => SettingsStore;
}

const MIGRATIONS: Migration[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    migrate: (store) => ({
      ...store,
      global: {
        ...store.global,
        ui: {
          ...store.global.ui,
          graphEngine: "auto",  // New field in v2
        },
      },
      version: 2,
    }),
  },
];

export function migrateSettings(store: SettingsStore): SettingsStore {
  let current = store;
  for (const migration of MIGRATIONS) {
    if (current.version === migration.fromVersion) {
      current = migration.migrate(current);
    }
  }
  return current;
}
```

## Integration Points
- `retrieval.ts`: Read `retrieval` settings
- `wiki/compiler.ts`: Read `wiki` settings
- `entities/extractor.ts`: Read `entities` settings
- `mcp.ts`: Read `mcp` settings for tool allowlist + rate limits
- `ui.ts`: Read `ui` settings for defaults + graph engine
- `distill.ts`: Read `skills` settings
- `migrator/`: Read `imports` settings