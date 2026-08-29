# Multi-Mode UI + Global Settings Architecture Design

## Overview
Upgrade `ui.ts` from single-mode canvas graph to production-grade multi-mode visualization with global settings panel. Use design-taste approach (clean, intentional, anti-slop).

## Current State (`ui.ts`)
- Single 3D force-directed canvas graph
- Basic sidebar with search/filter
- Detail pane on click
- No export, no settings, single view mode

## Target: Multi-Mode Visualization

### Mode 1: Tree Structure View (PageIndex-style)
```
┌─────────────────────────────────────────────────────┐
│ Search: [________________________]  [Type ▼] [Proj] │
├─────────────────┬───────────────────────────────────┤
│ Tree Nav        │ Detail Pane                       │
│ ├─ 📁 musememory │ # React Server Components       │
│ │  ├─ 📁 fix    │ Status: confirmed               │
│ │  │  ├─ 📄 RSC  │ Tags: [react, architecture]     │
│ │  │  └─ 📄 Hydr │                                  │
│ │  ├─ 📁 arch   │ [Confirm] [Mark Stale] [Link]   │
│ │  └─ 📁 decision│                                 │
│ └─ 📁 personal  │ Content preview...              │
└─────────────────┴───────────────────────────────────┘
```
- Collapsible tree by project → type → memory
- Search filters tree in real-time
- Click node → detail pane

### Mode 2: Graph View (Enhanced Current)
- Force-directed layout (existing, but better)
- Node clustering by project/type/entity
- Multiple layouts: force, circular, hierarchical
- Zoom/pan with minimap
- **Export to standalone HTML** (graphify-style)

### Mode 3: Timeline View
- Horizontal timeline by `created_at` / `updated_at`
- Grouped by project/type
- Filter by date range
- Shows memory lifecycle transitions

### Mode 4: Cluster View
- Auto-cluster by entity/topic (from wiki/entity extraction)
- Bubble chart or grouped force-directed
- Drill-down into clusters

## Graph View Scaling Strategy

### Current Limitation
The existing `ui.ts` uses O(n²) pairwise repulsion in `simulateStep()` (lines 450-485):
```typescript
for (let i = 0; i < nodes3d.length; i++) {
  for (let j = i + 1; j < nodes3d.length; j++) { ... }
}
```
This works for ~500 nodes but degrades severely at 5,000+ nodes.

### Scaling Solutions (Priority Order)

#### 1. Barnes-Hut Quadtree (Recommended for 5k-50k nodes)
- Reduces force calculation from O(n²) to O(n log n)
- Implement quadtree for 2D projection (force calc in 2D, render in 3D)
- Library option: `d3-force` (has Barnes-Hut) or custom implementation

```typescript
// Quadtree-based repulsion
function computeRepulsionBarnesHut(nodes: Node3D[], theta = 0.5): void {
  const quadtree = buildQuadtree(nodes);  // O(n log n)
  for (const node of nodes) {
    const force = quadtree.calculateForce(node, theta);  // O(log n)
    applyForce(node, force);
  }
}
```

#### 2. WebGL/GPU Acceleration (For 50k+ nodes)
- Offload force calculation to GPU via compute shaders
- Use `three.js` or raw WebGL for rendering + compute
- More complex but scales to 100k+ nodes

#### 3. Progressive Rendering (For all scales)
- Render visible nodes first (frustum culling)
- Lazy-load node details on hover/click
- Level-of-detail: distant nodes = smaller/simpler

### Implementation Phases
- **Phase 6a**: Add Barnes-Hut to existing force simulation (5k-50k support)
- **Phase 6b**: Add WebGL renderer option (50k+ support)
- **Phase 6c**: Progressive rendering + LOD

## Global Settings Panel

### Settings Categories
```typescript
interface GlobalSettings {
  retrieval: {
    defaultMode: 'tree' | 'vector' | 'hybrid';
    defaultTokenBudget: number;
    defaultDisclosureDepth: 'L1' | 'L2' | 'L3';
    treeMaxDepth: number;
    enableLLMReasoning: boolean;
  };
  wiki: {
    autoCompile: boolean;
    compileInterval: number;        // minutes
    minClusterSize: number;
    includeTypes: MemoryType[];
  };
  entities: {
    autoExtract: boolean;
    minMentionsForPage: number;
    enabledTypes: EntityType[];
  };
  pageindex: {
    enabled: boolean;
    maxIndexes: number;
    enableLLMReasoning: boolean;
  };
  ui: {
    defaultMode: 'tree' | 'graph' | 'timeline' | 'cluster';
    graphLayout: 'force' | 'circular' | 'hierarchical';
    graphEngine: 'barnes-hut' | 'webgl' | 'auto';  // NEW: scaling engine
    theme: 'dark' | 'light' | 'auto';
    animationEnabled: boolean;
  };
  mcp: {
    enabledTools: string[];         // Tool allowlist
    pageindexEnabled: boolean;
    autoConnectAgents: boolean;
  };
  skills: {
    autoDistill: boolean;
    minCount: number;
    outputDir: string;
  };
  imports: {
    allowedProviders: string[];
    secretScanEnabled: boolean;
  };
  commands: {
    defaultProject: string;
    confirmPrompt: boolean;
  };
}
```

### Settings UI
```
┌────────────────────────────────────────────┐
│ Settings                         [Save]    │
├──────────────┬─────────────────────────────┤
│ ▸ Retrieval  │ Default Mode: [Tree ▼]      │
│ ▸ Wiki       │ Token Budget: [2000 ▼]      │
│ ▸ Entities   │ Disclosure: [L2 ▼]          │
│ ▸ PageIndex  │ Tree Depth: [5]             │
│ ▸ UI         │ Graph Engine: [Auto ▼]      │
│ ▸ MCP        │                             │
│ ▸ Skills     │ [Reset to Defaults]         │
│ ▸ Imports    │                             │
│ ▸ Commands   │                             │
└──────────────┴─────────────────────────────┘
```

- Persisted to `.memory/settings.json`
- Global (user-level) and project-level override
- Hot-reload: changes apply without restart
- Import/Export settings

## Technical Implementation

### UI Architecture
```typescript
// ui.ts - Main server + SPA
// New modules:
src/ui/
  index.ts           # Main export
  server.ts          # HTTP server (existing)
  settings.ts        # Global settings module (new)
  spa/
    index.html       # Main HTML (enhanced)
    modes/
      tree-view.ts   # Tree structure view
      graph-view.ts  # Enhanced graph view (Barnes-Hut)
      timeline-view.ts
      cluster-view.ts
    settings/
      settings-panel.ts
      settings-schema.ts
    shared/
      state.ts       # Global UI state
      api.ts         # API client
      export.ts      # HTML export
```

### State Management
- Centralized store (signals or simple reactive object)
- URL sync: mode, filters, selection in URL hash
- Persist: settings, last mode, window state

### HTML Export (Graphify-style)
- Serialize current graph state to standalone HTML
- Includes: data, layout, styles, interactions
- No server needed to view exported file

## Design Principles (Design-Taste Approach)
- **Clean hierarchy**: Clear visual separation of modes, settings, content
- **Intentional motion**: Smooth transitions between modes, no jank
- **Typography**: System fonts, clear hierarchy (18px title, 14px body, 12px meta)
- **Color**: Semantic color coding (type-based, status-based), WCAG AA contrast
- **Spacing**: 8px base unit, consistent padding/margins
- **Affordances**: Obvious click targets, hover states, keyboard navigation
- **Responsive**: Works at 1024px+, graceful degradation
- **Performance**: 60fps animations, lazy-load modes, virtualized lists

## File Layout
```
src/
  ui/
    index.ts
    server.ts
    settings.ts              # Global settings module
    settings.test.ts
    spa/
      index.html
      modes/
        tree-view.ts
        graph-view.ts
        timeline-view.ts
        cluster-view.ts
      settings/
        settings-panel.ts
      shared/
        state.ts
        api.ts
        export.ts
```

## Configuration Persistence
```json
// .memory/settings.json
{
  "version": 1,
  "global": { ... },
  "projects": {
    "musememory": { ... }
  }
}
```