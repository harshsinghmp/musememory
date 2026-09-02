import type { MemoryEntry, MemoryStatus, MemoryScope, PromotionRecord } from "../types.ts";

export interface PromotionEvaluation {
  eligible: boolean;
  current_scope: MemoryScope;
  target_scope: MemoryScope;
  successful_uses: number;
  total_uses: number;
  success_rate: number;
  regressions: number;
  conflicts: number;
  has_sufficient_evidence: boolean;
  is_generalizable: boolean;
  generalized_content?: string;
  reasons: string[];
}

export interface PromotionResult {
  promoted: boolean;
  entry_id: string;
  from_scope: MemoryScope;
  to_scope: MemoryScope;
  policy: "repeated_success" | "manual" | "validation";
  generalized_content?: string;
  target_entry_id?: string;
  target_memory_dir?: string;
  message: string;
}

export interface ArchivalEvaluation {
  id: string;
  current_status: MemoryStatus;
  recommended_status: "active" | "cold" | "dormant" | "archived";
  reason: string;
  age_days: number;
  utility_score: number;
  is_superseded: boolean;
}

export interface ArchivalResult {
  archived: boolean;
  entry_id: string;
  previous_status: MemoryStatus;
  new_status: "cold" | "dormant" | "archived";
  reason: string;
  message: string;
}

export interface RehydrationResult {
  rehydrated: boolean;
  entry_id: string;
  previous_status: MemoryStatus;
  new_status: MemoryStatus;
  rehydration_score: number;
  message: string;
}

export interface LifecycleStats {
  total: number;
  by_status: Record<MemoryStatus | string, number>;
  by_scope: Record<MemoryScope | string, number>;
  promotion_candidates: number;
  archival_candidates: number;
}
