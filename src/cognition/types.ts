export interface WhyQuery {
  target: string;
  filePath?: string;
  symbolName?: string;
  project?: string;
}

export interface HistoricalEvent {
  date: string;
  type: "decision" | "fix" | "adr" | "negative" | "constraint";
  title: string;
  summary: string;
  memory_id: string;
}

export interface WhyExplanation {
  target: string;
  core_rationale: string;
  timeline: HistoricalEvent[];
  trade_offs_accepted: string[];
  active_invariants: string[];
  associated_adrs: string[];
  negative_warnings: string[];
  confidence_score: number; // 0.0 to 1.0
}

export interface BugCluster {
  cluster_id: string;
  category: "race_condition" | "type_drift" | "missing_guard" | "resource_leak" | "architecture_flaw" | "general_bug";
  affected_paths: string[];
  affected_symbols: string[];
  occurrence_count: number;
  fragility_score: number; // 0.0 to 1.0
  sample_fixes: Array<{ id: string; title: string }>;
  root_cause_hypothesis: string;
  preventative_recommendation: string;
}

export interface DebtItem {
  id: string;
  file_path: string;
  line_number?: number;
  type: "todo_fixme" | "type_assertion" | "temporary_workaround" | "deprecated_pattern" | "drifted_anchor";
  snippet: string;
  description: string;
  severity: "low" | "medium" | "high";
  remediation_proposal: string;
}

export interface TechnicalDebtReport {
  total_debt_items: number;
  debt_score: number; // 0.0 to 100.0
  hotspot_files: Array<{ file_path: string; debt_count: number }>;
  items: DebtItem[];
  refactoring_recommendations: string[];
}
