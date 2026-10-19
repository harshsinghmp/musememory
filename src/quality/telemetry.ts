import type { Store } from "../store.ts";
import { list, save } from "../store.ts";
import type { MemoryEntry, MemoryUtility } from "../types.ts";
import { ensureUtility } from "./utility.ts";

export type RecallUsageStatus = "high_roi" | "healthy" | "dead_weight" | "untested";

export interface RecallUsageJoinRecord {
  memory_id: string;
  title: string;
  project: string;
  retrieval_count: number;
  application_count: number;
  successful_applications: number;
  failed_applications: number;
  regressions: number;
  usage_rate: number;
  roi_score: number;
  status: RecallUsageStatus;
  last_updated_at: string;
}

export interface RecallUsageTelemetryReport {
  total_memories: number;
  joined_count: number;
  overall_usage_rate: number;
  average_roi: number;
  high_roi_count: number;
  dead_weight_count: number;
  records: RecallUsageJoinRecord[];
}

/**
 * T-127: Calculates the usage rate (applications per retrieval).
 */
export function calculateUsageRate(utility?: MemoryUtility): number {
  if (!utility || utility.retrieval_count === 0) return 0.0;
  return Number((utility.application_count / utility.retrieval_count).toFixed(4));
}

/**
 * T-127: Calculates normalized ROI score [0.0 - 1.0] reflecting net value per retrieval.
 * Heavily penalizes memories retrieved repeatedly without application (dead-weight).
 */
export function calculateRoiScore(utility?: MemoryUtility): number {
  if (!utility || utility.retrieval_count === 0) {
    return 0.5; // neutral prior for untested memories
  }

  const {
    retrieval_count,
    application_count,
    successful_applications,
    failed_applications,
    regressions,
  } = utility;

  // Dead-weight decay: retrieved >= 5 times with 0 applications
  if (application_count === 0) {
    if (retrieval_count >= 5) {
      // Linearly degrade from 0.4 down to 0.05
      const penalty = Math.min(0.35, (retrieval_count - 4) * 0.05);
      return Number(Math.max(0.05, 0.4 - penalty).toFixed(4));
    }
    return 0.5;
  }

  // Value calculation: rewards successful application, penalizes failure and regression
  const valuePoints =
    successful_applications * 1.0 -
    failed_applications * 0.5 -
    regressions * 1.5;

  const costBasis = Math.max(1, retrieval_count);
  const normalizedValue = valuePoints / (costBasis + 1);

  // Map to [0.0, 1.0] centered at 0.5
  const roi = Math.max(0.0, Math.min(1.0, 0.5 + normalizedValue * 0.5));
  return Number(roi.toFixed(4));
}

/**
 * Computes telemetry join record for a single memory entry.
 */
export function computeRecallUsageRecord(entry: MemoryEntry): RecallUsageJoinRecord {
  const utility = entry.utility;
  const retrieval_count = utility?.retrieval_count ?? 0;
  const application_count = utility?.application_count ?? 0;
  const successful_applications = utility?.successful_applications ?? 0;
  const failed_applications = utility?.failed_applications ?? 0;
  const regressions = utility?.regressions ?? 0;

  const usage_rate = calculateUsageRate(utility);
  const roi_score = calculateRoiScore(utility);

  let status: RecallUsageStatus = "healthy";
  if (retrieval_count === 0) {
    status = "untested";
  } else if (retrieval_count >= 5 && application_count === 0) {
    status = "dead_weight";
  } else if (roi_score >= 0.7 && usage_rate >= 0.3) {
    status = "high_roi";
  }

  return {
    memory_id: entry.id,
    title: entry.title,
    project: entry.project,
    retrieval_count,
    application_count,
    successful_applications,
    failed_applications,
    regressions,
    usage_rate,
    roi_score,
    status,
    last_updated_at: new Date().toISOString(),
  };
}

/**
 * T-127: Joins recall and usage telemetry across store, updates entry utilities,
 * and compiles comprehensive ROI report.
 */
export function joinRecallUsageTelemetry(
  store: Store,
  options: { persist?: boolean } = { persist: true },
): RecallUsageTelemetryReport {
  const entries = list(store);
  const records: RecallUsageJoinRecord[] = [];

  let totalUsageRate = 0;
  let totalRoi = 0;
  let highRoiCount = 0;
  let deadWeightCount = 0;

  for (const entry of entries) {
    const record = computeRecallUsageRecord(entry);
    records.push(record);

    totalUsageRate += record.usage_rate;
    totalRoi += record.roi_score;

    if (record.status === "high_roi") highRoiCount++;
    if (record.status === "dead_weight") deadWeightCount++;

    // Update entry utility with joined metrics
    if (options.persist) {
      const util = ensureUtility(entry);
      if (util.usage_rate !== record.usage_rate || util.roi_score !== record.roi_score) {
        util.usage_rate = record.usage_rate;
        util.roi_score = record.roi_score;
        entry.utility = util;
        save(store, entry);
      }
    }
  }

  const count = entries.length;
  const overall_usage_rate = count > 0 ? Number((totalUsageRate / count).toFixed(4)) : 0;
  const average_roi = count > 0 ? Number((totalRoi / count).toFixed(4)) : 0.5;

  return {
    total_memories: count,
    joined_count: records.length,
    overall_usage_rate,
    average_roi,
    high_roi_count: highRoiCount,
    dead_weight_count: deadWeightCount,
    records,
  };
}

/**
 * Returns scoring multiplier based on memory ROI and usage telemetry.
 */
export function computeRoiScoreMultiplier(entry: MemoryEntry): { multiplier: number; reasonToken?: string } {
  const roi = entry.utility?.roi_score ?? calculateRoiScore(entry.utility);
  const usageRate = entry.utility?.usage_rate ?? calculateUsageRate(entry.utility);
  const retrievalCount = entry.utility?.retrieval_count ?? 0;

  // Dead-weight: retrieved >= 5 times with 0 usages
  if (retrievalCount >= 5 && usageRate === 0) {
    return { multiplier: 0.70, reasonToken: "roi_dead_weight_penalty" };
  }

  // High ROI: high success rate with solid usage
  if (roi >= 0.75 && usageRate >= 0.3) {
    return { multiplier: 1.15, reasonToken: "roi_high_value_boost" };
  }

  // Moderate ROI boost
  if (roi >= 0.65) {
    return { multiplier: 1.05, reasonToken: "roi_positive_boost" };
  }

  return { multiplier: 1.0 };
}
