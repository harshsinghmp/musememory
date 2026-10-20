import type { CodeAnchor, CodeAnchorKind, AnchorStatus } from "../types.ts";

export type { CodeAnchor, CodeAnchorKind, AnchorStatus };

export interface AnchorVerificationResult {
  anchor_id: string;
  memory_id?: string;
  kind: CodeAnchorKind;
  file_path: string;
  symbol_name?: string;
  status: AnchorStatus;
  file_exists: boolean;
  symbol_exists: boolean;
  hash_matched: boolean;
  current_hash?: string;
  expected_hash?: string;
  drift_details?: string;
  /** T-134: Ground-moved determination (true if anchor demonstrably moved or changed). */
  ground_moved?: boolean;
  /** T-134: Details explaining how the ground moved. */
  ground_moved_details?: string;
  /** T-134: Relocated file path if symbol/file moved elsewhere in workspace. */
  relocated_path?: string;
  /** T-134: True if ground movement could not be reliably determined (silent without false alarms). */
  undeterminable?: boolean;
}

export interface GroundMovedReportItem {
  anchor_id: string;
  memory_id?: string;
  file_path: string;
  symbol_name?: string;
  details: string;
  relocated_path?: string;
}

export interface AnchorAuditReport {
  total_anchors: number;
  valid_anchors: number;
  drifted_anchors: number;
  orphaned_anchors: number;
  /** T-134: Number of anchors where ground movement was determinably proven. */
  ground_moved_anchors: number;
  /** T-134: Number of anchors where ground movement was undeterminable. */
  undeterminable_anchors: number;
  integrity_score: number; // 0.0 to 1.0
  details: AnchorVerificationResult[];
  /** T-134: Actionable reports of proven ground movements (omitting undeterminable). */
  ground_moved_reports?: GroundMovedReportItem[];
}

export interface CreateAnchorOptions {
  kind: CodeAnchorKind;
  filePath: string;
  basePath?: string;
  symbolName?: string;
  qualifiedName?: string;
  providerMetadata?: Record<string, any>;
}
