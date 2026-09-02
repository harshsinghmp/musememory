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
}

export interface AnchorAuditReport {
  total_anchors: number;
  valid_anchors: number;
  drifted_anchors: number;
  orphaned_anchors: number;
  integrity_score: number; // 0.0 to 1.0
  details: AnchorVerificationResult[];
}

export interface CreateAnchorOptions {
  kind: CodeAnchorKind;
  filePath: string;
  symbolName?: string;
  qualifiedName?: string;
  providerMetadata?: Record<string, any>;
}
