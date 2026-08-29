---
name: muse-graph
description: AST code-aware symbol graph investigation and indexing. Integrates CodeGraph and Graphify to map codebase identifiers, auto-tag memories, and rank symbol-matching decisions with graph overlap bonuses.
---

# 🌐 Muse Graph (`muse-graph`)

> **When to use**: Execute during deep codebase investigation, refactoring critical classes/modules, or diagnosing complex bugs where symbol-level architectural context is required.

---

## 🚀 Execution Workflow

### Step 1: Check & Index AST Symbol Graph
Verify provider status or build the cached AST symbol map:
- Call `graph_status` MCP tool to check provider availability (`.codegraph` or `.graphify`).
- Call `graph_index` MCP tool (or run `memory graph index`) to compile a fresh symbol map in `.memory/graph-symbols.json`.

```json
{}
```

### Step 2: Code-Aware Retrieval Queries
When querying memories for a specific function, class, or type, include the exact identifier name in your query:

```json
{
  "query": "queryContext knapsack token scoring formula in retrieval.ts",
  "project": "my-project",
  "token_budget": 1500
}
```

### Step 3: Multi-Factor AST Overlap Scoring Bonus
The retrieval engine matches query tokens against indexed symbols (`entry.graph.symbol_names`), awarding up to **+0.2 graph bonus**:

$$\text{Score} = 1.0 \times \text{Applicability} + \text{StatusBonus} + \text{VerificationBonus} + \mathbf{GraphBonus (+0.2)} + \text{TimeDecay}$$

Symbol-matching architectural decisions and past fixes rank above generic prose matching.

---

## 🛡️ Invariant Rules for Agents

- **Opt-In & Non-Blocking**: If no AST graph provider is installed, memory queries and captures fall back gracefully with zero behavioral disruption.
- **Affected Paths**: Inspect `entry.graph.affected_paths` to discover related files that may be impacted by a refactor.

---

## 💻 CLI Equivalents (Zero-MCP Fallback)

```bash
# Check provider status (provider type, availability, revision, symbol count)
memory graph status

# Index codebase AST symbols and cache to .memory/graph-symbols.json
memory graph index

# Search with symbol terms
memory search "queryContext" --token-budget 1500
```
