# PageIndex MCP Tools Architecture Design

## Overview
Adopt PageIndex capabilities as native MCP tools in musememory's MCP server (`mcp.ts`). Add 3 new tools + disconnect capability. No external dependency — implements PageIndex-style tree indexing and reasoning retrieval natively.

## New MCP Tools

### 1. `memory_pageindex_index`
Build a tree index from a document or text content.

```typescript
{
  name: "memory_pageindex_index",
  description: "Build a PageIndex-style tree index from document/text for reasoning-based retrieval",
  inputSchema: {
    type: "object",
    properties: {
      content: { 
        type: "string", 
        description: "Document text content or file path (max 10MB)",
        maxLength: 10_485_760  // 10MB
      },
      project: { type: "string", description: "Project to associate the index with" },
      title: { type: "string", description: "Optional title for the index" },
      maxDepth: { type: "number", description: "Max tree depth (default: 5)", default: 5 },
      dryRun: { type: "boolean", description: "Preview without persisting", default: false }
    },
    required: ["content", "project"]
  }
}
```

**Rate Limits:**
- Max 10 index builds per minute per project
- Max content size: 10MB
- Max concurrent builds: 2 per project

**Response:**
```json
{
  "indexId": "idx_1700000001000_react-docs",
  "title": "React Documentation",
  "project": "musememory",
  "nodes": 47,
  "depth": 4,
  "builtAt": "2026-08-28T10:30:00Z",
  "preview": { "root": "React Documentation", "children": ["Components", "Hooks", "Server Components"] }
}
```

### 2. `memory_pageindex_search`
Search a tree index using reasoning-based retrieval.

```typescript
{
  name: "memory_pageindex_search",
  description: "Search a PageIndex tree index with reasoning-based retrieval",
  inputSchema: {
    type: "object",
    properties: {
      indexId: { type: "string", description: "Tree index ID to search" },
      query: { type: "string", description: "Search query" },
      maxDepth: { type: "number", default: 5 },
      maxNodes: { type: "number", default: 50 },
      disclosureDepth: { type: "string", enum: ["L1", "L2", "L3"], default: "L2" },
      tokenBudget: { type: "number" }
    },
    required: ["indexId", "query"]
  }
}
```

**Rate Limits:**
- Max 100 searches per minute per project
- Max token budget: 10,000

**Response:**
```json
{
  "results": [
    {
      "nodeId": "node_1",
      "title": "Server Components",
      "summary": "React Server Components allow server-only rendering...",
      "path": "React Documentation > Components > Server Components",
      "citations": [{ "doc": "react-docs.md", "page": 12 }],
      "score": 0.92
    }
  ],
  "reasoning": "Query asks about server-only rendering. Tree traversal found 'Server Components' node under 'Components' which explicitly covers server-only rendering patterns.",
  "totalNodesSearched": 47,
  "tokensUsed": 1240
}
```

### 3. `memory_pageindex_import`
Import PageIndex insights as musememory entries.

```typescript
{
  name: "memory_pageindex_import",
  description: "Import PageIndex search results/insights as memory entries",
  inputSchema: {
    type: "object",
    properties: {
      indexId: { type: "string" },
      query: { type: "string" },
      project: { type: "string" },
      type: { type: "string", enum: ["fix", "decision", "architecture", "discovery", "operation", "constraint", "preference"], default: "discovery" },
      confirmed: { type: "boolean", default: false },
      maxResults: { type: "number", default: 5 }
    },
    required: ["indexId", "query", "project"]
  }
}
```

**Rate Limits:**
- Max 20 imports per minute per project

**Response:**
```json
{
  "imported": 3,
  "entries": [
    { "id": "m_1700000003000_fix", "title": "Server Component Hydration Fix" },
    { "id": "m_1700000004000_arch", "title": "Streaming Architecture Decision" }
  ]
}
```

### 4. Disconnect: `memory disconnect pageindex`
Remove PageIndex MCP connection/tools and associated indexes.

```typescript
{
  name: "memory_disconnect_pageindex",
  description: "Disconnect PageIndex MCP tools and remove associated indexes",
  inputSchema: {
    type: "object",
    properties: {
      indexId: { type: "string", description: "Specific index to remove, or omit for all" },
      project: { type: "string", description: "Project scope (default: current)" },
      dryRun: { type: "boolean", default: false }
    }
  }
}
```

**CLI Equivalent:**
```bash
memory disconnect pageindex [--index <id>] [--project <name>] [--dry-run]
```

## Implementation in `mcp.ts`

### Tree Index Storage
- Store tree indices in `.memory/pageindex/<project>/<indexId>.json`
- Reuse `vector.ts` index file pattern
- Include metadata: version, builtAt, node count

### Reasoning Retrieval (Native)
- Initial: Token-based scoring on node summaries (like `vector.ts` but on tree nodes)
- Future: LLM reasoning stub (async, opt-in)
- No external PageIndex dependency required

### Connect/Disconnect Integration
- Add to `connect.ts` disconnect logic
- `disconnectSingleAgent` already exists — extend for "pageindex" pseudo-agent
- Clean removal of `.memory/pageindex/` files

### Rate Limiting Implementation
```typescript
// In mcp.ts - rate limiter for PageIndex tools
const pageindexRateLimits = new Map<string, { count: number; resetAt: number }>();

function checkPageindexRateLimit(project: string, tool: string): boolean {
  const key = `${project}:${tool}`;
  const now = Date.now();
  const limit = pageindexRateLimits.get(key);
  
  const limits = {
    'memory_pageindex_index': { max: 10, windowMs: 60_000 },
    'memory_pageindex_search': { max: 100, windowMs: 60_000 },
    'memory_pageindex_import': { max: 20, windowMs: 60_000 },
  };
  
  const config = limits[tool];
  if (!config) return true;
  
  if (!limit || now > limit.resetAt) {
    pageindexRateLimits.set(key, { count: 1, resetAt: now + config.windowMs });
    return true;
  }
  
  if (limit.count >= config.max) return false;
  
  limit.count++;
  return true;
}
```

## Configuration
```typescript
interface PageIndexMCPConfig {
  enabled: boolean;              // Default: true
  maxIndexesPerProject: number;  // Default: 100
  maxDepth: number;              // Default: 5
  enableLLMReasoning: boolean;   // Default: false
  reasoningModel?: string;       // LLM for reasoning (optional)
  localMode: boolean;            // true = local, false = cloud (needs API key)
  storagePath: string;           // Default: "pageindex"
  // Rate limits
  rateLimitIndexPerMin: number;  // Default: 10
  rateLimitSearchPerMin: number; // Default: 100
  rateLimitImportPerMin: number; // Default: 20
  maxContentSizeBytes: number;   // Default: 10_485_760 (10MB)
}
```

## Security
- Vibeguard secret scan on all input content
- No external API calls in critical path
- Local-only processing
- Rate limiting prevents DoS
- Max content size enforcement
- Path traversal protection on `storagePath`