export interface PageIndexNode {
  id: string;
  title: string;
  summary: string;
  content: string;
  path: string;
  depth: number;
  score?: number;
  children: PageIndexNode[];
  citations?: { doc: string; page?: number; line?: number }[];
}

export interface PageIndexDocument {
  id: string;
  title: string;
  project: string;
  builtAt: string;
  depth: number;
  totalNodes: number;
  root: PageIndexNode;
}

export interface PageIndexSearchResult {
  results: {
    nodeId: string;
    title: string;
    summary: string;
    path: string;
    score: number;
    citations?: { doc: string; page?: number; line?: number }[];
  }[];
  reasoning: string;
  totalNodesSearched: number;
  tokensUsed: number;
}
