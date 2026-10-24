export type PillarGrade = "A" | "B" | "C" | "D" | "F";
export type GateStatus = "PASS" | "WARN" | "FAIL";

export interface PillarReport {
  name: string;
  score: number; // 0 to 100
  grade: PillarGrade;
  status: GateStatus;
  metrics: Record<string, number | string>;
  remediation_items: string[];
}

/**
 * T-321: What a health report actually covers.
 *
 * A health number is only meaningful next to the scope it was computed over.
 * Before T-321 the report carried a single `project` string taken from
 * whichever memory happened to sort first, so a store-wide number was
 * attributed to one arbitrary project.
 */
export interface HealthScope {
  /** The project filter applied, or null when the report covers the whole store. */
  filter: string | null;
  /** Distinct projects whose memories were considered. */
  projects: string[];
  /** Number of memory entries the report considered. */
  entry_count: number;
  /**
   * Code-side metrics (the technical-debt scan, the documentation/code drift
   * audit) always cover the whole workspace: source code is shared between
   * projects and cannot be attributed to one of them.
   */
  code_scope: "workspace";
}

export interface ProjectHealthReport {
  /**
   * The project this report is attributed to: the requested filter, the sole
   * project present in the store, or "all" when the report spans several.
   */
  project: string;
  /** The exact scope the report covers. */
  scope: HealthScope;
  timestamp: string;
  overall_score: number; // 0 to 100
  overall_grade: PillarGrade;
  gate_status: GateStatus;
  pillars: {
    store_integrity: PillarReport;
    code_anchors: PillarReport;
    doc_code_alignment: PillarReport;
    negative_anti_patterns: PillarReport;
    technical_debt: PillarReport;
  };
  summary: string;
  actionable_checklist: string[];
}
