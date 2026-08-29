import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { getGlobalMemoryDir } from "../root.ts";
import { userFilePath, initUserProfile } from "../user.ts";
import { detectProviders, runMigration } from "../migrator/index.ts";
import { getGraphStatus } from "../graph.ts";
import { requireRoot, usageError, fail, type ParsedArgs } from "./shared.ts";

export const MUSE_MEMORY_DIRECTIVE = `<!-- musememory:start -->
## 🧠 Persistent Cognitive Memory (Muse Memory)

You are connected to **Muse Memory** via the \`memory\` MCP server.

### 🚀 Session Start & Task Lifecycle:
1. **Session Start / Context Loading**: At the start of a task or session, call \`get_context(query=...)\` to retrieve the active user profile (\`USER.md\`), active hard constraints (\`CURRENT.md\`), and top relevant past architecture decisions/bug fixes before answering or modifying code.
2. **Active Working Constraints**: When hard constraints, open loops, or project invariants are established or modified, immediately record them to \`CURRENT.md\` via \`memory_capture(type="constraint")\` or updating \`CURRENT.md\`.
3. **Learning Durable Knowledge**: Whenever you solve a non-trivial bug, make an architectural decision, discover an operational rule, or learn user preferences, immediately call \`memory_capture\` to persist it as an atomic memory unit.
4. **Verification & Supersession**: When replacing outdated patterns or obsolete rules, call \`memory_supersede\` to link the old memory to the new confirmed memory so future sessions never hallucinate deprecated methods.
<!-- musememory:end -->`;

export function ensureProjectAgentInstructions(targetDir: string): void {
  const agentsMdPath = join(targetDir, "AGENTS.md");
  if (existsSync(agentsMdPath)) {
    try {
      const existing = readFileSync(agentsMdPath, "utf8");
      if (existing.includes("<!-- agentmemory:start -->")) {
        const updated = existing.replace(
          /<!-- agentmemory:start -->[\s\S]*?<!-- agentmemory:end -->/,
          MUSE_MEMORY_DIRECTIVE,
        );
        writeFileSync(agentsMdPath, updated, "utf8");
      } else if (!existing.includes("<!-- musememory:start -->") && !existing.includes("Muse Memory")) {
        writeFileSync(agentsMdPath, `${existing.trim()}\n\n${MUSE_MEMORY_DIRECTIVE}\n`, "utf8");
      }
    } catch {}
  } else {
    const initialContent = `# Project Guidelines & Agent Instructions\n\n${MUSE_MEMORY_DIRECTIVE}\n`;
    writeFileSync(agentsMdPath, initialContent, "utf8");
  }
}

export async function handleInstallCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const isGlobal = flags["global"] === "true" || flags["g"] === "true";
  const targetDir = positional[0] ? join(process.cwd(), positional[0]) : process.cwd();
  const memoryDir = isGlobal ? getGlobalMemoryDir() : join(targetDir, ".memory");
  const globalDir = getGlobalMemoryDir();
  mkdirSync(join(memoryDir, "memories"), { recursive: true });
  mkdirSync(join(globalDir, "memories"), { recursive: true });

  const currentPath = join(memoryDir, "CURRENT.md");
  if (!existsSync(currentPath)) {
    writeFileSync(currentPath, "# Active Project Constraints\n", "utf8");
  }

  // Initialize global USER.md if not present
  const globalUserPath = userFilePath(globalDir);
  if (!existsSync(globalUserPath)) {
    const { promptSingleSelect } = await import("../prompt.ts");
    const archetypeOptions = [
      { id: "developer" as const, label: "Software Engineer / Developer", hint: "Code-first, direct, strict typing" },
      { id: "designer" as const, label: "UI/UX Designer & Creative Technologist", hint: "Visual hierarchy, CSS, design systems" },
      { id: "marketer" as const, label: "Growth & Marketing Strategist", hint: "Conversion, punchy copy, SEO" },
      { id: "casual" as const, label: "Casual End User / Problem Solver", hint: "Plain English, jargon-free answers" },
      { id: "custom" as const, label: "Custom Profile", hint: "Blank customizable template" },
    ];
    const selectedArchetype = await promptSingleSelect(
      "Select your primary role archetype for USER.md profile setup:",
      archetypeOptions,
      "developer",
    );
    initUserProfile(globalDir, selectedArchetype);
    console.log(`[+] Initialized global USER.md profile (${globalUserPath}) with '${selectedArchetype}' archetype.`);
  }

  if (!isGlobal) {
    ensureProjectAgentInstructions(targetDir);
  }

  // Update global ~/.agents/AGENTS.md if present
  const globalAgentsMd = join(homedir(), ".agents", "AGENTS.md");
  if (existsSync(globalAgentsMd)) {
    try {
      const existing = readFileSync(globalAgentsMd, "utf8");
      if (existing.includes("<!-- agentmemory:start -->")) {
        const updated = existing.replace(
          /<!-- agentmemory:start -->[\s\S]*?<!-- agentmemory:end -->/,
          MUSE_MEMORY_DIRECTIVE,
        );
        writeFileSync(globalAgentsMd, updated, "utf8");
      }
    } catch {}
  }

  console.log(`[+] Initialized Muse Memory in ${memoryDir}`);

  // 1. Auto-connect detected coding agents
  const { connectAgent } = await import("../connect.ts");
  const reports = connectAgent("all", undefined, { dryRun: false, force: false });
  if (reports.length > 0) {
    console.log(`\n[+] Auto-wired ${reports.length} detected coding agent(s) with zero permissions:`);
    for (const r of reports) {
      console.log(`  * ${r.agentName}: ${r.message}`);
    }
  }

  // 2. Check for legacy memory providers
  const detected = detectProviders(targetDir).filter((p) => p.detected);
  if (detected.length > 0) {
    console.log(`\n[!] Detected ${detected.length} external memory provider(s): ${detected.map((d) => d.name).join(", ")}`);
    console.log(`   -> Run 'memory migrate' to auto-import legacy memories.`);
  }

  console.log(`\n[OK] Muse Memory is ready! Use 'memory doctor' to verify system health.`);
  return 0;
}

export async function handleDoctorCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const { runDoctor, printDoctorReport } = await import("../doctor.ts");
  const isGlobal = flags["global"] === "true" || flags["g"] === "true";
  const report = await runDoctor(positional[0], { global: isGlobal });
  printDoctorReport(report);
  return report.validation.valid ? 0 : 1;
}

export async function handleUninstallCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const { disconnectAllAgents, disconnectSingleAgent } = await import("../connect.ts");
  const agent = positional[0];
  const purge = flags["purge"] === "true";
  const dryRun = flags["dry-run"] === "true";

  console.log(`[CLEAN] Running Muse Memory Uninstaller${dryRun ? " [DRY RUN]" : ""}...`);
  if (agent && agent !== "all") {
    const report = disconnectSingleAgent(agent, undefined, { dryRun });
    console.log(`  * ${report.agentName}: ${report.message}`);
  } else {
    const reports = disconnectAllAgents(undefined, { dryRun });
    console.log(`\n[+] Unwired ${reports.length} coding agent(s):`);
    for (const r of reports) {
      console.log(`  * ${r.agentName}: ${r.message}`);
    }
  }

  if (purge) {
    const ctx = requireRoot(flags);
    if (ctx && existsSync(ctx.memoryDir) && !dryRun) {
      const { rmSync } = await import("node:fs");
      rmSync(ctx.memoryDir, { recursive: true, force: true });
      console.log(`  [PURGED] Memory directory removed: ${ctx.memoryDir}`);
    }
  } else {
    console.log(`\n[INFO] Memory files preserved in .memory/. Use 'memory uninstall --purge' to remove data.`);
  }
  return 0;
}

export async function handleInitCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const isGlobal = flags["global"] === "true";
  const targetDir = positional[0] ? join(process.cwd(), positional[0]) : process.cwd();
  const memoryDirName = flags["legacy"] === "true" ? ".musememory" : ".memory";
  const memoryDir = isGlobal
    ? getGlobalMemoryDir()
    : join(targetDir, memoryDirName);
  mkdirSync(join(memoryDir, "memories"), { recursive: true });
  const currentPath = join(memoryDir, "CURRENT.md");
  if (!existsSync(currentPath)) {
    writeFileSync(currentPath, "# Active Project Constraints\n", "utf8");
  }
  if (!isGlobal) {
    ensureProjectAgentInstructions(targetDir);
  }
  console.log(`Initialized memory store in ${memoryDir}`);
  const detected = detectProviders(targetDir);
  const found = detected.filter((d) => d.detected);
  if (found.length > 0) {
    console.log(`[INFO] Detected existing memory from: ${found.map((f) => f.name).join(", ")}. Run 'memory migrate' to auto-import.`);
  }
  return 0;
}

export async function handleDetectCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  const startDir = ctx ? ctx.root : process.cwd();
  const detected = detectProviders(startDir);
  console.log(`[SCAN] Scanning for external agent memory providers:`);
  let count = 0;
  for (const p of detected) {
    if (p.detected) {
      count++;
      console.log(`  * ${p.name} (${p.category}, scope: ${p.scope})`);
      for (const path of p.resolvedPaths) {
        console.log(`    -> found: ${path}`);
      }
    }
  }
  if (count === 0) {
    console.log(`  (no external memory providers detected on this machine)`);
  } else {
    console.log(`\nFound ${count} memory provider(s). Run 'memory migrate' to import.`);
  }
  return 0;
}

export async function handleMigrateCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  let provider = flags["from"] || positional[0];
  const all = flags["all"] === "true";
  const dryRun = flags["dry-run"] === "true";
  const overwrite = flags["overwrite"] === "true";
  const project = flags["project"];

  // Interactive provider selection if not specified and stdin is TTY
  if (!provider && !all && process.stdin.isTTY) {
    const detected = detectProviders(ctx.root).filter((p) => p.detected);
    if (detected.length > 1) {
      const { promptMultiSelect } = await import("../prompt.ts");
      const selected = await promptMultiSelect(
        "[SCAN] Detected External Memory Providers on Workstation:",
        detected.map((p) => ({
          id: p.id,
          label: p.name,
          hint: p.resolvedPaths[0],
          category: p.category,
        }))
      );
      if (selected.length === 0) return 0;
      if (selected.length < detected.length) {
        provider = selected.join(",");
      }
    }
  }

  console.log(`[MIGRATE] Starting Muse Memory Migration Engine${dryRun ? " [DRY RUN]" : ""}...`);
  const report = await runMigration(ctx.store, ctx.memoryDir, {
    provider,
    all: all || !provider,
    dryRun,
    overwrite,
    project,
  });

  console.log(`\nMigration Report:`);
  for (const p of report.providers) {
    const icon = p.status === "success" ? "[OK]" : (p.status === "skipped" ? "[-]" : "[FAIL]");
    console.log(`  ${icon} ${p.providerName}: ${p.migratedCount} memories migrated, ${p.supersededCount} archived, ${p.constraintsCount} constraints, ${p.secretsRedacted} secrets scrubbed`);
    if (p.error) console.log(`     Error: ${p.error}`);
  }

  console.log(`\nSummary:`);
  console.log(`  Total memories imported: ${report.totalMigrated}`);
  console.log(`  Total superseded/archived: ${report.totalSuperseded}`);
  console.log(`  Total working constraints (CURRENT.md): ${report.totalConstraints}`);
  if (report.totalSecretsRedacted > 0) {
    console.log(`  [SECURITY] Total secrets blocked/redacted by Vibeguard: ${report.totalSecretsRedacted}`);
  }
  if (dryRun) {
    console.log(`\n[DRY RUN complete - no files were written]`);
  }
  return 0;
}

export async function handleAgentsCommand(): Promise<number> {
  const { detectAgents } = await import("../agents/detect.ts");
  const agents = detectAgents();
  const installed = agents.filter((a) => a.installed);
  const connected = installed.filter((a) => a.connected);

  console.log(`[AGENTS] Workstation Coding Agents Scan (80+ Baseline):`);
  console.log(`------------------------------------------------`);
  for (const a of agents) {
    if (a.installed) {
      const statusTag = a.connected ? "[CONNECTED]" : "[INSTALLED - NOT WIRED]";
      console.log(`  ${statusTag} ${a.name} (${a.stars ?? "active"}) -- ${a.category}`);
      if (a.binaryPath) console.log(`      -> binary: ${a.binaryPath}`);
      if (a.configPath) console.log(`      -> config: ${a.configPath}`);
    }
  }

  console.log(`\nSummary:`);
  console.log(`  Installed Agents Detected: ${installed.length}`);
  console.log(`  Connected with Muse Memory: ${connected.length}`);
  console.log(`  Uninstalled/Skipped:       ${agents.length - installed.length}`);
  if (installed.length > connected.length) {
    console.log(`\n[TIP] Run 'memory connect --all' to auto-wire the remaining ${installed.length - connected.length} installed agent(s) with zero-permission auto-approval.`);
  }
  return 0;
}

export async function handleConnectCommand({ positional, flags }: ParsedArgs): Promise<number> {
  let agent = positional[0];
  const { connectAgent } = await import("../connect.ts");
  const { detectAgents } = await import("../agents/detect.ts");
  const dryRun = flags["dry-run"] === "true";
  const force = flags["force"] === "true";
  const isAllFlag = flags["all"] === "true" || flags["a"] === "true";

  // Interactive agent selection if no specific target or --all flag given in interactive TTY
  if (!agent && !isAllFlag && process.stdin.isTTY) {
    const detected = detectAgents().filter((a) => a.installed);
    if (detected.length > 0) {
      const { promptMultiSelect } = await import("../prompt.ts");
      const selected = await promptMultiSelect(
        "[CONNECT] Select Detected Coding Agents & IDEs to Wire with Muse Memory MCP:",
        detected.map((a) => ({
          id: a.id,
          label: a.name,
          hint: a.configPath || a.binaryPath,
          category: a.category,
        }))
      );
      if (selected.length === 0) return 0;
      agent = selected.join(",");
    }
  }

  if (!agent) {
    agent = "all";
  }

  try {
    const reports = connectAgent(agent, undefined, { dryRun, force });
    if (reports.length === 0) {
      console.log(`[INFO] No coding agents were detected on this machine.`);
      console.log(`Use 'memory connect <agent> --force' to configure a specific agent, or 'memory agents' to list all supported platforms.`);
      return 0;
    }

    console.log(`[CONNECT] Connected ${reports.length} coding agent(s)${dryRun ? " [DRY RUN]" : ""}:`);
    for (const r of reports) {
      console.log(`  * ${r.agentName} (${r.agent}): ${r.message}`);
    }

    if (agent === "all" || isAllFlag) {
      const allAgents = detectAgents();
      const uninstalledCount = allAgents.length - reports.length;
      console.log(`\n[SHIELD] Clean Workspace Guarantee: Skipped ${uninstalledCount} uninstalled agents to prevent creating unneeded files/folders.`);
    }
    return 0;
  } catch (err: any) {
    return fail(`connect error: ${err.message}`);
  }
}

export async function handleUiCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const port = flags["port"] ? parseInt(flags["port"], 10) : 3000;
  const { startUiServer } = await import("../ui.ts");
  const srv = await startUiServer({
    port,
    memoryDir: ctx.memoryDir,
    store: ctx.store,
  });
  console.log(`[UI] Muse Memory Visual Dashboard running at: http://localhost:${srv.port}`);
  console.log(`Press Ctrl+C to stop.`);
  await new Promise<void>(() => {});
  return 0;
}

export async function handleGraphCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const sub = positional[0];
  if (sub === "status") {
    const status = getGraphStatus(ctx.root);
    console.log(`graph provider: ${status.provider}`);
    console.log(`available: ${status.available}`);
    console.log(`root: ${status.root}`);
    if (status.graphRevision) console.log(`revision: ${status.graphRevision}`);
    if (status.symbolCount !== undefined) console.log(`symbols: ${status.symbolCount}`);
    return 0;
  }
  return usageError("graph requires status");
}

export async function handleMcpCommand(): Promise<number> {
  const { runMcpServer } = await import("../mcp.ts");
  await runMcpServer();
  return 0;
}

export async function handleDaemonCommand({ flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const port = flags["port"] ? parseInt(flags["port"], 10) : 7878;
  const { startHub } = await import("../daemon.ts");
  const hub = await startHub(port, ctx.memoryDir);
  console.log(`Agency hub listening on ${hub.url}`);
  console.log(`Publish events: curl -X POST http://localhost:${hub.port}/publish -d '{"type":"agent.joined","payload":{"name":"me"}}'`);
  return new Promise<number>(() => {
    // Run until terminated; SIGINT/SIGTERM default handling tears down the server.
  });
}
