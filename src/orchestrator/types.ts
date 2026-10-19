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
  /** T-075: Include memories with untrusted provenance (filtered by default). */
  include_untrusted?: boolean;
  /** T-108: Session ID for turn-level re-injection suppression and LRU tracking. */
  session_id?: string;
  /** T-108: Turn number within session (1-indexed). Defaults to auto-incremented session turn. */
  turn?: number;
  /** T-108: Whether to suppress re-injection of memories injected in the last 6 turns (default: true if session_id provided). */
  suppress_reinjected?: boolean;
  /** T-109: Whether to suppress memories created by active session/agent within echo horizon (default: true). */
  suppress_self_echo?: boolean;
  /** T-109: Horizon in ms for self-echo suppression (default: 10 minutes). */
  echo_horizon_ms?: number;
  /** T-109: Active caller agent name for provenance matching. */
  agent?: string;
  /** T-111: Whether to suppress memories already served within active TTL window (default: false, or true if seen_chunk_ttl_ms provided). */
  suppress_seen_chunks?: boolean;
  /** T-111: TTL in milliseconds for seen chunks (default: 300,000ms / 5 minutes). */
  seen_chunk_ttl_ms?: number;
  /** T-111: Whether to auto-record retrieved memories into seen-chunk tracker (default: true if session_id provided). */
  record_seen_chunks?: boolean;
}

export interface ContextManifestItem {
  id: string;
  title: string;
  type?: string;
  truncated?: boolean;
  score?: number;
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
  /** T-092: Never-drop manifest TOC listing all discovered candidate memories. */
  context_manifest?: ContextManifestItem[];
  /** T-093: Budget truncation marker, e.g. "[2 omitted — budget 1000 tokens]". */
  budget_notice?: string;
  /** T-094: Reserved token allocation for global/USER.md guidelines. */
  user_profile_reserved_tokens?: number;
  /** T-073: Result mode indicating whether matches met confident threshold or fell into no_confident_match. */
  mode?: "confident_match" | "no_confident_match";
  /** T-073: Explicit flag indicating whether confident memories were returned. */
  no_confident_match?: boolean;
  /** T-108: Number of candidate memories withheld due to 6-turn re-injection suppression. */
  reinjection_suppressed_count?: number;
  /** T-109: Number of candidate memories withheld due to age-bounded self-echo suppression. */
  self_echo_suppressed_count?: number;
  /** T-111: Number of candidate memories withheld due to seen-chunk TTL suppression. */
  seen_chunk_suppressed_count?: number;
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
