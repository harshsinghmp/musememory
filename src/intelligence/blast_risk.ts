export type BlastRiskLevel = "low" | "medium" | "high" | "critical";

export interface BlastRiskInput {
  files: string[];
  symbols?: string[];
  changedLines?: number;
  hasTests?: boolean;
  crossModule?: boolean;
}

export interface BlastRisk {
  score: number;
  level: BlastRiskLevel;
  factors: {
    files: number;
    symbols: number;
    lines: number;
    crossModule: number;
    noTests: number;
  };
}

/**
 * T-434: deterministic cross-file blast-radius score (0-100). Deliberately
 * linear and auditable: file/symbol spread dominates, then changed-line
 * volume, with explicit penalties for cross-module reach and missing tests.
 */
export function scoreBlastRadius(input: BlastRiskInput): BlastRisk {
  const files = input.files.length;
  const symbols = input.symbols?.length ?? 0;
  const lines = Math.max(0, input.changedLines ?? 0);
  const crossModule = input.crossModule ? 20 : 0;
  const noTests = input.hasTests === false ? 15 : 0;
  const factors = {
    files: files * 6,
    symbols: symbols * 4,
    lines: Math.min(25, Math.floor(lines / 20)),
    crossModule,
    noTests,
  };
  const score = Math.min(100, factors.files + factors.symbols + factors.lines + factors.crossModule + factors.noTests);
  const level: BlastRiskLevel = score < 25 ? "low" : score < 50 ? "medium" : score < 75 ? "high" : "critical";
  return { score, level, factors };
}
