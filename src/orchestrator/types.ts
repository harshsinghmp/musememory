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
}

export interface FusedContextResult {
  active_constraints: Array<{ id: string; title: string; content: string }>;
  relevant_memories: MemoryEntry[];
  negative_lessons: MemoryEntry[];
  code_anchors: CodeAnchor[];
  tokens_used: number;
  token_budget: number;
  suggested_next_steps: string[];
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
