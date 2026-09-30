import type { MemoryEntry, CodeAnchor } from "../types.ts";

export type McpProfile =
  | "core"
  | "coding"
  | "debugging"
  | "review"
  | "architecture"
  | "maintenance"
  | "full";

export interface MuseContextInput {
  query?: string;
  active_file?: string;
  symbol?: string;
  error_message?: string;
  task_intent?: "feature" | "bugfix" | "refactor" | "review" | "architecture" | "general";
  token_budget?: number;
  project?: string;
  dir?: string;
  /** Recall-time freshness gate (GAP-3): withhold drifted/orphaned-anchor memories (default true). Pass false to include with warnings. */
  include_drifted?: boolean;
}

export interface FusedContextResult {
  active_constraints: Array<{ id: string; title: string; content: string }>;
  relevant_memories: MemoryEntry[];
  negative_lessons: MemoryEntry[];
  code_anchors: CodeAnchor[];
  tokens_used: number;
  token_budget: number;
  suggested_next_steps: string[];
  /** Memories withheld by the freshness gate, with exact reasons (never silent). */
  withheld_memories?: Array<{ id: string; reason: string; file_path: string; symbol_name?: string }>;
  /** Provenance notice when memories were withheld, for the rendered markdown. */
  freshness_notice?: string;
  /** Gate telemetry: checked / files_read / withheld / duration_ms. */
  freshness_stats?: { checked: number; files_read: number; withheld: number; duration_ms: number };
}

export interface CodeForMemoryResult {
  memory_id: string;
  title: string;
  anchors: CodeAnchor[];
  referenced_symbols: string[];
  referenced_files: string[];
}

export interface MemoryForCodeResult {
  file_path: string;
  symbol_name?: string;
  associated_memories: MemoryEntry[];
  negative_lessons: MemoryEntry[];
  constraints: MemoryEntry[];
  total_found: number;
}
