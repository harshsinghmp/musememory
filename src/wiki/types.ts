import type { MemoryEntry, MemoryType } from "../types.ts";

export interface WikiPageBase {
  slug: string;
  title: string;
  type: "concept" | "entity" | "index" | "log";
  project: string;
  updatedAt: string;
  relatedPages: string[];  // slugs of related pages
  memoryRefs: string[];    // memory IDs that contribute to this page
}

export interface ConceptPage extends WikiPageBase {
  type: "concept";
  summary: string;
  content: string;  // markdown content
  tags: string[];
  relatedConcepts: string[];  // slugs of related concept pages
  relatedEntities: string[];  // slugs of related entity pages
}

export interface EntityPage extends WikiPageBase {
  type: "entity";
  entityType: "person" | "product" | "organization" | "file" | "concept";
  summary: string;
  content: string;
  mentions: { memoryId: string; context: string }[];  // where this entity is mentioned
  relatedEntities: string[];  // slugs of related entity pages
  relatedConcepts: string[];  // slugs of related concept pages
}

export interface IndexPage extends WikiPageBase {
  type: "index";
  project: string;
  sections: IndexSection[];
}

export interface IndexSection {
  title: string;
  type: "concepts" | "entities" | "recent" | "by-type";
  items: string[];  // slugs of pages in this section
}

export interface LogPage extends WikiPageBase {
  type: "log";
  entries: LogEntry[];
}

export interface LogEntry {
  timestamp: string;
  action: "created" | "updated" | "linked" | "compiled";
  pageSlug: string;
  memoryIds?: string[];
  details?: string;
}

export type WikiPage = ConceptPage | EntityPage | IndexPage | LogPage;

export interface WikiCompileOptions {
  project?: string;
  dryRun?: boolean;
  minClusterSize?: number;
  clusteringThreshold?: number;
  includeTypes?: MemoryType[];
}

export interface CompileResult {
  pagesCreated: WikiPage[];
  pagesUpdated: WikiPage[];
  logEntries: LogEntry[];
  errors: string[];
}

export interface ListWikiPagesOptions {
  project?: string;
  type?: "concept" | "entity" | "index" | "log";
  detailLevel?: "l1" | "full";
}

export interface WikiPageRef {
  slug: string;
  title: string;
  type: "concept" | "entity" | "index" | "log";
}