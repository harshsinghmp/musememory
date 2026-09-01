export type MemoryType =
  | "session"
  | "decision"
  | "fix"
  | "failure"
  | "architecture"
  | "operation"
  | "constraint"
  | "preference"
  | "discovery";

export type MemoryStatus =
  | "candidate"
  | "active"
  | "confirmed"
  | "superseded"
  | "stale"
  | "disputed"
  | "rejected";

export type VerificationLevel =
  | "unverified"
  | "observed"
  | "reproducible"
  | "user-confirmed"
  | "authoritative"
  | "independently-verified";

export interface Verification {
  level: VerificationLevel;
  method?: string;
  verified_by?: string;
  verified_at?: string;
  test_command?: string;
  test_result?: string;
}

export interface GraphMetadata {
  provider: string;
  graph_revision?: string;
  node_ids?: string[];
  symbol_names?: string[];
  affected_paths?: string[];
  impact_query?: string;
  graph_verified_at?: string;
}

export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  project: string;
  status: MemoryStatus;
  created_at: string;
  updated_at: string;
  /** Valid-time (event time) start; decay uses this when set (bi-temporal). */
  valid_from?: string;
  /** Valid-time end, set when an entry leaves active knowledge (stale/rejected/superseded). */
  valid_to?: string;
  /** Reinforcement counter: +1 on confirm, -1 on stale/reject/supersede. */
  reinforcement?: number;
  source?: string;
  tags?: string[];
  type?: MemoryType;
  salience?: number;
  supersedes?: string | string[] | null;
  superseded_by?: string | string[] | null;
  disputed_by?: string[];
  verification?: Verification;
  last_confirmed_at?: string | null;
  related_memory_ids?: string[];
  session_id?: string;
  /** Executable verification command for the Verification Oracle (memory verify). */
  test_command?: string;
  /** Follow-up deadline; boosts scoring when due soon or overdue (SOW-104). */
  due_at?: string;
  /** Expiry timestamp; expired entries are excluded from default context retrieval (SOW-104). */
  expires_at?: string;
  graph?: GraphMetadata;
}

export const STATUS_PENALTY: Record<MemoryStatus, number> = {
  candidate: -0.6,
  active: 0,
  confirmed: 0.4,
  superseded: -1.0,
  stale: -0.3,
  disputed: -0.5,
  rejected: -1.0,
};

export const VERIFICATION_BONUS: Record<VerificationLevel, number> = {
  "independently-verified": 0.15,
  authoritative: 0.12,
  "user-confirmed": 0.1,
  reproducible: 0.08,
  observed: 0.05,
  unverified: 0,
};

export const DEFAULT_STALE_DAYS = 90;
export const DEFAULT_CONTEXT_LIMIT = 5;
export const MAX_TITLE_LENGTH = 120;
export const MAX_TAGS = 8;

export type AuditOperation =
  | "propose"
  | "confirm"
  | "supersede"
  | "mark_stale"
  | "reject"
  | "delete"
  | "link"
  | "import"
  | "transcript_import"
  | "verify";

export interface AuditEntry {
  timestamp: string;
  operation: AuditOperation;
  entry_id: string;
  project?: string;
  actor?: string;
  reason?: string;
  details?: Record<string, any>;
}

export interface SearchOptions {
  limit?: number;
  project?: string;
  includeSuperseded?: boolean;
  type?: MemoryType | string;
  /** Multi-type filter (SOW-106 agent contracts). */
  types?: string[];
  /** Entry must carry at least one of these tags (SOW-106 agent contracts). */
  tags?: string[];
  status?: MemoryStatus | string;
  verified?: boolean;
  tokenBudget?: number;
}

export type SourceType = "primary" | "secondary" | "documentation" | "rfc" | "repo" | "article" | string;

export interface SourceEntry {
  id: string;
  url: string;
  title: string;
  source_type: SourceType;
  excerpt?: string;
  author?: string;
  retrieved_at: string;
  metadata?: Record<string, any>;
}

export type ClaimConfidence = "RAW" | "FETCH" | "SEARCH" | "INFER";

export interface ClaimEntry {
  id: string;
  claim: string;
  confidence_tag: ClaimConfidence;
  source_ids?: string[];
  memory_ids?: string[];
  notes?: string;
  created_at: string;
  verified?: boolean;
}

export interface PromptTemplate {
  name: string;
  title: string;
  description: string;
  template: string;
  variables?: string[];
  tags?: string[];
}

export type CriticVerdict = "pass" | "fail" | "regressed" | "plateaued";

export interface IterationEntry {
  iteration_index: number;
  critic_verdict: CriticVerdict;
  largest_fix_identified: string;
  test_results: string;
  diff_hash?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}


