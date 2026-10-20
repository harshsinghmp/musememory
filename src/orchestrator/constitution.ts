/**
 * T-132: Constitution Contract Engine
 *
 * Invariants:
 * 1. Rules injected first: Constitutional rules are placed at the very top (index 0) of context packages.
 * 2. Trim-exempt: Constitutional rules are NEVER evicted, dropped, or truncated regardless of token budgets.
 * 3. No write tool: Write and mutation tools are strictly prohibited from altering constitutional rules or operating under read-only constitution constraints.
 */

export interface ConstitutionalRule {
  id: string;
  title: string;
  rule: string;
  trim_exempt: true;
  category?: "security" | "integrity" | "runtime" | "operational";
  severity?: "mandatory" | "critical" | "advisory";
  source?: string;
}

export const CANONICAL_CONSTITUTIONAL_RULES: ConstitutionalRule[] = [
  {
    id: "R1-zero-claude",
    title: "Zero-Claude Isolation & Vendor Neutrality",
    rule: "Never create ~/.claude/ or root CLAUDE.md; maintain strict vendor neutrality across all agent environments.",
    trim_exempt: true,
    category: "runtime",
    severity: "critical",
    source: "LifeOS Constitution R1",
  },
  {
    id: "R2-zero-secret-exposure",
    title: "Zero Secret Exposure (Vibeguard Protocol)",
    rule: "Never print, echo, or commit raw credentials, tokens, or private keys. Always mask as [REDACTED].",
    trim_exempt: true,
    category: "security",
    severity: "critical",
    source: "LifeOS Vibeguard Protocol",
  },
  {
    id: "R3-evidence-before-claims",
    title: "Evidence Before Claims (Independent Oracle Verification)",
    rule: "All assertions of completion or correctness require verified command and test outputs before claims are made.",
    trim_exempt: true,
    category: "integrity",
    severity: "mandatory",
    source: "Agency Council Verification Doctrine",
  },
  {
    id: "R4-immutable-constitution",
    title: "Immutable Constitution Contract",
    rule: "Constitutional rules are strictly immutable; write tools and destructive mutations are permanently prohibited.",
    trim_exempt: true,
    category: "integrity",
    severity: "critical",
    source: "Constitution Contract Invariant",
  },
];

export class ConstitutionViolationError extends Error {
  constructor(
    message: string,
    public readonly ruleId?: string,
    public readonly toolName?: string
  ) {
    super(message);
    this.name = "ConstitutionViolationError";
  }
}

const WRITE_TOOL_PATTERNS = [
  /^write/i,
  /^edit/i,
  /^replace/i,
  /^save/i,
  /^update/i,
  /^delete/i,
  /^remove/i,
  /^propose/i,
  /^confirm/i,
  /^mutate/i,
  /^override/i,
  /^patch/i,
  /^drop/i,
];

/**
 * Checks if a given tool name is considered a mutating/write tool.
 */
export function isWriteTool(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  return (
    WRITE_TOOL_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    normalized.includes("write") ||
    normalized.includes("delete") ||
    normalized.includes("remove") ||
    normalized.includes("modify") ||
    normalized.includes("edit")
  );
}

/**
 * Validates whether a target identifier or path refers to constitutional rules.
 */
export function isConstitutionalTarget(target?: string): boolean {
  if (!target) return false;
  const lower = target.toLowerCase();
  return (
    lower.startsWith("r1-") ||
    lower.startsWith("r2-") ||
    lower.startsWith("r3-") ||
    lower.startsWith("r4-") ||
    lower.includes("constitution") ||
    lower === "constitutional_rules"
  );
}

/**
 * Enforces the "no write tool" contract:
 * Rejects any write or mutation attempt targeting constitutional rules,
 * or any write tool invocation when operating under a strict read-only constitution contract.
 */
export function assertConstitutionWriteSafety(
  toolName: string,
  targetIdOrPath?: string,
  options?: { strictReadOnly?: boolean }
): void {
  if (isWriteTool(toolName)) {
    if (options?.strictReadOnly) {
      throw new ConstitutionViolationError(
        `Constitution contract violation: write tool '${toolName}' is prohibited under constitution contract mode.`,
        undefined,
        toolName
      );
    }
    if (isConstitutionalTarget(targetIdOrPath)) {
      throw new ConstitutionViolationError(
        `Constitution contract violation: write tools are strictly prohibited for constitutional target '${targetIdOrPath}'.`,
        targetIdOrPath,
        toolName
      );
    }
  }
}

/**
 * Filters a list of tool names to disallow write tools when under a strict constitution contract.
 */
export function filterToolsForConstitution(
  toolNames: string[],
  options?: { allowWriteTools?: boolean }
): string[] {
  if (options?.allowWriteTools) {
    return [...toolNames];
  }
  return toolNames.filter((t) => !isWriteTool(t));
}

/**
 * Resolves constitutional rules, guaranteeing that every rule has `trim_exempt: true`.
 */
export function resolveConstitutionalRules(
  customRules?: ConstitutionalRule[]
): ConstitutionalRule[] {
  if (!customRules || customRules.length === 0) {
    return [...CANONICAL_CONSTITUTIONAL_RULES];
  }

  return customRules.map((r) => ({
    ...r,
    trim_exempt: true as const,
  }));
}

/**
 * Wraps tool execution with constitution write guard, preventing any illegal mutation of constitutional directives.
 */
export function executeWithConstitutionGuard<T>(
  toolName: string,
  targetIdOrPath: string | undefined,
  fn: () => T,
  options?: { strictReadOnly?: boolean }
): T {
  assertConstitutionWriteSafety(toolName, targetIdOrPath, options);
  return fn();
}

