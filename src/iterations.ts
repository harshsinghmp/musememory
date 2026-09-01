import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { scanSecrets } from "./secrets.ts";
import type { IterationEntry, CriticVerdict } from "./types.ts";

export type { IterationEntry, CriticVerdict };

export function getIterationsFilePath(memoryDir: string): string {
  return join(memoryDir, "iterations.jsonl");
}

export function recordIteration(
  memoryDir: string,
  input: {
    iteration_index: number;
    critic_verdict: CriticVerdict;
    largest_fix_identified: string;
    test_results: string;
    diff_hash?: string;
    timestamp?: string;
    metadata?: Record<string, any>;
  },
): IterationEntry {
  const textToScan = `${input.largest_fix_identified}\n${input.test_results}`;
  const secrets = scanSecrets(textToScan);
  if (secrets.length > 0) {
    throw new Error(`Vibeguard: Detected secret in iteration record: ${secrets.join(", ")}`);
  }

  const entry: IterationEntry = {
    iteration_index: input.iteration_index,
    critic_verdict: input.critic_verdict,
    largest_fix_identified: input.largest_fix_identified,
    test_results: input.test_results,
    diff_hash: input.diff_hash,
    timestamp: input.timestamp ?? new Date().toISOString(),
    metadata: input.metadata,
  };

  mkdirSync(memoryDir, { recursive: true });
  const filePath = getIterationsFilePath(memoryDir);
  appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");

  return entry;
}

export function listIterations(memoryDir: string): IterationEntry[] {
  const filePath = getIterationsFilePath(memoryDir);
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export function clearIterations(memoryDir: string): void {
  const filePath = getIterationsFilePath(memoryDir);
  if (existsSync(filePath)) {
    writeFileSync(filePath, "", "utf-8");
  }
}

export interface IterationStatusReport {
  totalIterations: number;
  lastVerdict?: CriticVerdict;
  isPlateaued: boolean;
  isRegressed: boolean;
  consecutiveFailures: number;
  recommendation: string;
}

export function detectIterationStatus(memoryDir: string): IterationStatusReport {
  const iterations = listIterations(memoryDir);
  if (iterations.length === 0) {
    return {
      totalIterations: 0,
      isPlateaued: false,
      isRegressed: false,
      consecutiveFailures: 0,
      recommendation: "No active iteration loops recorded.",
    };
  }

  const last = iterations[iterations.length - 1];
  let consecutiveFailures = 0;
  for (let i = iterations.length - 1; i >= 0; i--) {
    if (iterations[i].critic_verdict !== "pass") {
      consecutiveFailures++;
    } else {
      break;
    }
  }

  const isRegressed = last.critic_verdict === "regressed";

  // Check plateau: explicit verdict, repeated diff hash, or >=3 consecutive failures
  let isPlateaued = last.critic_verdict === "plateaued" || consecutiveFailures >= 3;
  if (!isPlateaued && iterations.length >= 2) {
    const prev = iterations[iterations.length - 2];
    if (last.diff_hash && prev.diff_hash && last.diff_hash === prev.diff_hash) {
      isPlateaued = true;
    }
  }

  let recommendation = "Proceed with next improvement iteration.";
  if (isRegressed) {
    recommendation = "Revert last change immediately: regression detected in test results.";
  } else if (isPlateaued) {
    recommendation = "Halt iteration loop: Plateau detected (no improvement or repeated state). Human review required.";
  } else if (last.critic_verdict === "pass") {
    recommendation = "Loop passed: All criteria and tests verified. Ready to ship.";
  }

  return {
    totalIterations: iterations.length,
    lastVerdict: last.critic_verdict,
    isPlateaued,
    isRegressed,
    consecutiveFailures,
    recommendation,
  };
}
