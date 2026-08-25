import type { Store } from "../store.ts";
import { propose, list, markStale, markSuperseded, addConstraint } from "../store.ts";
import { detectProviders } from "./detect.ts";
import { AgentMemoryAdapter } from "./adapters/agentmemory.ts";
import { BeadsAdapter } from "./adapters/beads.ts";
import { LettaAdapter } from "./adapters/letta.ts";
import { GenericAdapter } from "./adapters/generic.ts";
import { scanSecrets, redactSecrets } from "../secrets.ts";
import { getCurrent, setCurrent } from "../current.ts";
import { workspaceRootFor } from "../root.ts";
import { recordAuditEvent } from "../audit.ts";
import type { MigrationOptions, MigrationReport, MigrationProviderReport, ProviderAdapter, MigratedRecord } from "./types.ts";

const ADAPTER_REGISTRY: Record<string, ProviderAdapter> = {
  agentmemory: AgentMemoryAdapter,
  beads: BeadsAdapter,
  letta: LettaAdapter,
};

export function getAdapter(providerId: string): ProviderAdapter {
  return ADAPTER_REGISTRY[providerId] || GenericAdapter;
}

/**
 * Runs multi-provider memory auto-detection and migration into Muse Memory.
 * Preserves active vs archived/superseded state, seeds CURRENT.md with constraints,
 * and passes all records through Vibeguard zero-leakage secret filtering.
 */
export async function runMigration(
  store: Store,
  memoryDir: string,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const workspaceRoot = workspaceRootFor(memoryDir || store.dir);
  const detected = detectProviders(workspaceRoot);
  const provFilter = options.provider?.toLowerCase();
  const targetProviders = provFilter
    ? detected.filter((d) => d.id === provFilter)
    : (options.all ? detected : detected.filter((d) => d.detected));

  const report: MigrationReport = {
    detected,
    totalMigrated: 0,
    totalSuperseded: 0,
    totalConstraints: 0,
    totalSecretsRedacted: 0,
    dryRun: Boolean(options.dryRun),
    providers: [],
    errors: [],
  };

  const existingMemories = list(store);
  const existingTitles = new Set(existingMemories.map((m) => m.title.trim().toLowerCase()));

  for (const provider of targetProviders) {
    const pathsToProcess = provider.resolvedPaths.length > 0 ? provider.resolvedPaths : provider.paths;
    const adapter = getAdapter(provider.id);

    const providerReport: MigrationProviderReport = {
      providerId: provider.id,
      providerName: provider.name,
      sourcePath: pathsToProcess[0] || "not found",
      migratedCount: 0,
      supersededCount: 0,
      constraintsCount: 0,
      secretsRedacted: 0,
      status: "success",
    };

    if (pathsToProcess.length === 0) {
      providerReport.status = "skipped";
      report.providers.push(providerReport);
      continue;
    }

    try {
      let records: MigratedRecord[] = [];
      for (const p of pathsToProcess) {
        const extracted = adapter.extract(p, { defaultProject: options.project });
        records.push(...extracted);
      }

      // If specific adapter returned 0, try generic fallback
      if (records.length === 0 && pathsToProcess.length > 0) {
        for (const p of pathsToProcess) {
          const genericExtracted = GenericAdapter.extract(p, { defaultProject: options.project });
          records.push(...genericExtracted);
        }
      }

      for (const record of records) {
        if (!record.content || !record.content.trim()) continue;

        // Vibeguard zero-leakage check
        let finalContent = record.content;
        const secrets = scanSecrets(record.content);
        if (secrets.length > 0) {
          finalContent = redactSecrets(record.content);
          providerReport.secretsRedacted++;
          report.totalSecretsRedacted++;
        }

        // Deduplication check
        const normalizedTitle = record.title.trim().toLowerCase();
        if (!options.overwrite && existingTitles.has(normalizedTitle)) {
          continue;
        }

        if (record.isConstraint) {
          // Append active working constraint / persona to CURRENT.md (audited via addConstraint)
          if (!options.dryRun) {
            const currentLines = getCurrent(memoryDir);
            const line = `- [${provider.name}] ${record.title}: ${finalContent.replace(/[\r\n]+/g, " ")}`;
            if (!currentLines.includes(line)) {
              addConstraint(memoryDir, line, record.project || options.project || "default");
            }
          }
          providerReport.constraintsCount++;
          report.totalConstraints++;
        } else {
          // Save to store
          if (!options.dryRun) {
            const entry = propose(store, {
              project: record.project || options.project || "default",
              title: record.title,
              content: finalContent,
              type: record.type || "discovery",
              tags: record.tags || ["migrated", provider.id],
              source: record.source || `migrated:${provider.id}`,
              confirmed: record.status === "confirmed",
              verification: record.verification,
            });

            // Route archived source states through lifecycle transitions (audited per entry)
            if (record.status === "superseded") {
              markSuperseded(store, entry.id);
              providerReport.supersededCount++;
              report.totalSuperseded++;
            } else if (record.status === "stale") {
              markStale(store, entry.id);
              providerReport.supersededCount++;
              report.totalSuperseded++;
            }

            existingTitles.add(normalizedTitle);
          } else {
            if (record.status === "superseded" || record.status === "stale") {
              providerReport.supersededCount++;
              report.totalSuperseded++;
            }
          }

          providerReport.migratedCount++;
          report.totalMigrated++;
        }
      }
    } catch (err: any) {
      providerReport.status = "failed";
      providerReport.error = err?.message || String(err);
      report.errors.push(`[${provider.id}] ${providerReport.error}`);
    }

    report.providers.push(providerReport);
  }

  // Record operational audit trail if mutations occurred
  if (!options.dryRun && (report.totalMigrated > 0 || report.totalConstraints > 0)) {
    recordAuditEvent(memoryDir, {
      operation: "import",
      entry_id: "migrator_batch",
      project: options.project || "default",
      actor: "migrator",
      reason: `Migrated ${report.totalMigrated} memories from ${report.providers.length} providers`,
      details: {
        totalMigrated: report.totalMigrated,
        totalSuperseded: report.totalSuperseded,
        totalConstraints: report.totalConstraints,
        secretsRedacted: report.totalSecretsRedacted,
        providers: report.providers.map((p) => ({ id: p.providerId, count: p.migratedCount })),
      },
    });
  }

  return report;
}
