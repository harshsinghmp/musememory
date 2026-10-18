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
  global?: boolean;
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
  status: "success" | "skipped" | "failed";
  error?: string;
}

export interface MigrationReport {
  detected: DetectedProvider[];
  totalMigrated: number;
  totalSuperseded: number;
  totalConstraints: number;
  totalSecretsRedacted: number;
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
  const s = raw.toLowerCase();
  if (s.includes("decision")) return "decision";
  if (s.includes("fix") || s.includes("bug")) return "fix";
  if (s.includes("fail")) return "failure";
  if (s.includes("arch")) return "architecture";
  if (s.includes("op") || s.includes("task") || s.includes("proc") || s.includes("skill")) return "operation";
  if (s.includes("const") || s.includes("rule")) return "constraint";
  if (s.includes("pref")) return "preference";
  if (s.includes("sess")) return "session";
  return "discovery";
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

  const validStatuses: Set<string> = new Set([
    "candidate", "active", "confirmed", "superseded", "stale", "disputed", "rejected", "conflicted", "cold", "dormant", "archived"
  ]);
  const status: MemoryStatus = typeof item.status === "string" && validStatuses.has(item.status)
    ? (item.status as MemoryStatus)
    : "candidate";

  const type = normalizeMemoryType(typeof item.type === "string" ? item.type : undefined);

  // F-04 / T-338: Strip self-certified independently-verified from unverified migrations
  let verification = item.verification;
  if (verification) {
    if (verification.level === "independently-verified" && !verification.test_result) {
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
