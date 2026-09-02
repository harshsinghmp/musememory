export type MemoryType =
  | "session"
  | "decision"
  | "fix"
  | "failure"
  | "architecture"
  | "operation"
  | "constraint"
  | "preference"
  | "discovery"
  | "negative"
  | "adr";

export type AdrStatus = "proposed" | "accepted" | "superseded" | "rejected";

export interface AdrOption {
  title: string;
  pros?: string[];
  cons?: string[];
  rejected_reason?: string;
}

export interface AdrDetails {
  adr_number: number;
  status: AdrStatus;
  decision: string;
  drivers?: string[];
  consequences?: {
    positive?: string[];
    negative?: string[];
    neutral?: string[];
  };
  options_considered?: AdrOption[];
  supersedes?: string;
  superseded_by?: string;
}

export interface NegativeMemoryDetails {
  failed_approach: string;
  failure_reason: string;
  alternative_recommended?: string;
  reproduction_command?: string;
  evidence_snippet?: string;
  severity?: "low" | "medium" | "high" | "critical";
}

export interface ObservationEntry {
  id: string;
  timestamp: string;
  source: "tool" | "test" | "build" | "review" | "pr" | "transcript" | "file_edit" | "manual";
  project: string;
  raw: string;
  summary?: string;
  metadata?: Record<string, any>;
  processed: boolean;
  extracted_candidate_id?: string;
}

export type MemoryStatus =
  | "candidate"
  | "active"
  | "confirmed"
  | "superseded"
  | "stale"
  | "disputed"
  | "rejected"
  | "conflicted"
  | "cold"
  | "dormant"
  | "archived";

export type MemoryScope = "local" | "project" | "global";

export interface PromotionRecord {
  promoted_at: string;
  from_scope: MemoryScope;
  to_scope: MemoryScope;
  policy: string;
  successful_uses: number;
  total_uses: number;
  regressions: number;
  confidence: string;
  generalized_from?: string;
}

export type CodeAnchorKind =
  | "repository"
  | "file"
  | "directory"
  | "module"
  | "symbol"
  | "qualified_symbol"
  | "route"
  | "test"
  | "commit"
  | "pr";

export type AnchorStatus = "valid" | "drifted" | "orphaned";

export interface CodeAnchor {
  id: string;
  kind: CodeAnchorKind;
  file_path: string;
  symbol_name?: string;
  qualified_name?: string;
  structural_hash?: string;
  signature?: string;
  status?: AnchorStatus;
  provider_metadata?: Record<string, any>;
  created_at?: string;
  verified_at?: string;
}

export type TemporalMode = "current" | "historical" | "timeless";

export type MemoryQuality = "LOW" | "MEDIUM" | "HIGH" | "VERIFIED" | "CONFLICTED" | "STALE";

export interface EvidenceItem {
  id: string;
  type: "raw" | "fetch" | "search" | "infer" | "code" | "test" | "git" | "doc" | "human" | "code_intelligence";
  source?: string;
  timestamp: string;
  excerpt?: string;
  confidence?: number;
}

export interface MemoryUtility {
  retrieval_count: number;
  application_count: number;
  successful_applications: number;
  failed_applications: number;
  regressions: number;
  contradictions: number;
  last_applied_at?: string;
  reuse_success_rate?: number;
}

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
  /** Deterministic SHA-256 content fingerprint for deduplication. */
  fingerprint?: string;
  /** Temporal mode: current (active state), historical (past state before migration), timeless (immutable rule). */
  temporal_mode?: TemporalMode;
  /** Categorical quality tier: LOW, MEDIUM, HIGH, VERIFIED, CONFLICTED, STALE. */
  quality?: MemoryQuality;
  /** Utility tracking metrics: application outcomes, regressions, success rate. */
  utility?: MemoryUtility;
  /** Supporting evidence entries backing this memory. */
  evidence?: EvidenceItem[];
  /** Mutually conflicting memory IDs flagged by the Contradiction Engine. */
  conflict_ids?: string[];
  /** Canonical memory ID if this entry was consolidated into another. */
  canonical_id?: string;
  /** First-class negative lesson details (DO_NOT_USE / FAILED_APPROACH / BUG_PRONE_PATTERN). */
  negative?: NegativeMemoryDetails;
  /** Memory scope: local (workspace), project (repo), global (cross-project). */
  scope?: MemoryScope;
  /** Reason for moving entry to cold/dormant/archived. */
  archive_reason?: string;
  /** ISO timestamp when entry was transitioned to cold/dormant/archived. */
  archived_at?: string;
  /** Provenance record of promotion from local/project to project/global. */
  promotion?: PromotionRecord;
  /** First-class code anchors linking this memory to files, symbols, and routes. */
  anchors?: CodeAnchor[];
  /** First-class Architecture Decision Record (ADR) metadata. */
  adr?: AdrDetails;
}

export const STATUS_PENALTY: Record<MemoryStatus, number> = {
  candidate: -0.6,
  active: 0,
  confirmed: 0.4,
  superseded: -1.0,
  stale: -0.3,
  disputed: -0.5,
  rejected: -1.0,
  conflicted: -0.8,
  cold: -0.2,
  dormant: -0.5,
  archived: -0.9,
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
  | "verify"
  | "conflict_detected"
  | "conflict_resolved"
  | "application_outcome"
  | "observation"
  | "negative_capture"
  | "promote"
  | "archive"
  | "rehydrate"
  | "anchor_created"
  | "anchor_verified"
  | "anchor_drifted"
  | "adr_recorded"
  | "adr_superseded"
  | "drift_detected";

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
  includeArchived?: boolean;
  autoRehydrate?: boolean;
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


