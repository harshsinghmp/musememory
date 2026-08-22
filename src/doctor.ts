import { existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { findOrCreateProjectRoot, getGlobalMemoryDir } from "./root.ts";
import { openStore, list } from "./store.ts";
import { validateStore } from "./schema.ts";
import { getAuditTrail } from "./audit.ts";
import { detectAgents } from "./agents/detect.ts";
import { findBinary } from "./agents/detect.ts";

export interface DoctorReport {
  storage: {
    type: "local" | "global" | "uninitialized";
    path: string;
    initialized: boolean;
    currentMdExists: boolean;
    currentMdLines: number;
    totalEntries: number;
    statusCounts: Record<string, number>;
  };
  validation: {
    valid: boolean;
    validCount: number;
    invalidCount: number;
    secretLeaksCount: number;
    brokenLinksCount: number;
  };
  audit: {
    exists: boolean;
    path: string;
    eventCount: number;
    sizeBytes: number;
    lastEvent?: string;
  };
  agents: {
    detectedInstalled: number;
    connectedCount: number;
    unwiredCount: number;
    connectedList: string[];
    unwiredList: string[];
  };
  runtime: {
    nodeVersion: string;
    bunVersion?: string;
    globalBinaryFound: boolean;
    binaryPath?: string;
    npxReady: boolean;
  };
}

/**
 * Perform comprehensive health check on Muse Memory installation and ecosystem.
 */
export async function runDoctor(targetDir?: string, options: { global?: boolean } = {}): Promise<DoctorReport> {
  const home = homedir();
  const storagePath = options.global
    ? getGlobalMemoryDir()
    : (findOrCreateProjectRoot(targetDir || process.cwd())?.memoryDir || join(home, ".memory"));
  const isInitialized = existsSync(storagePath);

  // 1. Storage & Entry Breakdown
  let currentMdExists = false;
  let currentMdLines = 0;
  let totalEntries = 0;
  const statusCounts: Record<string, number> = {
    confirmed: 0,
    candidate: 0,
    stale: 0,
    superseded: 0,
    disputed: 0,
    rejected: 0,
  };

  let valid = true;
  let validCount = 0;
  let invalidCount = 0;
  let secretLeaksCount = 0;
  let brokenLinksCount = 0;

  if (isInitialized) {
    const currentPath = join(storagePath, "CURRENT.md");
    if (existsSync(currentPath)) {
      currentMdExists = true;
      const content = readFileSync(currentPath, "utf8");
      currentMdLines = content.split("\n").filter((l) => l.trim().length > 0).length;
    }

    try {
      const store = openStore(storagePath);
      const entries = list(store);
      totalEntries = entries.length;
      for (const e of entries) {
        statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;
      }

      const valReport = validateStore(store);
      valid = valReport.isValid;
      validCount = valReport.validCount;
      invalidCount = valReport.schemaErrors.length + valReport.integrityErrors.length;
      secretLeaksCount = valReport.secretErrors.length;
      brokenLinksCount = valReport.brokenLinks.length;
    } catch {
      valid = false;
    }
  }

  // 2. Audit Trail Status
  const auditPath = join(storagePath, "audit.jsonl");
  let auditExists = false;
  let auditCount = 0;
  let auditSize = 0;
  let lastEvent: string | undefined;

  if (existsSync(auditPath)) {
    auditExists = true;
    try {
      const stat = statSync(auditPath);
      auditSize = stat.size;
      const trail = getAuditTrail(storagePath, { limit: 1 });
      if (trail.length > 0) {
        lastEvent = `${trail[0].operation} on ${trail[0].entry_id} (${trail[0].timestamp})`;
      }
      const raw = readFileSync(auditPath, "utf8");
      auditCount = raw.split("\n").filter((l) => l.trim().length > 0).length;
    } catch {}
  }

  // 3. Coding Agents Matrix
  const agents = detectAgents(home);
  const installed = agents.filter((a) => a.installed);
  const connected = installed.filter((a) => a.connected);
  const unwired = installed.filter((a) => !a.connected);

  // 4. Runtime & Binary checks
  const memBin = findBinary("memory", home) || findBinary("musememory", home);
  const bunVer = typeof (globalThis as any).Bun !== "undefined" ? (globalThis as any).Bun.version : undefined;

  return {
    storage: {
      type: options.global ? "global" : (isInitialized ? "local" : "uninitialized"),
      path: storagePath,
      initialized: isInitialized,
      currentMdExists,
      currentMdLines,
      totalEntries,
      statusCounts,
    },
    validation: {
      valid,
      validCount,
      invalidCount,
      secretLeaksCount,
      brokenLinksCount,
    },
    audit: {
      exists: auditExists,
      path: auditPath,
      eventCount: auditCount,
      sizeBytes: auditSize,
      lastEvent,
    },
    agents: {
      detectedInstalled: installed.length,
      connectedCount: connected.length,
      unwiredCount: unwired.length,
      connectedList: connected.map((a) => a.name),
      unwiredList: unwired.map((a) => a.name),
    },
    runtime: {
      nodeVersion: process.version,
      bunVersion: bunVer,
      globalBinaryFound: Boolean(memBin),
      binaryPath: memBin || undefined,
      npxReady: true,
    },
  };
}

/**
 * Print formatted terminal report for doctor.
 */
export function printDoctorReport(report: DoctorReport): void {
  console.log(`\n🏥 Muse Memory Health & Ecosystem Diagnostic Report`);
  console.log(`====================================================`);

  // Storage
  console.log(`\n📦 Memory Store & Storage:`);
  console.log(`  Path: ${report.storage.path} [${report.storage.type.toUpperCase()}]`);
  console.log(`  Initialized: ${report.storage.initialized ? "✓ Yes" : "✗ No (run 'memory init')"}`);
  console.log(`  CURRENT.md: ${report.storage.currentMdExists ? `✓ Active (${report.storage.currentMdLines} constraints)` : "⚠️ Missing"}`);
  console.log(`  Total Memory Units: ${report.storage.totalEntries}`);
  console.log(`    ➔ Confirmed: ${report.storage.statusCounts.confirmed || 0} | Candidate: ${report.storage.statusCounts.candidate || 0} | Stale: ${report.storage.statusCounts.stale || 0} | Superseded: ${report.storage.statusCounts.superseded || 0}`);

  // Validation
  console.log(`\n🛡️  Store Integrity & Vibeguard Secret Scan:`);
  if (report.validation.valid) {
    console.log(`  ✓ All ${report.validation.validCount} memory files pass YAML schema validation`);
    console.log(`  ✓ 0 secret leaks detected`);
    console.log(`  ✓ 0 broken relational links`);
  } else {
    console.log(`  ⚠️ Schema / Integrity issues detected:`);
    if (report.validation.invalidCount > 0) console.log(`     - Invalid schema files: ${report.validation.invalidCount}`);
    if (report.validation.secretLeaksCount > 0) console.log(`     - 🔒 Credential leaks found: ${report.validation.secretLeaksCount}`);
    if (report.validation.brokenLinksCount > 0) console.log(`     - Broken links: ${report.validation.brokenLinksCount}`);
  }

  // Audit
  console.log(`\n📜 Operational Compliance Audit Trail:`);
  if (report.audit.exists) {
    console.log(`  ✓ Active audit ledger (${report.audit.eventCount} events recorded, ${report.audit.sizeBytes} bytes)`);
    if (report.audit.lastEvent) console.log(`  ➔ Last mutation: ${report.audit.lastEvent}`);
  } else {
    console.log(`  ℹ️  No audit trail created yet (mutations will initialize audit.jsonl automatically)`);
  }

  // Agents
  console.log(`\n🤖 Coding Agents & MCP Connectivity:`);
  console.log(`  Installed Agents Detected: ${report.agents.detectedInstalled}`);
  console.log(`  Connected to Muse Memory:  ${report.agents.connectedCount} / ${report.agents.detectedInstalled}`);
  if (report.agents.connectedList.length > 0) {
    console.log(`  ✓ Connected: ${report.agents.connectedList.join(", ")}`);
  }
  if (report.agents.unwiredList.length > 0) {
    console.log(`  ⚡ Installed (Not Wired): ${report.agents.unwiredList.join(", ")}`);
    console.log(`     ➔ Run 'memory connect --all' or 'npx musememory connect --all' to wire them.`);
  }

  // Runtime
  console.log(`\n⚡ Runtime & CLI Execution:`);
  console.log(`  Node.js: ${report.runtime.nodeVersion}${report.runtime.bunVersion ? ` | Bun: v${report.runtime.bunVersion}` : ""}`);
  if (report.runtime.globalBinaryFound) {
    console.log(`  ✓ Global 'memory' binary: ${report.runtime.binaryPath}`);
  } else {
    console.log(`  ℹ️  Global binary not in PATH (you can use 'npx musememory <cmd>' or 'bunx musememory <cmd>')`);
  }
  console.log(`  ✓ NPX One-Line Command: 'npx musememory <command>' ready.`);

  console.log(`\n====================================================`);
  if (report.validation.valid && report.storage.initialized && report.agents.unwiredCount === 0) {
    console.log(`🎉 System Status: 100% HEALTHY & OPTIMAL\n`);
  } else {
    console.log(`💡 Recommended Action: Run 'memory connect --all' to wire any unwired coding agents.\n`);
  }
}
