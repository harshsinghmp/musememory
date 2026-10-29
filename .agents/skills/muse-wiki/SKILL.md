---
name: muse-wiki
description: Obsidian-compatible knowledge compounding and entity graph generation. Compiles confirmed memories into interlinked Markdown concept pages and tracks named entity co-occurrences.
---

# 📚 Muse Wiki (`muse-wiki`)

> **When to use**: Execute at milestone completion, weekly review, or when synthesizing scattered memory units into a structured, readable documentation wiki.

---

## 🚀 Execution Workflow

### Step 1: Compile Knowledge Wiki
Call the `memory_wiki_compile` MCP tool (or run `memory wiki compile`):

```json
{
  "project": "my-project",
  "min_cluster_size": 2
}
```

This compiles confirmed memories into structured Obsidian Markdown files in `.memory/wiki/`:
- **Concept Pages (`wiki/concepts/`)**: Clustered architectural concepts with bidirectional `[[concept-slug]]` wikilinks.
- **Entity Pages (`wiki/entities/`)**: Extracted tools, frameworks, components, and libraries.
- **Master Index (`wiki/index.md`)**: Table of contents mapping all domain topics.

### Step 2: Query Wiki Concepts & Entity Graph
- Call `memory_wiki_search` / `memory_wiki_get` to read synthesized domain documentation.
- Call `memory_entities_search` / `memory_entities_get` to inspect entity co-occurrence networks (e.g. which libraries are frequently paired with specific architectures).

---

## 🛡️ Invariant Rules for Agents

- **Confirmed Only**: Only `confirmed` memories are compiled into wiki pages to guarantee high signal and prevent draft noise.
- **Dual Persistence**: Wiki pages are plain Markdown files with YAML frontmatter, fully editable in Obsidian, VS Code, or Cursor.

---

## 💻 CLI Equivalents (Zero-MCP Fallback)

```bash
# Compile confirmed memories into Obsidian-compatible wiki
memory wiki compile

# List compiled wiki pages
memory wiki list

# Read a specific concept page
memory wiki show auth-patterns

# Inspect entity relationships
memory entities show nextjs
memory entities related nextjs
```
