import { createHash } from "node:crypto";
import type { Store } from "../store.ts";
import { propose } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import { listObservations, markObservationProcessed } from "./observation.ts";
import { recordNegativeLesson } from "./negative.ts";
import { redactSecrets } from "../secrets.ts";

export interface DistillationResult {
  proposedCandidates: MemoryEntry[];
  negativeLessons: MemoryEntry[];
  processedCount: number;
}

export const MAX_DISTILLATION_BODY_CHARS = 1500;

const INFORMATIONAL_COMMAND_PREFIXES = [
  "ls",
  "cat ",
  "head ",
  "tail ",
  "git status",
  "git diff",
  "git log",
  "git branch",
  "pwd",
  "echo ",
  "find ",
  "tree ",
  "which ",
  "whereis ",
  "whoami",
];

export function normalizeErrorSignature(error: string): string {
  return error
    .replace(/:\d+:\d+/g, "") // strip line:column numbers
    .replace(/:\d+/g, "") // strip line numbers
    .replace(/0x[0-9a-fA-F]+/g, "0x...") // strip memory addresses
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>") // strip UUIDs
    .replace(/\s+/g, " ")
    .trim();
}

function hasRemedyAffinity(failureCmd: string, remedyCmd: string, failureText: string): boolean {
  if (!remedyCmd) return false;
  const fLower = failureCmd.toLowerCase();
  const rLower = remedyCmd.toLowerCase();

  // 1. Same exact command or re-run
  if (fLower === rLower) return true;

  // 2. Extracted test/file path re-run
  const fTokens = fLower.split(/\s+/).filter((t) => t.includes(".") || t.includes("/"));
  for (const token of fTokens) {
    if (rLower.includes(token)) return true;
  }

  // 3. Package installer remedy verbs for missing module/dependency errors
  const isPackageRemedy =
    rLower.startsWith("bun add") ||
    rLower.startsWith("npm i") ||
    rLower.startsWith("npm install") ||
    rLower.startsWith("yarn add") ||
    rLower.startsWith("pnpm add") ||
    rLower.startsWith("pip install") ||
    rLower.startsWith("cargo add");

  if (
    isPackageRemedy &&
    (failureText.includes("Cannot find module") ||
      failureText.includes("ModuleNotFoundError") ||
      failureText.includes("not found"))
  ) {
    return true;
  }

  return false;
}

export interface FixPairCandidate {
  entry: MemoryEntry;
  failureObservationId: string;
  resolutionObservationId: string;
}

export interface FixPairMiningOptions {
  maxWindowTurns?: number; // default 5
  maxCandidates?: number; // default 3
}

/**
 * T-144: Mines sequential trajectories of Error -> Remediation -> No Recurrence
 * into structured candidate negative memories (AVOID: ...).
 */
export function mineFixPairsFromObservations(
  store: Store,
  project: string,
  options?: FixPairMiningOptions,
): FixPairCandidate[] {
  const maxWindow = options?.maxWindowTurns ?? 5;
  const maxCandidates = options?.maxCandidates ?? 3;
  const observations = listObservations(store, { processed: false, project });
  const results: FixPairCandidate[] = [];
  const seenHashes = new Set<string>();

  for (let i = 0; i < observations.length; i++) {
    if (results.length >= maxCandidates) break;

    const obsA = observations[i];
    if (obsA.processed) continue;

    const exitCodeA = obsA.metadata?.exitCode;
    const isFailureA =
      (exitCodeA !== undefined && exitCodeA !== 0) ||
      obsA.raw.includes("FAIL") ||
      obsA.raw.toLowerCase().includes("error:") ||
      (obsA.source === "test" && exitCodeA !== 0);

    if (!isFailureA) continue;

    const cmdA = (obsA.metadata?.command || obsA.summary || "").trim();

    // Look ahead within maxWindow turns for the resolution
    for (let j = i + 1; j < Math.min(observations.length, i + 1 + maxWindow); j++) {
      if (results.length >= maxCandidates) break;

      const obsB = observations[j];
      const exitCodeB = obsB.metadata?.exitCode;
      const isSuccessB = exitCodeB === 0 || obsB.raw.includes("PASS");

      if (!isSuccessB) continue;

      const cmdB = (obsB.metadata?.command || obsB.summary || "").trim();
      const lowerCmdB = cmdB.toLowerCase();

      // Skip informational commands
      const isInformational = INFORMATIONAL_COMMAND_PREFIXES.some(
        (prefix) => lowerCmdB === prefix || lowerCmdB.startsWith(prefix),
      );
      if (isInformational) continue;

      // Affinity check
      const hasAffinity = hasRemedyAffinity(cmdA, cmdB, obsA.raw);
      if (!hasAffinity) continue;

      // Normalize error signature
      const normalizedSig = normalizeErrorSignature(obsA.raw);
      const dedupHash = createHash("sha256")
        .update(`${cmdA.toLowerCase()}::${normalizedSig}`)
        .digest("hex");

      if (seenHashes.has(dedupHash)) {
        // Skip duplicate candidate
        continue;
      }
      seenHashes.add(dedupHash);

      // Scrub secrets via Vibeguard
      const safeApproach = redactSecrets(cmdA || "Failed command execution");
      const safeReason = redactSecrets(obsA.raw);
      const safeAlternative = redactSecrets(cmdB || "Resolved in subsequent command");

      // Determine template-safe reproduction command
      let testCommand: string | undefined;
      if (
        cmdA &&
        (cmdA.startsWith("bun test") || cmdA.startsWith("bunx tsc") || cmdA.startsWith("node --check"))
      ) {
        testCommand = cmdA;
      }

      const titleSummary = obsA.summary
        ? obsA.summary.replace(/^(Test failure:|Build failed:|Failure:|Command failure:)\s*/i, "").trim()
        : cmdA;

      const entry = recordNegativeLesson(store, {
        project,
        title: titleSummary ? `AVOID: ${titleSummary}` : "AVOID: Unverified failure pattern",
        failed_approach: capDistillationBody(safeApproach),
        failure_reason: capDistillationBody(safeReason),
        alternative_recommended: capDistillationBody(safeAlternative),
        reproduction_command: testCommand,
        severity: "medium",
        source: "fix_pair_miner",
        confirmed: false, // Stays candidate until verified
        source_ids: [obsA.id, obsB.id],
        tags: ["fix-pair", "mined-trajectory", obsA.source],
      });

      markObservationProcessed(store, obsA.id, entry.id);
      markObservationProcessed(store, obsB.id, entry.id);

      results.push({
        entry,
        failureObservationId: obsA.id,
        resolutionObservationId: obsB.id,
      });

      break; // Resolution paired with this failure
    }
  }

  return results;
}

/**
 * Truncates raw observation logs exceeding the distillation body limit.
 */
export function capDistillationBody(
  text: string,
  maxChars: number = MAX_DISTILLATION_BODY_CHARS,
): string {
  if (!text || text.length <= maxChars) return text;
  const truncatedCount = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n... [truncated ${truncatedCount} characters from raw observation]`;
}

/**
 * Distills unprocessed raw observations into structured candidate memories and negative lessons.
 */
export function distillObservationsToCandidates(
  store: Store,
  project: string,
  options?: { maxBodyChars?: number },
): DistillationResult {
  const proposedCandidates: MemoryEntry[] = [];
  const negativeLessons: MemoryEntry[] = [];
  const maxBodyChars = options?.maxBodyChars ?? MAX_DISTILLATION_BODY_CHARS;

  // T-144: Mine trajectory fix-pairs first
  const fixPairs = mineFixPairsFromObservations(store, project);
  for (const fp of fixPairs) {
    negativeLessons.push(fp.entry);
  }

  const unprocessed = listObservations(store, { processed: false, project });

  for (const obs of unprocessed) {
    if (obs.processed) continue;
    const text = `${obs.summary ?? ""} ${obs.raw}`;
    const lower = text.toLowerCase();

    // 1. Detect Negative Lessons (FAILED_APPROACH / DO_NOT_USE)
    if (
      lower.includes("do not use") ||
      lower.includes("failed approach") ||
      lower.includes("anti-pattern") ||
      lower.includes("caused regression") ||
      lower.includes("avoid using")
    ) {
      // Extract approach and reason
      const lines = obs.raw.split("\n").filter((l) => l.trim().length > 0);
      const title = obs.summary || lines[0].slice(0, 100);

      const negative = recordNegativeLesson(store, {
        project,
        title,
        failed_approach: capDistillationBody(lines.slice(0, 3).join("\n"), maxBodyChars),
        failure_reason: capDistillationBody(obs.raw, maxBodyChars),
        alternative_recommended: obs.metadata?.alternative || "Refer to architectural standards",
        evidence_snippet: obs.metadata?.stack_trace || obs.raw.slice(0, 200),
        severity: obs.metadata?.severity ?? "medium",
        tags: ["distilled-negative", obs.source],
      });

      negativeLessons.push(negative);
      markObservationProcessed(store, obs.id, negative.id);
      continue;
    }

    // 2. Detect Bug Fixes / Error Resolutions
    if (
      obs.source === "test" ||
      obs.source === "build" ||
      lower.includes("error:") ||
      lower.includes("exception:") ||
      lower.includes("fixed")
    ) {
      const title = obs.summary || `Resolution: ${obs.raw.slice(0, 80)}`;
      const candidate = propose(store, {
        title,
        content: capDistillationBody(obs.raw, maxBodyChars),
        project,
        type: "fix",
        source: `distilled_${obs.source}`,
        confirmed: false, // Remains candidate until verified
        tags: ["distilled-fix", obs.source],
        test_command: obs.metadata?.test_command,
      });

      proposedCandidates.push(candidate);
      markObservationProcessed(store, obs.id, candidate.id);
      continue;
    }

    // 3. Detect Architecture / Operational Conventions
    if (
      lower.includes("architecture:") ||
      lower.includes("convention:") ||
      lower.includes("configured") ||
      obs.source === "file_edit"
    ) {
      const title = obs.summary || `Convention: ${obs.raw.slice(0, 80)}`;
      const candidate = propose(store, {
        title,
        content: capDistillationBody(obs.raw, maxBodyChars),
        project,
        type: "architecture",
        source: `distilled_${obs.source}`,
        confirmed: false,
        tags: ["distilled-architecture", obs.source],
      });

      proposedCandidates.push(candidate);
      markObservationProcessed(store, obs.id, candidate.id);
      continue;
    }

    // Otherwise, mark processed without generating low-confidence noise
    markObservationProcessed(store, obs.id);
  }

  return {
    proposedCandidates,
    negativeLessons,
    processedCount: unprocessed.length,
  };
}
