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

export interface ProjectHealthReport {
  project: string;
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
