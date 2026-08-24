import { parseFlags, requireRoot, printEntry, type ParsedArgs } from "./cli/shared.ts";
import {
  handleInstallCommand,
  handleDoctorCommand,
  handleUninstallCommand,
  handleInitCommand,
  handleDetectCommand,
  handleMigrateCommand,
  handleAgentsCommand,
  handleConnectCommand,
  handleUiCommand,
  handleGraphCommand,
  handleMcpCommand,
} from "./cli/ecosystem.ts";
import {
  handleContextCommand,
  handleSearchCommand,
  handleRecallCommand,
  handleHarvestCommand,
  handleImportTranscriptCommand,
  handleSearchTranscriptCommand,
  handleHookCommand,
  handleHarvestAutoCommand,
} from "./cli/retrieval.ts";
import { handleCurrentCommand, handleUserCommand, handleCoreCommand } from "./cli/persona.ts";
import {
  handleProposeCommand,
  handleCaptureCommand,
  handleLinkCommand,
  handleConfirmCommand,
  handleSupersedeCommand,
  handleMarkStaleCommand,
  handleRejectCommand,
  handleDeleteCommand,
  handleAuditCommand,
  handleExportCommand,
  handleImportCommand,
  handleValidateCommand,
  handleBriefingCommand,
  handleListCommand,
  handleStatsCommand,
  handleStaleCommand,
  handleConsolidateCommand,
  handleTraceCommand,
  handleLoopsCommand,
  handleDistillCommand,
  handleVerifyCommand,
  handleSessionCommand,
} from "./cli/lifecycle.ts";

export { parseFlags, requireRoot, printEntry, type ParsedArgs };

export const USAGE = `
Muse Memory (memory / musememory) -- Autonomous Persistent Memory for AI Agents & Agency Networks

Usage:
  memory <command> [arguments] [options]

Core Memory Lifecycle Commands:
  install [dir]                 Run interactive onboarding wizard & auto-wire installed agents
  doctor [dir]                  Run comprehensive ecosystem health diagnostic
  uninstall [agent] [--purge]   Disconnect agents and optionally purge .memory data
  init [dir]                    Initialize .memory/ in workspace or current dir
  capture <text> --project P    Capture new memory unit with Vibeguard secret inspection
  propose <text> --project P    Propose a candidate memory entry
  confirm <id>                  Promote candidate or stale memory to confirmed status
  supersede <old_id> --with <new_id> Replace outdated knowledge with confirmed target
  link <id> --related <id,...>  Link related memories bidirectionally
  mark-stale <id> [--reason R]  Deprecate decaying knowledge
  reject <id>                   Reject candidate entry
  delete <id> [--reason R]      Permanently delete entry and log audit record
  list / ls [--status S] [--type T] [--project P] List memory entries with multi-field filtering
  stats                         Display total memory counts and status/type distribution
  stale [--days N]              List entries exceeding staleness policy
  consolidate [--project P] [--dry-run]  Cluster confirmed memories into scene rollups
  trace <id> [--depth N]        Walk causal graph pathways from an entry (default depth 5)
  loops                         Prioritized open-loop report: git state, stale candidates, constraints
  distill [--min-count N] [--dry-run]  Distill recurring fix patterns into .agents/skills/ folders
  verify <id> [--timeout S]     Execute a fix entry's test_command; exit 0 promotes + independently verifies
  briefing [--limit N]          Executive summary of active, recurring, and stale memories

Context & Retrieval Commands:
  context [query] [--limit N] [--token-budget N] [--depth L1|L2|L3] Top-ranked prompt injection context
  search <query> [--limit N] [--token-budget N] Scored token retrieval
  recall [query]                Search active/confirmed memories with filters
  search-transcript <query> [file.jsonl] [--window N] Full-text transcript search with bookends

Persona & Constraints Commands:
  user [get|init|set] [--global] Manage USER.md persona & working preferences
  current [get|set]             Manage CURRENT.md active project constraints
  core [tier] [--set T|--remove|--show] Manage CORE.md permanent partitions (identity|directives|conventions|context)

Ecosystem, Migration & Connectivity:
  connect [agent|all] [--force] Auto-wire MCP into detected coding agents with zero permissions
  agents / detect-agents        Scan workstation for 80+ coding agent platforms
  detect                        Scan machine for 24+ external memory formats
  migrate [--from P] [--all]    Ingest external memories with state preservation & secret scrubbing
  harvest <file|text> --project P Distill conversation transcripts into structured memory units
  harvest-auto [--from <glob>] [--project P] Harvest inbox transcripts as candidates and archive them
  hook install --git            Install the harvester as a git pre-commit hook (never clobbers)
  import-transcript <file.jsonl> Universal JSONL transcript ingestion with session binding
  export [--out file.json]      Export portable JSON memory snapshot
  import <file.json>            Import portable JSON memory snapshot
  validate [--dry-run]          Validate YAML schemas and referential integrity
  graph status                  Inspect CodeGraph AST provider status
  ui / dashboard [--port 3000]  Launch embedded visual knowledge graph UI
  mcp                           Run stdio MCP server for agent platforms
`;

export async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    console.log(USAGE);
    return 0;
  }

  const cmd = argv[0];
  const rest = argv.slice(1);
  const parsed = parseFlags(rest);

  switch (cmd) {
    // Ecosystem & Installation
    case "install":
      return handleInstallCommand(parsed);
    case "doctor":
      return handleDoctorCommand(parsed);
    case "uninstall":
      return handleUninstallCommand(parsed);
    case "init":
      return handleInitCommand(parsed);
    case "detect":
      return handleDetectCommand(parsed);
    case "migrate":
      return handleMigrateCommand(parsed);
    case "agents":
    case "detect-agents":
      return handleAgentsCommand();
    case "connect":
      return handleConnectCommand(parsed);
    case "ui":
    case "dashboard":
      return handleUiCommand(parsed);
    case "graph":
      return handleGraphCommand(parsed);
    case "mcp":
      return handleMcpCommand();

    // Context & Retrieval
    case "context":
      return handleContextCommand(parsed);
    case "search":
      return handleSearchCommand(parsed);
    case "recall":
      return handleRecallCommand(parsed);
    case "search-transcript":
    case "search-transcripts":
      return handleSearchTranscriptCommand(parsed);
    case "harvest":
      return handleHarvestCommand(parsed);
    case "harvest-auto":
      return handleHarvestAutoCommand(parsed);
    case "hook":
      return handleHookCommand(parsed);
    case "import-transcript":
    case "import-jsonl":
      return handleImportTranscriptCommand(parsed);

    // Persona & Working Constraints
    case "user":
      return handleUserCommand(parsed);
    case "current":
      return handleCurrentCommand(parsed);
    case "core":
      return handleCoreCommand(parsed);

    // Lifecycle & Governance
    case "propose":
      return handleProposeCommand(parsed);
    case "capture":
      return handleCaptureCommand(parsed);
    case "confirm":
      return handleConfirmCommand(parsed);
    case "supersede":
      return handleSupersedeCommand(parsed);
    case "link":
      return handleLinkCommand(parsed);
    case "mark-stale":
      return handleMarkStaleCommand(parsed);
    case "reject":
      return handleRejectCommand(parsed);
    case "delete":
      return handleDeleteCommand(parsed);
    case "audit":
      return handleAuditCommand(parsed);
    case "export":
      return handleExportCommand(parsed);
    case "import":
      return handleImportCommand(parsed);
    case "validate":
      return handleValidateCommand(parsed);
    case "briefing":
      return handleBriefingCommand(parsed);
    case "ls":
    case "list":
      return handleListCommand(parsed);
    case "stats":
      return handleStatsCommand(parsed);
    case "stale":
      return handleStaleCommand(parsed);
    case "consolidate":
      return handleConsolidateCommand(parsed);
    case "trace":
      return handleTraceCommand(parsed);
    case "loops":
      return handleLoopsCommand(parsed);
    case "distill":
      return handleDistillCommand(parsed);
    case "verify":
      return handleVerifyCommand(parsed);
    case "session":
      return handleSessionCommand(parsed);

    default:
      console.error(`Error: unknown command "${cmd}"`);
      return 2;
  }
}
