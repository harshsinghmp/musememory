import type { AdrStatus, AdrOption, AdrDetails } from "../types.ts";

export type { AdrStatus, AdrOption, AdrDetails };

export interface RecordAdrOptions {
  project: string;
  title: string;
  context_and_drivers: string[];
  decision: string;
  consequences: {
    positive?: string[];
    negative?: string[];
    neutral?: string[];
  };
  options_considered?: AdrOption[];
  affected_files?: string[];
  affected_symbols?: string[];
  supersedes?: string;
  status?: AdrStatus;
  tags?: string[];
  adr_number?: number;
  actor?: string;
}

export type DriftState =
  | "DOCUMENTED"
  | "IMPLEMENTED"
  | "PARTIAL"
  | "CONFLICTING"
  | "STALE"
  | "MISSING";

export interface DriftItem {
  id: string;
  source: "adr" | "doc" | "code";
  title: string;
  drift_state: DriftState;
  claimed_symbol?: string;
  claimed_path?: string;
  evidence?: string;
  remediation_suggestion?: string;
}

export interface DriftReport {
  total_items: number;
  documented_count: number;
  implemented_count: number;
  partial_count: number;
  conflicting_count: number;
  stale_count: number;
  missing_count: number;
  alignment_score: number; // 0.0 to 1.0
  items: DriftItem[];
}
