import type { Store } from "../store.ts";
import { list } from "../store.ts";
import type { MemoryEntry } from "../types.ts";
import type { WhyQuery, WhyExplanation, HistoricalEvent } from "./types.ts";

/**
 * Autonomous Engineering Cognition: Explains WHY code was designed or modified the way it is.
 * Synthesizes historical bug fixes, ADRs, trade-offs, and invariants into a coherent narrative.
 */
export function explainWhyCodeIsTheWayItIs(
  store: Store,
  query: WhyQuery
): WhyExplanation {
  const entries = list(store);
  const targetLower = query.target.toLowerCase();
  const fileLower = query.filePath?.toLowerCase();
  const symLower = query.symbolName?.toLowerCase();

  const matchedEntries: MemoryEntry[] = [];

  for (const entry of entries) {
    if (entry.status === "archived" || entry.status === "superseded") continue;

    let isMatch = false;

    // 1. Direct target matching in title or content
    if (
      entry.title.toLowerCase().includes(targetLower) ||
      entry.content.toLowerCase().includes(targetLower)
    ) {
      isMatch = true;
    }

    // 2. Anchor matching
    if (entry.anchors && entry.anchors.length > 0) {
      for (const anc of entry.anchors) {
        if (fileLower && anc.file_path.toLowerCase().includes(fileLower)) {
          isMatch = true;
          break;
        }
        if (symLower && anc.symbol_name && anc.symbol_name.toLowerCase() === symLower) {
          isMatch = true;
          break;
        }
        if (anc.symbol_name && anc.symbol_name.toLowerCase().includes(targetLower)) {
          isMatch = true;
          break;
        }
        if (anc.file_path.toLowerCase().includes(targetLower)) {
          isMatch = true;
          break;
        }
      }
    }

    if (isMatch) {
      matchedEntries.push(entry);
    }
  }

  // Build Chronological Timeline
  matchedEntries.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const timeline: HistoricalEvent[] = [];
  const tradeOffs: string[] = [];
  const invariants: string[] = [];
  const adrTitles: string[] = [];
  const negativeWarnings: string[] = [];

  let primaryAdr: MemoryEntry | null = null;
  let primaryDecision: MemoryEntry | null = null;
  let hasAnchorMatch = false;
  let hasAuthoritativeVerification = false;

  for (const entry of matchedEntries) {
    const isAdr = entry.type === "adr" || entry.adr != null;
    const isNegative = entry.type === "negative" || entry.negative != null;
    const isFix = entry.type === "fix";
    const isConstraint = entry.type === "constraint" || (entry.tags && entry.tags.includes("rule"));

    let eventType: HistoricalEvent["type"] = "decision";
    if (isAdr) eventType = "adr";
    else if (isNegative) eventType = "negative";
    else if (isFix) eventType = "fix";
    else if (isConstraint) eventType = "constraint";

    timeline.push({
      date: entry.created_at.split("T")[0] || entry.created_at,
      type: eventType,
      title: entry.title,
      summary: entry.content.slice(0, 160).replace(/\n+/g, " ") + (entry.content.length > 160 ? "..." : ""),
      memory_id: entry.id,
    });

    if (isAdr) {
      if (!primaryAdr) primaryAdr = entry;
      adrTitles.push(entry.title);
      if (entry.adr?.consequences?.negative) {
        tradeOffs.push(...entry.adr.consequences.negative);
      }
    }

    if (!isAdr && (entry.type === "decision" || entry.type === "architecture") && !primaryDecision) {
      primaryDecision = entry;
    }

    if (isConstraint) {
      invariants.push(entry.title);
    }

    if (isNegative) {
      const reason = entry.negative?.failure_reason || entry.title;
      negativeWarnings.push(`⚠️ ${reason}`);
    }

    if (entry.anchors && entry.anchors.length > 0) {
      hasAnchorMatch = true;
    }

    if (entry.verification?.level === "authoritative" || entry.verification?.level === "independently-verified") {
      hasAuthoritativeVerification = true;
    }
  }

  // Synthesize Core Rationale
  let coreRationale = `Code structure around '${query.target}' has evolved across ${timeline.length} recorded events.`;
  if (primaryAdr?.adr) {
    coreRationale = `Architectural decision (${primaryAdr.title}): ${primaryAdr.adr.decision}`;
  } else if (primaryDecision) {
    coreRationale = `Core architectural decision (${primaryDecision.title}): ${primaryDecision.content.slice(0, 200)}`;
  } else if (matchedEntries.some((e) => e.type === "fix")) {
    const fixes = matchedEntries.filter((e) => e.type === "fix");
    coreRationale = `Defensive implementation hardened by ${fixes.length} historical bug fixes (${fixes.map((f) => f.title).join("; ")}).`;
  }

  // Calculate Confidence Score
  let confidence = 0.4;
  if (primaryAdr) confidence += 0.2;
  if (hasAnchorMatch) confidence += 0.2;
  if (hasAuthoritativeVerification) confidence += 0.1;
  if (timeline.length >= 2) confidence += 0.1;
  if (matchedEntries.length === 0) confidence = 0.1;

  confidence = Number(Math.min(1.0, confidence).toFixed(2));

  return {
    target: query.target,
    core_rationale: coreRationale,
    timeline,
    trade_offs_accepted: Array.from(new Set(tradeOffs)),
    active_invariants: Array.from(new Set(invariants)),
    associated_adrs: Array.from(new Set(adrTitles)),
    negative_warnings: Array.from(new Set(negativeWarnings)),
    confidence_score: confidence,
  };
}
