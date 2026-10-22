import type { Store } from "../store.ts";
import { listForProject } from "../store.ts";
import { auditMemoryAnchors } from "../anchors/resolver.ts";
import { detectDocumentationCodeDrift } from "../adrs/drift.ts";
import { analyzeTechnicalDebt } from "../cognition/tech-debt.ts";
import { clusterRecurringBugsAndFriction } from "../cognition/clustering.ts";
import type { PillarGrade, GateStatus, PillarReport, ProjectHealthReport, HealthScope } from "./types.ts";

function scoreToGrade(score: number): PillarGrade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function scoreToStatus(score: number): GateStatus {
  if (score >= 80) return "PASS";
  if (score >= 65) return "WARN";
  return "FAIL";
}

/**
 * T-321: Options for a health evaluation.
 */
export interface HealthEvaluationOptions {
  /**
   * Restrict the report to one memory project. Memory-side pillars (store
   * integrity, code anchors, negative lessons, memory-derived debt) are
   * computed over that project only. Code-side metrics stay workspace-wide
   * and are labelled as such in `scope.code_scope`.
   */
  project?: string;
}

/**
 * Evaluates the 5-Pillar Project Health Gate across memory, code anchors, drift, anti-patterns, and technical debt.
 */
export function evaluateProjectHealth(
  store: Store,
  workspaceRoot: string,
  options?: HealthEvaluationOptions,
): ProjectHealthReport {
  const now = new Date().toISOString();
  const projectFilter = options?.project?.trim() || undefined;
  const entries = listForProject(store, projectFilter);
  const checklist: string[] = [];

  // ==========================================
  // PILLAR 1: Memory Store Integrity
  // ==========================================
  let activeCount = 0;
  let confirmedCount = 0;
  let conflictedCount = 0;
  let expiredCount = 0;
  let timelessCount = 0;

  for (const e of entries) {
    if (e.status === "confirmed") confirmedCount++;
    if (e.status === "active" || e.status === "confirmed") activeCount++;
    if (e.status === "conflicted" || (e.conflict_ids && e.conflict_ids.length > 0)) conflictedCount++;
    if (e.temporal_mode === "timeless") timelessCount++;
    if (e.expires_at && new Date(e.expires_at).getTime() < Date.now() && e.status !== "archived") {
      expiredCount++;
    }
  }

  const integrityDeductions = conflictedCount * 25 + expiredCount * 10;
  const integrityScore = Math.max(0, Math.min(100, 100 - integrityDeductions));
  const integrityRemediations: string[] = [];

  if (conflictedCount > 0) {
    integrityRemediations.push(`Resolve ${conflictedCount} mutually conflicting memories via memory_conflict_resolve`);
  }
  if (expiredCount > 0) {
    integrityRemediations.push(`Archive or refresh ${expiredCount} expired active memories`);
  }

  const storeIntegrityPillar: PillarReport = {
    name: "Memory Store Integrity",
    score: integrityScore,
    grade: scoreToGrade(integrityScore),
    status: scoreToStatus(integrityScore),
    metrics: {
      total_memories: entries.length,
      confirmed_memories: confirmedCount,
      conflicted_memories: conflictedCount,
      expired_memories: expiredCount,
      timeless_invariants: timelessCount,
    },
    remediation_items: integrityRemediations,
  };

  // ==========================================
  // PILLAR 2: Native Code Anchor Validity
  // ==========================================
  const anchorAudit = auditMemoryAnchors(store, workspaceRoot, { project: projectFilter });
  const anchorScore = Math.round(anchorAudit.integrity_score * 100);
  const anchorRemediations: string[] = [];

  if (anchorAudit.drifted_anchors > 0) {
    anchorRemediations.push(`Re-synchronize ${anchorAudit.drifted_anchors} drifted code anchors with live symbol signatures`);
  }
  if (anchorAudit.orphaned_anchors > 0) {
    anchorRemediations.push(`Clean up or re-anchor ${anchorAudit.orphaned_anchors} orphaned anchors referencing deleted code`);
  }

  const codeAnchorsPillar: PillarReport = {
    name: "Native Code Anchor Validity",
    score: anchorScore,
    grade: scoreToGrade(anchorScore),
    status: scoreToStatus(anchorScore),
    metrics: {
      total_anchors: anchorAudit.total_anchors,
      valid_anchors: anchorAudit.valid_anchors,
      drifted_anchors: anchorAudit.drifted_anchors,
      orphaned_anchors: anchorAudit.orphaned_anchors,
      anchor_integrity_pct: `${anchorScore}%`,
    },
    remediation_items: anchorRemediations,
  };

  // ==========================================
  // PILLAR 3: Documentation <-> Code Alignment
  // ==========================================
  const driftAudit = detectDocumentationCodeDrift(store, workspaceRoot, { project: projectFilter });
  const driftScore = Math.round(driftAudit.alignment_score * 100);
  const driftRemediations: string[] = [];

  if (driftAudit.missing_count > 0) {
    driftRemediations.push(`Document ${driftAudit.missing_count} undocumented exported symbols using memory_capture or memory_adr_record`);
  }
  if (driftAudit.stale_count > 0) {
    driftRemediations.push(`Update or archive ${driftAudit.stale_count} stale documentation items referencing deleted files`);
  }
  if (driftAudit.conflicting_count > 0) {
    driftRemediations.push(`Resolve ${driftAudit.conflicting_count} conflicting implementations violating architectural docs`);
  }

  const docCodeAlignmentPillar: PillarReport = {
    name: "Documentation <-> Code Alignment",
    score: driftScore,
    grade: scoreToGrade(driftScore),
    status: scoreToStatus(driftScore),
    metrics: {
      total_items: driftAudit.total_items,
      documented: driftAudit.documented_count,
      implemented: driftAudit.implemented_count,
      missing: driftAudit.missing_count,
      stale: driftAudit.stale_count,
      conflicting: driftAudit.conflicting_count,
      alignment_pct: `${driftScore}%`,
    },
    remediation_items: driftRemediations,
  };

  // ==========================================
  // PILLAR 4: Negative Lessons & Anti-Pattern Sentry
  // ==========================================
  const negativeLessons = entries.filter((e) => e.type === "negative" || e.negative != null);
  const criticalNegatives = negativeLessons.filter((e) => e.negative?.severity === "critical");
  const highNegatives = negativeLessons.filter((e) => e.negative?.severity === "high");

  // Having documented negative lessons protects the repo; having none means blind spots
  let negativeScore = 85;
  if (negativeLessons.length >= 3) negativeScore = 95;
  else if (negativeLessons.length >= 1) negativeScore = 90;
  else negativeScore = 70; // Blind spot

  const negativeRemediations: string[] = [];
  if (negativeLessons.length === 0) {
    negativeRemediations.push("Capture critical failure lessons and anti-patterns via memory_capture_negative");
  }

  const negativeAntiPatternsPillar: PillarReport = {
    name: "Negative Lessons & Anti-Pattern Sentry",
    score: negativeScore,
    grade: scoreToGrade(negativeScore),
    status: scoreToStatus(negativeScore),
    metrics: {
      total_negative_lessons: negativeLessons.length,
      critical_severity: criticalNegatives.length,
      high_severity: highNegatives.length,
    },
    remediation_items: negativeRemediations,
  };

  // ==========================================
  // PILLAR 5: Technical Debt & Friction
  // ==========================================
  const debtReport = analyzeTechnicalDebt(store, workspaceRoot, { project: projectFilter });
  const bugClusters = clusterRecurringBugsAndFriction(store, { project: projectFilter });
  const topFragility = bugClusters.length > 0 ? bugClusters[0].fragility_score : 0;

  const debtPenalty = debtReport.debt_score + Math.round(topFragility * 20);
  const debtScore = Math.max(0, Math.min(100, 100 - debtPenalty));

  const techDebtPillar: PillarReport = {
    name: "Technical Debt & Friction",
    score: debtScore,
    grade: scoreToGrade(debtScore),
    status: scoreToStatus(debtScore),
    metrics: {
      total_debt_items: debtReport.total_debt_items,
      debt_score: debtReport.debt_score,
      recurring_bug_clusters: bugClusters.length,
      top_fragility_score: topFragility,
      hotspot_files: debtReport.hotspot_files.length,
    },
    remediation_items: debtReport.refactoring_recommendations,
  };

  // ==========================================
  // Overall Composite Evaluation
  // ==========================================
  const overallScore = Math.round(
    (storeIntegrityPillar.score +
      codeAnchorsPillar.score +
      docCodeAlignmentPillar.score +
      negativeAntiPatternsPillar.score +
      techDebtPillar.score) /
      5
  );

  const overallGrade = scoreToGrade(overallScore);
  const gateStatus = scoreToStatus(overallScore);

  // Aggregate checklist
  checklist.push(...storeIntegrityPillar.remediation_items);
  checklist.push(...codeAnchorsPillar.remediation_items);
  checklist.push(...docCodeAlignmentPillar.remediation_items);
  checklist.push(...negativeAntiPatternsPillar.remediation_items);
  checklist.push(...techDebtPillar.remediation_items);

  // T-321: Attribute the report honestly. The previous implementation used
  // `entries[0].project`, so a store-wide number was labelled with whichever
  // memory happened to sort first. Now the label is the requested filter, the
  // sole project present, or "all" — and `scope` states the coverage exactly.
  const projectsCovered = [
    ...new Set(entries.map((e) => e.project).filter((p): p is string => Boolean(p))),
  ].sort();
  const projectName = projectFilter ?? (projectsCovered.length === 1 ? projectsCovered[0] : "all");
  const scope: HealthScope = {
    filter: projectFilter ?? null,
    projects: projectsCovered,
    entry_count: entries.length,
    code_scope: "workspace",
  };

  let summary = `Project health evaluated with overall Grade ${overallGrade} (${overallScore}/100) — Status: ${gateStatus}.`;
  if (gateStatus === "PASS") {
    summary += " All 5 pillars meet production hardening criteria.";
  } else if (gateStatus === "WARN") {
    summary += " Minor degradation detected in code anchors, documentation drift, or technical debt.";
  } else {
    summary += " Critical architectural violations or unverified contradictions must be resolved before sign-off.";
  }
  summary += ` Scope: ${projectFilter ? `project "${projectFilter}"` : "entire store"} (${entries.length} memories across ${projectsCovered.length} project${projectsCovered.length === 1 ? "" : "s"}); code-side metrics cover the workspace.`;

  return {
    project: projectName,
    scope,
    timestamp: now,
    overall_score: overallScore,
    overall_grade: overallGrade,
    gate_status: gateStatus,
    pillars: {
      store_integrity: storeIntegrityPillar,
      code_anchors: codeAnchorsPillar,
      doc_code_alignment: docCodeAlignmentPillar,
      negative_anti_patterns: negativeAntiPatternsPillar,
      technical_debt: techDebtPillar,
    },
    summary,
    actionable_checklist: Array.from(new Set(checklist)),
  };
}
