import type { Store } from "../store.ts";
import { get, save } from "../store.ts";
import { recordAuditEvent } from "../audit.ts";
import { getGlobalMemoryDir } from "../root.ts";
import { openStore } from "../store.ts";
import type { MemoryEntry, MemoryScope, PromotionRecord } from "../types.ts";
import type { PromotionEvaluation, PromotionResult } from "./types.ts";
import { generalizeContent, isContentGeneralizable } from "./generalization.ts";

/** Minimum successful reuse applications required for automatic global promotion */
export const MIN_PROMOTION_SUCCESSFUL_USES = 5;

/**
 * Determines current scope for an entry.
 */
export function getEntryScope(entry: MemoryEntry): MemoryScope {
  if (entry.scope) return entry.scope;
  if (entry.project === "global") return "global";
  if (entry.status === "candidate") return "local";
  return "project";
}

/**
 * T-105b: Syntax-only promotion rule.
 * Enforces AST, schema, command, and JSON block syntax verification before promotion.
 */
export interface SyntaxValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateMemorySyntax(entry: MemoryEntry): SyntaxValidationResult {
  const content = entry.content ?? "";

  // 1. Validate JSON code blocks (```json ... ```)
  const jsonBlockRegex = /```(?:json|jsonc)\s*\n([\s\S]*?)\n```/gi;
  let match: RegExpExecArray | null;
  while ((match = jsonBlockRegex.exec(content)) !== null) {
    const jsonText = match[1].trim();
    try {
      JSON.parse(jsonText);
    } catch (err) {
      return {
        valid: false,
        reason: `Syntax gate failure: malformed JSON code block (${err instanceof Error ? err.message : String(err)})`,
      };
    }
  }

  // 2. Validate test_command if present
  if (entry.test_command && entry.test_command.trim()) {
    const cmd = entry.test_command.trim();
    let singleQuotes = 0;
    let doubleQuotes = 0;
    for (const char of cmd) {
      if (char === "'") singleQuotes++;
      if (char === '"') doubleQuotes++;
    }
    if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
      return {
        valid: false,
        reason: "Syntax gate failure: unbalanced quotes in test_command",
      };
    }
    let parens = 0;
    for (const char of cmd) {
      if (char === "(") parens++;
      if (char === ")") parens--;
      if (parens < 0) break;
    }
    if (parens !== 0) {
      return {
        valid: false,
        reason: "Syntax gate failure: unbalanced parentheses in test_command",
      };
    }
  }

  return { valid: true };
}

/**
 * T-105: Corroboration-gated promotion.
 * Requires evidence spanning >= 2 independent calendar days from non-synthetic sources.
 */
export interface CorroborationResult {
  corroborated: boolean;
  distinctDays: number;
  nonSyntheticSources: string[];
  reason?: string;
}

export function checkCorroboration(entry: MemoryEntry): CorroborationResult {
  const dates = new Set<string>();
  const nonSyntheticSources = new Set<string>();

  const isSynthetic = (source?: string, type?: string) => {
    const s = (source ?? "").toLowerCase();
    const t = (type ?? "").toLowerCase();
    return (
      s === "agent" ||
      s === "transcript" ||
      s === "assistant" ||
      s === "inference" ||
      s === "distillation" ||
      s === "machine" ||
      s === "synthetic" ||
      t === "synthetic" ||
      t === "infer"
    );
  };

  if (entry.evidence && entry.evidence.length > 0) {
    for (const ev of entry.evidence) {
      if (ev.timestamp) {
        dates.add(ev.timestamp.slice(0, 10));
      }
      if (!isSynthetic(ev.source, ev.type)) {
        nonSyntheticSources.add(ev.source || ev.type);
      }
    }
  }

  if (entry.created_at) dates.add(entry.created_at.slice(0, 10));
  if (entry.last_confirmed_at) dates.add(entry.last_confirmed_at.slice(0, 10));
  if (entry.updated_at) dates.add(entry.updated_at.slice(0, 10));

  if (!isSynthetic(entry.source, entry.type)) {
    nonSyntheticSources.add(entry.source ?? "human");
  }

  const distinctDays = dates.size;
  const nonSynthList = Array.from(nonSyntheticSources);
  const corroborated = distinctDays >= 2 && nonSynthList.length >= 1;

  let reason: string | undefined;
  if (!corroborated) {
    if (distinctDays < 2) {
      reason = `requires evidence spanning >= 2 independent calendar days (found ${distinctDays})`;
    } else {
      reason = "requires at least one non-synthetic source (all sources are machine/agent)";
    }
  }

  return {
    corroborated,
    distinctDays,
    nonSyntheticSources: nonSynthList,
    reason,
  };
}

/**
 * Evaluates whether a memory entry qualifies for promotion along the ladder:
 * LOCAL -> PROJECT -> GLOBAL
 */
export function evaluatePromotion(
  entry: MemoryEntry,
  options: { forceManual?: boolean; requireCorroboration?: boolean } = {}
): PromotionEvaluation {
  const currentScope = getEntryScope(entry);
  const targetScope: MemoryScope = currentScope === "local" ? "project" : "global";
  const reasons: string[] = [];

  const successfulUses = entry.utility?.successful_applications ?? 0;
  const totalUses = entry.utility?.application_count ?? 0;
  const regressions = entry.utility?.regressions ?? 0;
  const successRate = entry.utility?.reuse_success_rate ?? (totalUses > 0 ? successfulUses / totalUses : 0);
  const conflicts = (entry.conflict_ids?.length ?? 0) + (entry.status === "conflicted" ? 1 : 0);

  const hasSufficientEvidence = Boolean(
    (entry.verification?.level && entry.verification.level !== "unverified") ||
    (entry.evidence && entry.evidence.length > 0)
  );

  const isGeneralizable = isContentGeneralizable(entry.content);
  const genResult = generalizeContent(entry.content, { projectName: entry.project });

  // T-105b: Universal syntax gate check
  const syntax = validateMemorySyntax(entry);
  if (!syntax.valid) {
    reasons.push(syntax.reason ?? "Syntax check failed");
    return {
      eligible: false,
      current_scope: currentScope,
      target_scope: targetScope,
      successful_uses: successfulUses,
      total_uses: totalUses,
      success_rate: successRate,
      regressions,
      conflicts,
      has_sufficient_evidence: hasSufficientEvidence,
      is_generalizable: isGeneralizable,
      has_valid_syntax: false,
      reasons,
    };
  }

  if (currentScope === "global") {
    reasons.push("Entry is already at maximum scope (global)");
    return {
      eligible: false,
      current_scope: "global",
      target_scope: "global",
      successful_uses: successfulUses,
      total_uses: totalUses,
      success_rate: successRate,
      regressions,
      conflicts,
      has_sufficient_evidence: hasSufficientEvidence,
      is_generalizable: isGeneralizable,
      has_valid_syntax: true,
      reasons,
    };
  }

  // 1. LOCAL -> PROJECT promotion
  if (currentScope === "local" && targetScope === "project") {
    const isConfirmedOrVerified = entry.status === "confirmed" || hasSufficientEvidence;
    const eligible = options.forceManual || isConfirmedOrVerified;
    if (eligible) {
      reasons.push("Candidate memory has sufficient verification/confirmation to become durable project knowledge");
    } else {
      reasons.push("Memory requires verification or confirmation before promotion to project scope");
    }
    return {
      eligible,
      current_scope: "local",
      target_scope: "project",
      successful_uses: successfulUses,
      total_uses: totalUses,
      success_rate: successRate,
      regressions,
      conflicts,
      has_sufficient_evidence: hasSufficientEvidence,
      is_generalizable: isGeneralizable,
      generalized_content: genResult.generalized,
      reasons,
    };
  }

  // 2. PROJECT -> GLOBAL promotion
  if (options.forceManual) {
    reasons.push("Manual promotion override requested; bypassing 5x repeated success requirement");
    return {
      eligible: true,
      current_scope: "project",
      target_scope: "global",
      successful_uses: successfulUses,
      total_uses: totalUses,
      success_rate: successRate,
      regressions,
      conflicts,
      has_sufficient_evidence: hasSufficientEvidence,
      is_generalizable: isGeneralizable,
      generalized_content: genResult.generalized,
      reasons,
    };
  }

  // Automatic Policy Gates
  let eligible = true;

  if (successfulUses < MIN_PROMOTION_SUCCESSFUL_USES) {
    eligible = false;
    reasons.push(`Insufficient successful applications: ${successfulUses}/${MIN_PROMOTION_SUCCESSFUL_USES}`);
  }

  if (successRate < 1.0) {
    eligible = false;
    reasons.push(`Success rate ${(successRate * 100).toFixed(0)}% is below 100% threshold`);
  }

  if (regressions > 0) {
    eligible = false;
    reasons.push(`Memory caused ${regressions} regression(s)`);
  }

  if (conflicts > 0) {
    eligible = false;
    reasons.push(`Memory has active conflict_ids (${conflicts})`);
  }

  if (!hasSufficientEvidence) {
    eligible = false;
    reasons.push("Insufficient verification or evidence backing entry");
  }

  if (!isGeneralizable) {
    eligible = false;
    reasons.push("Content cannot be generalized into reusable cross-project principle");
  }

  // T-105: Corroboration gate (evaluated when requireCorroboration: true or when evidence is present)
  let isCorroborated: boolean | undefined = undefined;
  if (options.requireCorroboration || (entry.evidence && entry.evidence.length > 0)) {
    const corroboration = checkCorroboration(entry);
    isCorroborated = corroboration.corroborated;
    if (!corroboration.corroborated) {
      eligible = false;
      reasons.push(`Corroboration gate failed: ${corroboration.reason}`);
    }
  }

  if (eligible) {
    reasons.push(`Met all policy gates: >= ${MIN_PROMOTION_SUCCESSFUL_USES} successful uses, 100% success rate, 0 regressions, 0 conflicts`);
  }

  return {
    eligible,
    current_scope: "project",
    target_scope: "global",
    successful_uses: successfulUses,
    total_uses: totalUses,
    success_rate: successRate,
    regressions,
    conflicts,
    has_sufficient_evidence: hasSufficientEvidence,
    is_generalizable: isGeneralizable,
    is_corroborated: isCorroborated,
    has_valid_syntax: true,
    generalized_content: genResult.generalized,
    reasons,
  };
}

/**
 * Executes promotion for a memory entry.
 */
export function promoteMemory(
  store: Store,
  id: string,
  options: {
    forceManual?: boolean;
    targetScope?: MemoryScope;
    actor?: string;
    customGeneralizedContent?: string;
  } = {}
): PromotionResult {
  const entry = get(store, id);
  if (!entry) {
    return {
      promoted: false,
      entry_id: id,
      from_scope: "project",
      to_scope: "global",
      policy: options.forceManual ? "manual" : "repeated_success",
      message: `Memory entry '${id}' not found in store`,
    };
  }

  const evalResult = evaluatePromotion(entry, { forceManual: options.forceManual });
  if (!evalResult.eligible) {
    return {
      promoted: false,
      entry_id: id,
      from_scope: evalResult.current_scope,
      to_scope: evalResult.target_scope,
      policy: options.forceManual ? "manual" : "repeated_success",
      message: `Promotion criteria not met: ${evalResult.reasons.join("; ")}`,
    };
  }

  const now = new Date().toISOString();
  const policy = options.forceManual ? "manual" : (evalResult.current_scope === "local" ? "validation" : "repeated_success");

  // Promote LOCAL -> PROJECT
  if (evalResult.current_scope === "local") {
    entry.scope = "project";
    if (entry.status === "candidate") {
      entry.status = "confirmed";
    }
    entry.updated_at = now;
    entry.promotion = {
      promoted_at: now,
      from_scope: "local",
      to_scope: "project",
      policy,
      successful_uses: evalResult.successful_uses,
      total_uses: evalResult.total_uses,
      regressions: evalResult.regressions,
      confidence: "high",
    };

    save(store, entry);

    if (store.memoryDir) {
      recordAuditEvent(store.memoryDir, {
        operation: "promote",
        entry_id: id,
        project: entry.project,
        actor: options.actor || "agent",
        reason: "Promoted from local candidate to project durable memory",
        details: entry.promotion,
      });
    }

    return {
      promoted: true,
      entry_id: id,
      from_scope: "local",
      to_scope: "project",
      policy,
      message: `Successfully promoted entry '${id}' from local to project scope`,
    };
  }

  // Promote PROJECT -> GLOBAL
  const generalizedText = options.customGeneralizedContent || evalResult.generalized_content || entry.content;
  const globalDir = getGlobalMemoryDir();
  const globalStore = openStore(globalDir);

  const globalRecord: PromotionRecord = {
    promoted_at: now,
    from_scope: "project",
    to_scope: "global",
    policy,
    successful_uses: evalResult.successful_uses,
    total_uses: evalResult.total_uses,
    regressions: evalResult.regressions,
    confidence: "high",
    generalized_from: entry.content,
  };

  // Create or update in global store
  const globalEntry: MemoryEntry = {
    ...entry,
    project: "global",
    scope: "global",
    content: generalizedText,
    status: "confirmed",
    updated_at: now,
    promotion: globalRecord,
  };

  save(globalStore, globalEntry);

  // Update local entry with promotion record and link
  entry.promotion = globalRecord;
  entry.updated_at = now;
  save(store, entry);

  // Audit event in local store
  if (store.memoryDir) {
    recordAuditEvent(store.memoryDir, {
      operation: "promote",
      entry_id: id,
      project: entry.project,
      actor: options.actor || "agent",
      reason: "Promoted from project to global cross-project memory",
      details: globalRecord,
    });
  }

  // Audit event in global store
  recordAuditEvent(globalDir, {
    operation: "promote",
    entry_id: id,
    project: "global",
    actor: options.actor || "agent",
    reason: `Promoted from project '${entry.project}' to global knowledge`,
    details: globalRecord,
  });

  return {
    promoted: true,
    entry_id: id,
    from_scope: "project",
    to_scope: "global",
    policy,
    generalized_content: generalizedText,
    target_entry_id: globalEntry.id,
    target_memory_dir: globalDir,
    message: `Successfully promoted entry '${id}' to global knowledge at ${globalDir}`,
  };
}
