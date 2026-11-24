import type { MemoryStatus, MemoryType, Verification } from "../types.ts";

export interface DetectedProvider {
  id: string;
  name: string;
  category: "local-file" | "graph-rag" | "agent-harness" | "cloud-service";
  scope: "local" | "global" | "hybrid";
  paths: string[];
  resolvedPaths: string[];
  description: string;
  detected: boolean;
}

export interface MigratedRecord {
  id?: string;
  title: string;
  content: string;
  project?: string;
  status: MemoryStatus;
  type: MemoryType;
  tags?: string[];
  source?: string;
  verification?: Verification;
  isConstraint?: boolean;
}

export interface MigrationOptions {
  provider?: string;
  all?: boolean;
  dryRun?: boolean;
  overwrite?: boolean;
  project?: string;
}

export interface MigrationProviderReport {
  providerId: string;
  providerName: string;
  sourcePath: string;
  migratedCount: number;
  supersededCount: number;
  constraintsCount: number;
  secretsRedacted: number;
  deduplicatedCount: number;
  status: "success" | "skipped" | "failed";
  error?: string;
}

export interface MigrationReport {
  detected: DetectedProvider[];
  totalMigrated: number;
  totalSuperseded: number;
  totalConstraints: number;
  totalSecretsRedacted: number;
  totalDeduplicated: number;
  dryRun: boolean;
  providers: MigrationProviderReport[];
  errors: string[];
}

export interface ProviderAdapter {
  id: string;
  extract(sourcePath: string, options?: { defaultProject?: string }): MigratedRecord[];
}

export function normalizeMemoryType(raw?: string): MemoryType {
  if (!raw) return "discovery";
  const s = raw.toLowerCase().trim();
  if (s.includes("decision")) return "decision";
  if (s.includes("fix") || s.includes("bug")) return "fix";
  if (s.includes("fail")) return "failure";
  if (s.includes("arch")) return "architecture";
  if (
    s === "ops" ||
    s.startsWith("operat") ||
    s.startsWith("op_") ||
    s.startsWith("ops_") ||
    s.endsWith("operation") ||
    s.includes("task") ||
    s.includes("proc") ||
    s.includes("skill") ||
    s.includes("runbook") ||
    s.includes("playbook")
  ) {
    return "operation";
  }
  if (s.includes("const") || s.includes("rule")) return "constraint";
  if (s.includes("pref")) return "preference";
  if (s.includes("sess")) return "session";
  return "discovery";
}

/**
 * #442: the single source of truth for the valid `MemoryStatus` members.
 *
 * This used to be a hand-written list inside the `Set`, and it carried 11 of the
 * 12 union members — `"expired"` was missing, so `normalizeMemoryStatus("expired")`
 * fell through the final `has` check to `"candidate"` and an imported expired
 * memory came back to life as a live candidate.
 *
 * The `satisfies readonly MemoryStatus[]` means a typo or a removed member fails
 * the build, and `MEMORY_STATUS_VALUES` staying next to `MemoryStatus` is the
 * reminder to extend it when the union grows.
 */
const MEMORY_STATUS_VALUES = [
  "candidate",
  "active",
  "confirmed",
  "superseded",
  "stale",
  "disputed",
  "rejected",
  "conflicted",
  "cold",
  "dormant",
  "archived",
  "expired",
] as const satisfies readonly MemoryStatus[];

const VALID_MEMORY_STATUSES: Set<MemoryStatus> = new Set(MEMORY_STATUS_VALUES);

/**
 * Normalizes raw status strings into valid MemoryStatus members.
 */
export function normalizeMemoryStatus(raw?: string, isArchived?: boolean): MemoryStatus {
  if (isArchived) return "superseded";
  if (!raw) return "candidate";
  const s = raw.toLowerCase().trim();
  if (s === "archived" || s === "superseded" || s === "closed" || s === "deprecated") return "superseded";
  if (s === "stale") return "stale";
  if (s === "confirmed" || s === "active") return "confirmed";
  if (s === "candidate" || s === "draft" || s === "proposed" || s === "open") return "candidate";
  if (VALID_MEMORY_STATUSES.has(s as MemoryStatus)) return s as MemoryStatus;
  return "candidate";
}

/**
 * Validates and sanitizes an intake record from an external migration source.
 * Enforces schema integrity, valid string types, non-empty content, and
 * strips unearned self-certified verification levels.
 */
export function validateMigratedRecord(raw: unknown): MigratedRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<MigratedRecord>;

  const content = typeof item.content === "string" ? item.content.trim() : "";
  if (!content) return null;

  let title = typeof item.title === "string" ? item.title.trim() : "";
  if (!title) {
    title = content.slice(0, 60).replace(/[\r\n]+/g, " ").trim();
  }
  if (!title) return null;

  const status: MemoryStatus = normalizeMemoryStatus(item.status);

  const type = normalizeMemoryType(typeof item.type === "string" ? item.type : undefined);

  // F-04 / T-338 / #141: An external migration cannot prove an elevated
  // verification level by assertion alone, and every level above `unverified`
  // earns a ranking bonus (VERIFICATION_BONUS in src/types.ts). Strip the whole
  // verification block unless a real `test_result` backs the claim; a bare
  // `unverified` attestation carries no bonus and is kept as-is.
  let verification = item.verification;
  if (verification) {
    if (verification.level !== "unverified" && !verification.test_result) {
      verification = undefined;
    }
  }

  const tags = Array.isArray(item.tags)
    ? item.tags.map(String).map((t) => t.trim()).filter(Boolean)
    : undefined;

  return {
    id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : undefined,
    title,
    content,
    project: typeof item.project === "string" && item.project.trim() ? item.project.trim() : undefined,
    status,
    type,
    tags,
    source: typeof item.source === "string" && item.source.trim() ? item.source.trim() : undefined,
    verification,
    isConstraint: Boolean(item.isConstraint),
  };
}
