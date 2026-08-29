import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { list, slugifyId as slugify, type Store } from "../store.ts";
import { clusterByTokenOverlap, dominantTopicTokens, entryTokens, tokenBag, cosineSimilarity } from "../compounding/cluster.ts";
import { extractEntitiesFromText } from "../entities/extractor.ts";
import { tokenize } from "../retrieval.ts";
import type { MemoryEntry, MemoryType } from "../types.ts";
import type { WikiCompileOptions, CompileResult, WikiPage, ConceptPage, EntityPage, IndexPage, LogPage, LogEntry, ListWikiPagesOptions } from "./types.ts";
import { renderConceptPage, renderEntityPage, renderIndexPage, renderLogPage } from "./render.ts";

const DEFAULT_MIN_CLUSTER_SIZE = 3;
const DEFAULT_CLUSTERING_THRESHOLD = 0.5;
const CONCEPT_OVERLAP_THRESHOLD = 0.3;
const ENTITY_TYPES = ["person", "product", "organization", "file", "concept"] as const;

export function compileWiki(
  store: Store,
  memoryDir: string,
  options: WikiCompileOptions = {},
): CompileResult {
  const project = options.project;
  const dryRun = options.dryRun ?? false;
  const minClusterSize = options.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE;
  const clusteringThreshold = options.clusteringThreshold ?? DEFAULT_CLUSTERING_THRESHOLD;
  const includeTypes = options.includeTypes ?? [
    "fix", "decision", "architecture", "operation", "failure", "constraint", "preference", "discovery"
  ];

  const allMemories = list(store).filter((e) => 
    e.status === "confirmed" && includeTypes.includes(e.type ?? "discovery")
  );

  if (project) {
    const filtered = allMemories.filter((e) => e.project === project);
    if (filtered.length === 0) {
      return { pagesCreated: [], pagesUpdated: [], logEntries: [], errors: [`No confirmed memories found for project: ${project}`] };
    }
  }

  const memories = project ? allMemories.filter((e) => e.project === project) : allMemories;
  const wikiDir = join(memoryDir, "wiki");
  const conceptsDir = join(wikiDir, "concepts");
  const entitiesDir = join(wikiDir, "entities");

  if (!dryRun) {
    mkdirSync(conceptsDir, { recursive: true });
    mkdirSync(entitiesDir, { recursive: true });
  }

  const result: CompileResult = { pagesCreated: [], pagesUpdated: [], logEntries: [], errors: [] };
  const existingConcepts = loadExistingConcepts(conceptsDir);
  const existingEntities = loadExistingEntities(entitiesDir);
  const conceptMap = new Map<string, ConceptPage>();
  const entityMap = new Map<string, EntityPage>();

  // Stage 1: Cluster memories by project + type + token overlap
  const groups = new Map<string, MemoryEntry[]>();
  for (const e of memories) {
    const key = `${e.project}|${e.type ?? "unknown"}`;
    const group = groups.get(key);
    if (group) group.push(e);
    else groups.set(key, [e]);
  }

  // Stage 2: Build concept pages from clusters
  for (const [, groupMemories] of groups) {
    const clusters = clusterByTokenOverlap(groupMemories, entryTokens, clusteringThreshold);
    
    for (const cluster of clusters) {
      if (cluster.length < minClusterSize) continue;
      
      const topic = dominantTopicTokens(cluster.map((e) => e.title));
      const slug = slugify(topic.join("-") || (cluster[0].type ?? "concept"));
      
      const existing = existingConcepts.get(slug);
      const conceptPage = buildConceptPage(cluster, topic, slug, existing);
      
      if (existing) {
        result.pagesUpdated.push(conceptPage);
        result.logEntries.push({
          timestamp: new Date().toISOString(),
          action: "updated",
          pageSlug: slug,
          memoryIds: cluster.map((e) => e.id),
          details: `Updated concept from ${cluster.length} memories`,
        });
      } else {
        result.pagesCreated.push(conceptPage);
        result.logEntries.push({
          timestamp: new Date().toISOString(),
          action: "created",
          pageSlug: slug,
          memoryIds: cluster.map((e) => e.id),
          details: `Created concept from ${cluster.length} memories`,
        });
      }
      conceptMap.set(slug, conceptPage);
    }
  }

  // Stage 3: Cross-link concepts by token overlap
  crossLinkConcepts(conceptMap);

  // Stage 4: Extract entities from memories
  const extractedEntities = extractEntities(memories);
  for (const [slug, entity] of extractedEntities) {
    const existing = existingEntities.get(slug);
    if (existing) {
      // Merge with existing
      entity.memoryRefs = Array.from(new Set([...(existing.memoryRefs ?? []), ...(entity.memoryRefs ?? [])]));
      entity.mentions = [...(existing.mentions ?? []), ...(entity.mentions ?? [])].slice(-50); // Keep last 50
      result.pagesUpdated.push(entity);
      result.logEntries.push({
        timestamp: new Date().toISOString(),
        action: "updated",
        pageSlug: slug,
        memoryIds: entity.memoryRefs,
        details: `Updated entity with ${entity.memoryRefs.length} mentions`,
      });
    } else {
      result.pagesCreated.push(entity);
      result.logEntries.push({
        timestamp: new Date().toISOString(),
        action: "created",
        pageSlug: slug,
        memoryIds: entity.memoryRefs,
        details: `Created entity from ${entity.memoryRefs.length} mentions`,
      });
    }
    entityMap.set(slug, entity);
  }

  // Stage 5: Cross-link entities
  crossLinkEntities(entityMap, conceptMap);

  // Stage 6: Build index page
  const indexPage = buildIndexPage(conceptMap, entityMap, project ?? "all");
  result.pagesCreated.push(indexPage);

  // Stage 7: Build log page
  const logPage = buildLogPage(result.logEntries);
  result.pagesCreated.push(logPage);

  // Write pages to disk
  if (!dryRun) {
    writeConceptPages(conceptMap, conceptsDir);
    writeEntityPages(entityMap, entitiesDir);
    writeIndexPage(indexPage, wikiDir);
    writeLogPage(logPage, wikiDir);
  }

  return result;
}

function buildConceptPage(
  cluster: MemoryEntry[],
  topic: string[],
  slug: string,
  existing?: any,
): ConceptPage {
  const clusterProject = cluster[0].project;
  const memoryRefs = cluster.map((e) => e.id);
  const tags = Array.from(new Set(cluster.flatMap((e) => e.tags ?? [])));
  
  const content = cluster.map((e) => 
    `## ${e.title}\n\n${e.content}\n\n*Source: ${e.id}*`
  ).join("\n\n---\n\n");

  const summary = cluster.map((e) => e.content.slice(0, 200)).join(" | ");

  return {
    slug,
    title: topic.length > 0 ? topic.join(" ") : (cluster[0].type ?? "concept"),
    type: "concept" as const,
    project: clusterProject,
    updatedAt: new Date().toISOString(),
    relatedPages: existing?.relatedPages ?? [],
    memoryRefs,
    summary,
    content,
    tags: Array.from(new Set(cluster.flatMap((e) => e.tags ?? []))),
    relatedConcepts: existing?.relatedConcepts ?? [],
    relatedEntities: existing?.relatedEntities ?? [],
  };
}

function crossLinkConcepts(conceptMap: Map<string, ConceptPage>): void {
  const concepts = Array.from(conceptMap.values());
  for (let i = 0; i < concepts.length; i++) {
    for (let j = i + 1; j < concepts.length; j++) {
      const a = concepts[i];
      const b = concepts[j];
      const similarity = cosineSimilarity(
        tokenBag(a.title + " " + a.summary + " " + a.tags.join(" ")),
        tokenBag(b.title + " " + b.summary + " " + b.tags.join(" "))
      );
      if (similarity >= CONCEPT_OVERLAP_THRESHOLD) {
        if (!a.relatedConcepts.includes(b.slug)) a.relatedConcepts.push(b.slug);
        if (!b.relatedConcepts.includes(a.slug)) b.relatedConcepts.push(a.slug);
      }
    }
  }
}

function extractEntities(memories: MemoryEntry[]): Map<string, EntityPage> {
  const entityMap = new Map<string, EntityPage>();
  
  for (const memory of memories) {
    const entities = extractEntitiesFromText(memory.content);
    for (const entity of entities) {
      const slug = slugify(entity.name);
      const existing = entityMap.get(slug);
      if (existing) {
        existing.memoryRefs.push(memory.id);
        existing.mentions.push({ memoryId: memory.id, context: extractContext(memory.content, entity.name) });
      } else {
        entityMap.set(slug, {
          slug,
          title: entity.name,
          type: "entity" as const,
          entityType: entity.type as "person" | "product" | "organization" | "file" | "concept",
          project: memory.project,
          updatedAt: new Date().toISOString(),
          relatedPages: [],
          memoryRefs: [memory.id],
          summary: `${entity.type}: ${entity.name}`,
          content: `## ${entity.name}\n\n**Type:** ${entity.type}\n\n**Mentions:**\n- ${memory.id}: ${extractContext(memory.content, entity.name)}`,
          mentions: [{ memoryId: memory.id, context: extractContext(memory.content, entity.name) }],
          relatedEntities: [],
          relatedConcepts: [],
        });
      }
    }
  }
  return entityMap;
}

function extractContext(text: string, entityName: string): string {
  const idx = text.toLowerCase().indexOf(entityName.toLowerCase());
  if (idx === -1) return text.slice(0, 100);
  const start = Math.max(0, idx - 50);
  const end = Math.min(text.length, idx + entityName.length + 50);
  return "..." + text.slice(start, end) + "...";
}

function crossLinkEntities(entityMap: Map<string, EntityPage>, conceptMap: Map<string, ConceptPage>): void {
  const entities = Array.from(entityMap.values());
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i];
      const b = entities[j];
      // Co-occurrence in same memory
      const commonMemories = a.memoryRefs.filter((id: string) => b.memoryRefs.includes(id));
      if (commonMemories.length >= 2) {
        if (!a.relatedEntities.includes(b.slug)) a.relatedEntities.push(b.slug);
        if (!b.relatedEntities.includes(a.slug)) b.relatedEntities.push(a.slug);
      }
    }
  }
  
  // Link entities to concepts
  for (const entity of entities) {
    for (const concept of conceptMap.values()) {
      const similarity = cosineSimilarity(
        tokenBag(entity.title + " " + entity.summary),
        tokenBag(concept.title + " " + concept.summary + " " + concept.tags.join(" "))
      );
      if (similarity >= CONCEPT_OVERLAP_THRESHOLD) {
        if (!entity.relatedConcepts.includes(concept.slug)) entity.relatedConcepts.push(concept.slug);
        if (!concept.relatedEntities.includes(entity.slug)) concept.relatedEntities.push(entity.slug);
      }
    }
  }
}

function buildIndexPage(conceptMap: Map<string, ConceptPage>, entityMap: Map<string, EntityPage>, project: string): IndexPage {
  const concepts = Array.from(conceptMap.values());
  const entities = Array.from(entityMap.values());
  
  return {
    slug: "index",
    title: "Knowledge Base Index",
    type: "index" as const,
    project: project || "all",
    updatedAt: new Date().toISOString(),
    relatedPages: [],
    memoryRefs: [],
    sections: [
      {
        title: "Concepts",
        type: "concepts" as const,
        items: concepts.map((c) => c.slug),
      },
      {
        title: "Entities",
        type: "entities" as const,
        items: entities.map((e) => e.slug),
      },
      {
        title: "By Type",
        type: "by-type" as const,
        items: Array.from(new Set(concepts.map((c) => c.type))).map((t) => `type:${t}`),
      },
    ],
  };
}

function buildLogPage(logEntries: LogEntry[]): LogPage {
  return {
    slug: "log",
    title: "Compilation Log",
    type: "log" as const,
    project: "all",
    updatedAt: new Date().toISOString(),
    relatedPages: [],
    memoryRefs: [],
    entries: logEntries,
  };
}

function loadExistingConcepts(dir: string): Map<string, ConceptPage> {
  const map = new Map<string, ConceptPage>();
  if (!existsSync(dir)) return map;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const slug = file.slice(0, -3);
    try {
      const content = readFileSync(join(dir, file), "utf8");
      const frontmatter = parseFrontmatter(content);
      map.set(slug, { ...frontmatter, slug, content: content.slice(content.indexOf("\n---\n") + 5) } as ConceptPage);
    } catch {}
  }
  return map;
}

function loadExistingEntities(dir: string): Map<string, EntityPage> {
  const map = new Map<string, EntityPage>();
  if (!existsSync(dir)) return map;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const slug = file.slice(0, -3);
    try {
      const content = readFileSync(join(dir, file), "utf8");
      const frontmatter = parseFrontmatter(content);
      map.set(slug, { ...frontmatter, slug, content: content.slice(content.indexOf("\n---\n") + 5) } as EntityPage);
    } catch {}
  }
  return map;
}

function parseFrontmatter(content: string): any {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const lines = match[1].split("\n");
  const obj: any = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      obj[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return obj;
}

function writeConceptPages(map: Map<string, ConceptPage>, dir: string): void {
  for (const [slug, page] of map) {
    const content = renderConceptPage(page);
    writeFileSync(join(dir, slug + ".md"), content, "utf8");
  }
}

function writeEntityPages(map: Map<string, EntityPage>, dir: string): void {
  for (const [slug, page] of map) {
    const content = renderEntityPage(page);
    writeFileSync(join(dir, slug + ".md"), content, "utf8");
  }
}

function writeIndexPage(page: IndexPage, dir: string): void {
  const content = renderIndexPage(page);
  writeFileSync(join(dir, "index.md"), content, "utf8");
}

function writeLogPage(page: LogPage, dir: string): void {
  const content = renderLogPage(page);
  writeFileSync(join(dir, "log.md"), content, "utf8");
}

function applyDetailLevel(page: WikiPage, detailLevel: "l1" | "full"): WikiPage {
  if (detailLevel === "l1") {
    if (page.type === "concept" || page.type === "entity") {
      return { ...page, content: "" };
    }
  }
  return page;
}

export function listWikiPages(
  memoryDir: string,
  options: ListWikiPagesOptions = {},
): WikiPage[] {
  const wikiDir = join(memoryDir, "wiki");
  const pages: WikiPage[] = [];
  const detailLevel = options.detailLevel ?? "full";

  if (options.type === undefined || options.type === "concept") {
    const concepts = loadExistingConcepts(join(wikiDir, "concepts"));
    for (const page of concepts.values()) {
      if (!options.project || page.project === options.project) {
        pages.push(applyDetailLevel(page, detailLevel));
      }
    }
  }

  if (options.type === undefined || options.type === "entity") {
    const entities = loadExistingEntities(join(wikiDir, "entities"));
    for (const page of entities.values()) {
      if (!options.project || page.project === options.project) {
        pages.push(applyDetailLevel(page, detailLevel));
      }
    }
  }

  if (options.type === undefined || options.type === "index") {
    const idxPath = join(wikiDir, "index.md");
    if (existsSync(idxPath)) {
      try {
        const raw = readFileSync(idxPath, "utf8");
        const fm = parseFrontmatter(raw);
        pages.push(applyDetailLevel({ ...fm, slug: "index", type: "index", content: raw }, detailLevel));
      } catch {}
    }
  }

  if (options.type === undefined || options.type === "log") {
    const logPath = join(wikiDir, "log.md");
    if (existsSync(logPath)) {
      try {
        const raw = readFileSync(logPath, "utf8");
        const fm = parseFrontmatter(raw);
        pages.push(applyDetailLevel({ ...fm, slug: "log", type: "log", content: raw }, detailLevel));
      } catch {}
    }
  }

  return pages;
}

export function getWikiPage(
  memoryDir: string,
  slug: string,
  type?: "concept" | "entity" | "index" | "log",
  detailLevel: "l1" | "full" = "full",
): WikiPage | null {
  const wikiDir = join(memoryDir, "wiki");

  if (slug === "index") {
    const p = join(wikiDir, "index.md");
    if (existsSync(p)) {
      const raw = readFileSync(p, "utf8");
      const fm = parseFrontmatter(raw);
      return applyDetailLevel({ ...fm, slug: "index", type: "index", content: raw }, detailLevel);
    }
    return null;
  }

  if (slug === "log") {
    const p = join(wikiDir, "log.md");
    if (existsSync(p)) {
      const raw = readFileSync(p, "utf8");
      const fm = parseFrontmatter(raw);
      return applyDetailLevel({ ...fm, slug: "log", type: "log", content: raw }, detailLevel);
    }
    return null;
  }

  if (!type || type === "concept") {
    const p = join(wikiDir, "concepts", `${slug}.md`);
    if (existsSync(p)) {
      const raw = readFileSync(p, "utf8");
      const fm = parseFrontmatter(raw);
      return applyDetailLevel({ ...fm, slug, type: "concept", content: raw }, detailLevel);
    }
  }

  if (!type || type === "entity") {
    const p = join(wikiDir, "entities", `${slug}.md`);
    if (existsSync(p)) {
      const raw = readFileSync(p, "utf8");
      const fm = parseFrontmatter(raw);
      return applyDetailLevel({ ...fm, slug, type: "entity", content: raw }, detailLevel);
    }
  }

  return null;
}

/**
 * Ensures the wiki directory structure and default index/log pages exist.
 */
export function ensureWikiStructure(memoryDir: string): void {
  const wikiDir = join(memoryDir, "wiki");
  const conceptsDir = join(wikiDir, "concepts");
  const entitiesDir = join(wikiDir, "entities");
  if (!existsSync(conceptsDir)) mkdirSync(conceptsDir, { recursive: true });
  if (!existsSync(entitiesDir)) mkdirSync(entitiesDir, { recursive: true });

  const indexPath = join(wikiDir, "index.md");
  if (!existsSync(indexPath)) {
    const defaultIndex = `# Knowledge Wiki Index\n\n> Compiled Obsidian-compatible concept and entity knowledge base.\n\n## Concepts\n*(No compiled concepts yet)*\n\n## Entities\n*(No named entities extracted yet)*\n`;
    writeFileSync(indexPath, defaultIndex, "utf8");
  }

  const logPath = join(wikiDir, "log.md");
  if (!existsSync(logPath)) {
    const defaultLog = `# Wiki Compilation Log\n\n| Timestamp | Action | Page | Memories | Details |\n|---|---|---|---|---|\n`;
    writeFileSync(logPath, defaultLog, "utf8");
  }
}

/**
 * Automatically compiles the wiki if confirmed memories exist, keeping it fresh.
 */
export function autoCompileWiki(store: Store, memoryDir: string, options: WikiCompileOptions = {}): CompileResult {
  ensureWikiStructure(memoryDir);
  return compileWiki(store, memoryDir, options);
}