import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { scanSecrets } from "../secrets.ts";
import { tokenize } from "../retrieval.ts";
import type { PageIndexDocument, PageIndexNode, PageIndexSearchResult } from "./types.ts";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function buildPageIndex(
  content: string,
  options: {
    project: string;
    title?: string;
    maxDepth?: number;
    dryRun?: boolean;
    memoryDir?: string;
  },
): PageIndexDocument {
  // 1. Vibeguard secret scan
  const secrets = scanSecrets(content);
  if (secrets.length > 0) {
    throw new Error(`Probable secret detected in PageIndex input: ${secrets.join(", ")}`);
  }

  const project = options.project;
  const title = options.title || content.slice(0, 50).trim() || "Untitled Document";
  const maxDepth = options.maxDepth ?? 5;
  const indexId = `idx_${Date.now()}_${slugify(title) || "doc"}`;
  const now = new Date().toISOString();

  // 2. Parse Markdown/Text into hierarchical sections
  const lines = content.split("\n");
  const rootNode: PageIndexNode = {
    id: "node_root",
    title,
    summary: content.slice(0, 200).trim(),
    content: content.slice(0, 500).trim(),
    path: title,
    depth: 0,
    children: [],
    citations: [{ doc: title, line: 1 }],
  };

  // Stack of { node, level }
  const stack: { node: PageIndexNode; level: number }[] = [{ node: rootNode, level: 0 }];
  let totalNodes = 1;
  let lineNumber = 0;

  for (const line of lines) {
    lineNumber++;
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headerMatch) {
      const level = headerMatch[1].length;
      const hTitle = headerMatch[2].trim();

      // If document has a single top # Title that matches doc title, use root as level 1
      if (level === 1 && stack.length === 1 && (hTitle.toLowerCase() === title.toLowerCase() || title === "Untitled Document")) {
        stack[0].level = 1;
        stack[0].node.title = hTitle;
        continue;
      }

      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      const parent = stack[stack.length - 1].node;
      const childNode: PageIndexNode = {
        id: `node_${totalNodes++}`,
        title: hTitle,
        summary: "",
        content: "",
        path: `${parent.path} > ${hTitle}`,
        depth: Math.min(level, maxDepth),
        children: [],
        citations: [{ doc: title, line: lineNumber }],
      };

      parent.children.push(childNode);
      stack.push({ node: childNode, level });
    } else {
      const current = stack[stack.length - 1].node;
      if (line.trim().length > 0) {
        current.content = (current.content ? current.content + "\n" : "") + line;
        if (!current.summary) {
          current.summary = line.slice(0, 150).trim();
        }
      }
    }
  }

  const doc: PageIndexDocument = {
    id: indexId,
    title,
    project,
    builtAt: now,
    depth: Math.min(stack.length, maxDepth),
    totalNodes,
    root: rootNode,
  };

  // 3. Persist if memoryDir provided and !dryRun
  if (options.memoryDir && !options.dryRun) {
    const dir = join(options.memoryDir, "pageindex", project);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${indexId}.json`), JSON.stringify(doc, null, 2), "utf8");
  }

  return doc;
}

export function searchPageIndex(
  doc: PageIndexDocument,
  options: {
    query: string;
    maxDepth?: number;
    maxNodes?: number;
    disclosureDepth?: "L1" | "L2" | "L3";
    tokenBudget?: number;
  },
): PageIndexSearchResult {
  const query = options.query;
  const maxNodes = options.maxNodes ?? 50;
  const tokenBudget = options.tokenBudget ?? 4000;
  const queryTokens = new Set(tokenize(query));

  const scoredNodes: { node: PageIndexNode; score: number }[] = [];
  let totalNodesSearched = 0;

  function traverse(node: PageIndexNode) {
    totalNodesSearched++;
    const haystack = tokenize(`${node.title} ${node.summary} ${node.content} ${node.path}`);
    const haySet = new Set(haystack);
    let overlap = 0;
    for (const t of queryTokens) {
      if (haySet.has(t)) {
        overlap++;
      } else {
        // Stem / prefix match if token >= 3 chars
        const matchedStem = haystack.some((h) => (h.length >= 3 && t.length >= 3 && (h.startsWith(t.slice(0, 4)) || t.startsWith(h.slice(0, 4)))));
        if (matchedStem) overlap += 0.8;
      }
    }

    const baseScore = queryTokens.size > 0 ? overlap / queryTokens.size : 0;
    const depthBonus = node.depth > 0 ? 0.1 * Math.min(node.depth, 3) : 0;
    const score = baseScore > 0 ? baseScore + depthBonus : 0;

    if (score > 0.05) {
      scoredNodes.push({ node, score });
    }

    for (const child of node.children) {
      traverse(child);
    }
  }

  traverse(doc.root);
  scoredNodes.sort((a, b) => b.score - a.score);

  const matched = scoredNodes.slice(0, maxNodes);
  let tokensUsed = 0;
  const results: PageIndexSearchResult["results"] = [];

  for (const item of matched) {
    const approxTokens = Math.max(10, Math.ceil((item.node.title.length + item.node.summary.length + item.node.content.length) / 4));
    if (tokensUsed + approxTokens > tokenBudget && results.length > 0) break;

    results.push({
      nodeId: item.node.id,
      title: item.node.title,
      summary: item.node.summary || item.node.title,
      path: item.node.path,
      score: Number(item.score.toFixed(2)),
      citations: item.node.citations,
    });
    tokensUsed += approxTokens;
  }

  const topMatch = results[0];
  const reasoning = topMatch
    ? `Query matches "${query}". Tree traversal found relevant node "${topMatch.title}" along path "${topMatch.path}" with relevance score ${topMatch.score}.`
    : `No high-confidence nodes found matching query "${query}".`;

  return {
    results,
    reasoning,
    totalNodesSearched,
    tokensUsed,
  };
}

export function loadPageIndex(
  memoryDir: string,
  project: string,
  indexId: string,
): PageIndexDocument | null {
  const filePath = join(memoryDir, "pageindex", project, `${indexId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as PageIndexDocument;
  } catch {
    return null;
  }
}

export function listPageIndexes(memoryDir: string, project?: string): PageIndexDocument[] {
  const base = join(memoryDir, "pageindex");
  if (!existsSync(base)) return [];

  const results: PageIndexDocument[] = [];
  const projects = project ? [project] : readdirSync(base);

  for (const p of projects) {
    const pDir = join(base, p);
    if (!existsSync(pDir)) continue;
    for (const f of readdirSync(pDir)) {
      if (f.endsWith(".json")) {
        try {
          results.push(JSON.parse(readFileSync(join(pDir, f), "utf8")));
        } catch {}
      }
    }
  }
  return results;
}

export function deletePageIndex(
  memoryDir: string,
  project?: string,
  indexId?: string,
): { deletedCount: number } {
  const base = join(memoryDir, "pageindex");
  if (!existsSync(base)) return { deletedCount: 0 };

  let count = 0;
  if (!project && !indexId) {
    rmSync(base, { recursive: true, force: true });
    return { deletedCount: 1 };
  }

  if (project && !indexId) {
    const pDir = join(base, project);
    if (existsSync(pDir)) {
      rmSync(pDir, { recursive: true, force: true });
      count++;
    }
  } else if (project && indexId) {
    const file = join(base, project, `${indexId}.json`);
    if (existsSync(file)) {
      rmSync(file, { force: true });
      count++;
    }
  }
  return { deletedCount: count };
}
