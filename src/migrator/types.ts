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
  superseded_by?: string[];
  related_memory_ids?: string[];
  created_at?: string;
  updated_at?: string;
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
