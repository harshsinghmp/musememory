import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../store.ts";
import { list } from "../store.ts";
import { rankAndRetrieveMemories } from "../retrieval/ranking.ts";
import { parseCurrentFile } from "../governor.ts";
import type { MemoryEntry, CodeAnchor } from "../types.ts";
import { gateCandidates } from "./freshness.ts";
import type { MuseContextInput, FusedContextResult, ContextManifestItem } from "./types.ts";
import { validateDigestIntegrity, dualMeasureTokens } from "../compaction/tokens.ts";
import {
  defaultReinjectionTracker,
  filterSelfEchoes,
  defaultSeenChunkTracker,
} from "../retrieval/suppression.ts";
import { defaultPrefetchCache } from "../retrieval/prefetch.ts";
import { evaluateTrivialPromptGate } from "./trivial_gate.ts";
import { getOrBuildResidentRouteMap, matchResidentRoutes } from "./route_map.ts";
import {
  TIER_2_DEFAULT_BUDGET,
  USER_PROFILE_BUDGET_RATIO,
  USER_PROFILE_DEFAULT_BUDGET,
} from "../retrieval/tier_budgets.ts";
import { isDraftMemory } from "../drafts.ts";
import { resolveConstitutionalRules, type ConstitutionalRule } from "./constitution.ts";
import { mergeDegradedFaults, formatDegradedFaultNotice } from "../retrieval/faults.ts";

function estimateTokens(text: string): number {
  return dualMeasureTokens(text).conservativeTokens;
}

function estimateEntryTokens(entry: MemoryEntry): number {
  return estimateTokens(`${entry.title}\n${entry.content}\n${entry.tags?.join(" ")}`);
}

/**
 * Flagship unified context orchestrator.
 * Fuses active constraints, ranked memories, code anchors, and negative lessons
 * into a single token-budgeted response with suggested next actions.
 */
export async function resolveMuseContext(
  store: Store,
  workspaceRoot: string,
  input: MuseContextInput
): Promise<FusedContextResult> {
  const budget = input.token_budget ?? TIER_2_DEFAULT_BUDGET;
  let remainingBudget = budget;
  let usedBudget = 0;

  // 1. Build composite search query
  const queryParts: string[] = [];
  if (input.query) queryParts.push(input.query);
  if (input.symbol) queryParts.push(input.symbol);
  if (input.active_file) queryParts.push(input.active_file);
  if (input.error_message) queryParts.push(input.error_message);
  if (input.task_intent) queryParts.push(input.task_intent);

  const compositeQuery = queryParts.join(" ") || "active constraints and architecture";

  // T-112: Topic-overlap >0.6 prefetch skip check
  if (
    input.session_id &&
    (input.check_topic_overlap || input.topic_overlap_threshold !== undefined)
  ) {
    const skipDecision = defaultPrefetchCache.checkPrefetchSkip(
      input.session_id,
      compositeQuery,
      { threshold: input.topic_overlap_threshold }
    );
    if (skipDecision.skip) {
      const cached = defaultPrefetchCache.getCached(input.session_id);
      if (cached) {
        return {
          ...cached,
          prefetch_skipped: true,
          topic_overlap: skipDecision.overlap,
          topic_overlap_prior_query: skipDecision.priorQuery,
        };
      }
    }
  }

  // 1.5. T-132: Constitutional Directives (Injected First, Trim-Exempt)
  let constitutionalRules: ConstitutionalRule[] | undefined;
  if (input.constitutional_rules !== undefined || input.include_constitution === true) {
    constitutionalRules = resolveConstitutionalRules(input.constitutional_rules);
    for (const rule of constitutionalRules) {
      const cost = estimateTokens(`${rule.id} ${rule.title} ${rule.rule}`);
      usedBudget += cost;
      remainingBudget = Math.max(0, remainingBudget - cost);
    }
  }

  // 2. Active Constraints & CURRENT.md
  const activeConstraints: Array<{ id: string; title: string; content: string }> = [];
  const withheldDigestErrors: Array<{ id: string; reason: string; file_path: string; symbol_name?: string }> = [];
  let digestRefusalReason: string | undefined;
  
  // Try loading CURRENT.md constraints & concurrent workstreams
  if (store.memoryDir) {
    try {
      const currentMdPath = join(store.memoryDir, "CURRENT.md");
      if (existsSync(currentMdPath)) {
        const rawCurrentMd = readFileSync(currentMdPath, "utf8");
        const integrity = validateDigestIntegrity(rawCurrentMd);
        if (!integrity.valid) {
          digestRefusalReason = integrity.reason;
          withheldDigestErrors.push({
            id: "CURRENT.md",
            reason: `corrupted_or_incomplete_digest: ${integrity.reason}`,
            file_path: "CURRENT.md",
          });
        } else {
          const currentData = parseCurrentFile(store.memoryDir);
          if (currentData.constraints.length > 0) {
            activeConstraints.push({
              id: "current_md_constraints",
              title: "Session Working Constraints",
              content: currentData.constraints.join("\n"),
            });
          }
          if (currentData.workstreams && currentData.workstreams.length > 0) {
            const activeWs = currentData.workstreams.filter((w) => w.status === "IN-PROGRESS" || w.status === "BLOCKED");
            if (activeWs.length > 0) {
              const wsSummary = activeWs
                .map((w) => `- Agent \`${w.agent}\` [${w.status}]: ${w.task}${w.targetScope ? ` (Scope: ${w.targetScope})` : ""}`)
                .join("\n");
              activeConstraints.push({
                id: "concurrent_workstreams",
                title: "Active Concurrent Agent Workstreams",
                content: wsSummary,
              });
            }
          }
        }
      }
    } catch {}
  }

  // Also query store for timeless or active constraints
  const allEntries = list(store);
  const conflictedIds = new Set(
    allEntries.filter((e) => e.status === "conflicted").map((e) => e.id),
  );
  const constraintEntries = allEntries.filter(
    (e) =>
      (e.type === "constraint" || e.temporal_mode === "timeless") &&
      e.status !== "archived" &&
      e.status !== "superseded" &&
      e.status !== "rejected" &&
      !(e.status === "conflicted" && !input.include_conflicted)
  );

  for (const ce of constraintEntries) {
    if (activeConstraints.length >= 5) break;
    activeConstraints.push({
      id: ce.id,
      title: ce.title,
      content: ce.content,
    });
  }

  // Deduct constraint tokens
  for (const c of activeConstraints) {
    const cost = estimateTokens(`${c.title}\n${c.content}`);
    if (cost <= remainingBudget) {
      usedBudget += cost;
      remainingBudget -= cost;
    }
  }

  // 3. Find matching code anchors in the store
  const matchedAnchors: CodeAnchor[] = [];
  const entriesWithMatchingAnchors: MemoryEntry[] = [];

  if (input.active_file || input.symbol) {
    for (const e of allEntries) {
      if (!e.anchors || e.anchors.length === 0) continue;
      if (e.status === "archived" || e.status === "superseded") continue;
      // T-405: conflicted entries' code anchors stay out of the lens too —
      // otherwise the anchor coordinates leak the existence of a memory the
      // pool gate just withheld (mirror of the route-lens strip).
      if (e.status === "conflicted" && !input.include_conflicted) continue;

      for (const anc of e.anchors) {
        let fileMatch = false;
        let symbolMatch = false;

        if (input.active_file && anc.file_path) {
          fileMatch =
            input.active_file.includes(anc.file_path) ||
            anc.file_path.includes(input.active_file);
        }
        if (input.symbol && anc.symbol_name) {
          symbolMatch =
            anc.symbol_name.toLowerCase() === input.symbol.toLowerCase();
        }

        if (fileMatch || symbolMatch) {
          matchedAnchors.push(anc);
          if (!entriesWithMatchingAnchors.some((m) => m.id === e.id)) {
            entriesWithMatchingAnchors.push(e);
          }
        }
      }
    }
  }

  // T-113: Trivial-prompt gate (skip recall for greetings and pleasantries)
  const trivialGate =
    input.enable_trivial_gate !== false
      ? evaluateTrivialPromptGate(input)
      : { isTrivial: false };

  // 4. Retrieve ranked memories via multi-factor ranking engine (bypassed if trivial prompt)
  const ranked = trivialGate.isTrivial
    ? []
    : await rankAndRetrieveMemories(store, compositeQuery, {
        project: input.project,
        activeFilePath: input.active_file,
        targetSymbol: input.symbol,
        limit: 15,
        sessionId: input.session_id,
        sessionTurn: input.turn,
        suppressReinjection: false,
        suppressSelfEcho: false,
        suppressSeenChunks: false,
        includeConflicted: input.include_conflicted === true,
        recordSeenChunks: false,
        echoHorizonMs: input.echo_horizon_ms,
        agent: input.agent,
        taskIntent: input.task_intent,
      });

  // T-124: Match resident routes using in-memory INDEX route-map (bypassed if trivial prompt)
  const residentRouteMap = getOrBuildResidentRouteMap(store);
  const routeLookup = trivialGate.isTrivial
    ? { matched_routes: [], prioritized_entry_ids: [], duration_ms: 0 }
    : matchResidentRoutes(residentRouteMap, compositeQuery, {
        project: input.project,
        active_file: input.active_file,
        symbol: input.symbol,
      });

  // Merge anchored memories to front of candidate pool
  // T-405: strip conflicted ids from the ids-only lenses too (matched_routes,
  // route_prioritized_ids) so a badgeless existence leak cannot route around
  // the content gate through the route manifest.
  if (!input.include_conflicted && conflictedIds.size > 0) {
    routeLookup.matched_routes = routeLookup.matched_routes.map((rt) => ({
      ...rt,
      entry_ids: rt.entry_ids.filter((id) => !conflictedIds.has(id)),
    }));
    routeLookup.prioritized_entry_ids = routeLookup.prioritized_entry_ids.filter(
      (id) => !conflictedIds.has(id),
    );
  }

  const candidatePool: MemoryEntry[] = trivialGate.isTrivial ? [] : [...entriesWithMatchingAnchors];

  if (!trivialGate.isTrivial) {
    // Include route-prioritized entries
    for (const pid of routeLookup.prioritized_entry_ids) {
      if (!candidatePool.some((c) => c.id === pid)) {
        const matchEntry = allEntries.find((e) => e.id === pid);
        if (matchEntry) {
          candidatePool.push(matchEntry);
        }
      }
    }

    for (const r of ranked) {
      if (!candidatePool.some((c) => c.id === r.entry.id)) {
        candidatePool.push(r.entry);
      }
    }
  }

  // T-405: Contradiction engine verdicts — conflicted memories withheld by
  // default unless include_conflicted: true. Applied at the pool choke point
  // (before the trust gate) so code anchors, route pulls and ranked candidates
  // share ONE gate instead of three per-source filters.
  const withheldConflicted: Array<{ id: string; reason: string }> = [];
  if (!input.include_conflicted && conflictedIds.size > 0) {
    for (let i = candidatePool.length - 1; i >= 0; i--) {
      if (conflictedIds.has(candidatePool[i].id)) {
        const removed = candidatePool.splice(i, 1)[0];
        withheldConflicted.push({
          id: removed.id,
          reason: "conflicted_status - resolve in memory conflicts; opt-in via include_conflicted: true",
        });
      }
    }
  }

  // T-075: Ingest trust tiers — untrusted memories withheld by default unless include_untrusted: true
  const withheldUntrusted: Array<{ id: string; reason: string; file_path: string; symbol_name?: string }> = [];
  let filteredCandidates = candidatePool;
  if (!input.include_untrusted) {
    filteredCandidates = candidatePool.filter((c) => {
      if (c.trust === "untrusted") {
        withheldUntrusted.push({
          id: c.id,
          reason: `untrusted_source (${c.source ?? "external"}) - opt-in via include_untrusted: true`,
          file_path: "",
        });
        return false;
      }
      return true;
    });
  }

  // 4.5 Recall-time freshness gate (GAP-3): withhold memories whose code
  // citations no longer match the live workspace. Drifted/orphaned memories are
  // excluded from context by default and reported explicitly — never silently
  // dropped. Opt in via include_drifted to receive them with provenance warnings.
  const gate = gateCandidates(store, workspaceRoot, filteredCandidates, {
    enforce: input.include_drifted !== true,
    include_drifted: input.include_drifted === true,
  });
  const gatedPool = gate.entries;

  // T-108: Re-injection suppression per session (6-turn LRU)
  const withheldSuppressed: Array<{ id: string; reason: string; file_path: string; symbol_name?: string }> = [];
  let candidatePoolAfterSuppression = gatedPool;
  let reinjectionSuppressedCount = 0;

  if (input.session_id && input.suppress_reinjected !== false) {
    const suppression = defaultReinjectionTracker.filterSuppressed(input.session_id, gatedPool, {
      turn: input.turn,
    });
    candidatePoolAfterSuppression = suppression.allowed;
    reinjectionSuppressedCount = suppression.suppressed.length;
    for (const sup of suppression.suppressed) {
      withheldSuppressed.push({
        id: sup.item.id,
        reason: `reinjection_suppressed (${sup.turnsAgo} turns ago, injected at turn ${sup.injectedAtTurn}; 6-turn LRU)`,
        file_path: "",
      });
    }
  }

  // T-109: Self-echo suppression via capture-side provenance (age-bounded)
  let selfEchoSuppressedCount = 0;
  if (input.suppress_self_echo !== false && (input.session_id || input.agent)) {
    const echoFiltered = filterSelfEchoes(candidatePoolAfterSuppression, {
      sessionId: input.session_id,
      agent: input.agent,
      echoHorizonMs: input.echo_horizon_ms,
    });
    candidatePoolAfterSuppression = echoFiltered.allowed;
    selfEchoSuppressedCount = echoFiltered.suppressed.length;
    for (const echo of echoFiltered.suppressed) {
      withheldSuppressed.push({
        id: echo.entry.id,
        reason: echo.reason,
        file_path: "",
      });
    }
  }

  // T-111: Seen-chunk TTL suppression
  let seenChunkSuppressedCount = 0;
  if (
    input.session_id &&
    (input.suppress_seen_chunks || input.seen_chunk_ttl_ms !== undefined)
  ) {
    const seenFiltered = defaultSeenChunkTracker.filterSeen(
      input.session_id,
      candidatePoolAfterSuppression,
      {
        ttlMs: input.seen_chunk_ttl_ms,
      }
    );
    candidatePoolAfterSuppression = seenFiltered.allowed;
    seenChunkSuppressedCount = seenFiltered.suppressed.length;
    for (const seen of seenFiltered.suppressed) {
      withheldSuppressed.push({
        id: seen.item.id,
        reason: seen.reason,
        file_path: "",
      });
    }
  }

  // T-094: Reserved slots for global / USER.md guidelines
  let userProfileReservedTokens: number | undefined;
  const hasGlobalEntries = allEntries.some((e) => e.project === "global" || e.scope === "global");
  if (hasGlobalEntries) {
    userProfileReservedTokens = Math.min(Math.floor(budget * USER_PROFILE_BUDGET_RATIO), USER_PROFILE_DEFAULT_BUDGET);
  }

  // T-093: Truncation hierarchy (Pin > Provenance > Recency > Salience)
  function getTruncationRank(e: MemoryEntry): number {
    let rank = 0;
    // 1. Pin / Guardrail
    if (
      e.type === "constraint" ||
      e.temporal_mode === "timeless" ||
      e.type === "negative" ||
      e.tags?.some((t) => t.includes("anti-pattern") || t.includes("bug") || t.includes("negative")) ||
      e.negative != null
    ) {
      rank += 1000;
    }
    // 2. Provenance
    if (e.verification?.level === "authoritative") rank += 300;
    else if (e.verification?.level === "user-confirmed" || e.verification?.level === "independently-verified") rank += 200;
    else if (e.verification?.level && e.verification.level !== "unverified") rank += 100;

    // 3. Recency bonus
    const ts = new Date(e.updated_at || e.created_at).getTime();
    if (!isNaN(ts)) {
      const daysAgo = (Date.now() - ts) / (1000 * 60 * 60 * 24);
      if (daysAgo <= 30) rank += 50;
    }

    // 4. Salience
    rank += (e.salience ?? 1) * 10;
    return rank;
  }

  // 5. Separate negative lessons & anti-patterns with truncation ranking
  const sortedGatedPool = [...candidatePoolAfterSuppression].sort((a, b) => getTruncationRank(b) - getTruncationRank(a));
  const negativeLessons: MemoryEntry[] = [];
  const relevantMemories: MemoryEntry[] = [];

  for (const entry of sortedGatedPool) {
    if (
      entry.type === "negative" ||
      entry.negative != null ||
      entry.tags?.some((t) => t.includes("anti-pattern") || t.includes("bug") || t.includes("negative"))
    ) {
      negativeLessons.push(entry);
    } else {
      relevantMemories.push(entry);
    }
  }

  // 6. Token-budget knapsack packing with packed set tracking
  const packedNegative: MemoryEntry[] = [];
  const packedMemories: MemoryEntry[] = [];
  const packedIds = new Set<string>();

  // Pack negative lessons first (defensive guardrails)
  for (const neg of negativeLessons) {
    const cost = estimateEntryTokens(neg);
    if (cost <= remainingBudget) {
      packedNegative.push(neg);
      packedIds.add(neg.id);
      usedBudget += cost;
      remainingBudget -= cost;
    }
  }

  // Pack relevant memories
  for (const mem of relevantMemories) {
    const cost = estimateEntryTokens(mem);
    if (cost <= remainingBudget) {
      packedMemories.push(mem);
      packedIds.add(mem.id);
      usedBudget += cost;
      remainingBudget -= cost;
    }
  }

  // T-093: [N omitted — budget M] marker
  const totalCandidateCount = sortedGatedPool.length;
  const packedCount = packedIds.size;
  const omittedCount = Math.max(0, totalCandidateCount - packedCount);
  const budgetNotice = omittedCount > 0 ? `[${omittedCount} omitted — budget ${budget} tokens]` : undefined;

  // T-132: Constitution manifest items (trim-exempt)
  const constitutionManifest: ContextManifestItem[] = constitutionalRules
    ? constitutionalRules.map((r) => ({
        id: r.id,
        title: r.title,
        type: "constitution",
        truncated: false,
        score: 1.0,
      }))
    : [];

  // T-092: Never-drop manifest TOC listing all candidate memories
  const context_manifest: ContextManifestItem[] = [
    ...constitutionManifest,
    ...sortedGatedPool.map((entry) => ({
      id: entry.id,
      title: entry.title,
      type: entry.type,
      truncated: !packedIds.has(entry.id),
      score: entry.salience,
    })),
  ];

  // 7. Generate actionable suggested next steps
  const suggestedNextSteps: string[] = [];

  if (packedNegative.length > 0) {
    suggestedNextSteps.push(
      `Avoid known anti-pattern: ${packedNegative[0].title} (${packedNegative[0].content.slice(0, 60)}...)`
    );
  }

  if (matchedAnchors.length > 0) {
    const firstAnc = matchedAnchors[0];
    suggestedNextSteps.push(
      `Inspect anchored code symbol: ${firstAnc.file_path}${firstAnc.symbol_name ? `#${firstAnc.symbol_name}` : ""}`
    );
  }

  if (activeConstraints.length > 0) {
    suggestedNextSteps.push(
      `Respect invariant: ${activeConstraints[0].title}`
    );
  }

  if (input.error_message) {
    suggestedNextSteps.push("Verify error resolution against previous bug fixes in relevant memories");
  }

  if (gate.withheldNotice) {
    suggestedNextSteps.push(
      `${gate.withheld.length} memor${gate.withheld.length === 1 ? "y" : "ies"} withheld by the freshness gate — re-verify or supersede them if the drift is intentional`,
    );
  }

  if (withheldUntrusted.length > 0) {
    suggestedNextSteps.push(
      `${withheldUntrusted.length} untrusted memor${withheldUntrusted.length === 1 ? "y" : "ies"} withheld — pass include_untrusted: true to include them`,
    );
  }

  if (withheldConflicted.length > 0) {
    suggestedNextSteps.push(
      `${withheldConflicted.length} conflicted memor${withheldConflicted.length === 1 ? "y" : "ies"} withheld — resolve them via memory conflicts or pass include_conflicted: true`,
    );
  }

  if (digestRefusalReason) {
    suggestedNextSteps.push(
      `Refused incomplete or corrupted CURRENT.md digest: ${digestRefusalReason} — re-generate with memory handoff or repair CURRENT.md`,
    );
  }

  const allWithheld = [
    ...gate.withheld.map((w) => ({
      id: w.memory_id,
      reason: w.reason,
      file_path: w.file_path,
      symbol_name: w.symbol_name,
    })),
    ...withheldSuppressed,
    ...withheldUntrusted,
    ...withheldDigestErrors,
  ];

  const confident_answers = packedMemories.filter((m) => !isDraftMemory(m));
  const draft_answers = packedMemories.filter((m) => isDraftMemory(m));

  const hasConfidentMatch =
    !trivialGate.isTrivial &&
    (confident_answers.length > 0 || packedNegative.length > 0) &&
    (!compositeQuery.trim() ||
      entriesWithMatchingAnchors.length > 0 ||
      ranked.some((r) => r.score >= 0.45 && !isDraftMemory(r.entry)));

  if (trivialGate.isTrivial) {
    suggestedNextSteps.unshift(
      "State a specific technical goal, file, symbol, or question to recall relevant memories."
    );
  }

  // T-108: Record injected memory IDs for this session turn and advance session turn
  if (input.session_id) {
    const injectedIds = [...packedMemories, ...packedNegative].map((m) => m.id);
    defaultReinjectionTracker.recordInjected(input.session_id, injectedIds, input.turn);
    defaultReinjectionTracker.advanceTurn(input.session_id);

    // T-111: Record served chunks in seen-chunk tracker
    if (input.record_seen_chunks !== false) {
      const servedMemories = [...packedMemories, ...packedNegative];
      defaultSeenChunkTracker.recordSeen(input.session_id, servedMemories, {
        ttlMs: input.seen_chunk_ttl_ms,
      });
    }
  }

  // T-133: Collect degraded fault signals
  const collectedFaultNotes: string[] = [];
  if (input.degraded_notes) collectedFaultNotes.push(...input.degraded_notes);
  if (input.fault_notes) collectedFaultNotes.push(...input.fault_notes);
  if (store.circuit?.isDegraded()) {
    collectedFaultNotes.push("circuit_breaker_open: circuit breaker open after failure threshold, operating in fallback cache mode");
  }
  if (digestRefusalReason) {
    collectedFaultNotes.push(`digest_corrupted: active constraints in CURRENT.md corrupted (${digestRefusalReason})`);
  }
  if (gate.withheldNotice) {
    collectedFaultNotes.push(`freshness_gate_withheld: ${gate.withheld.length} memory code citations drifted from live workspace`);
  }
  const faultSignal = mergeDegradedFaults({
    degraded: input.degraded === true || store.circuit?.isDegraded() === true,
    degraded_notes: collectedFaultNotes,
  });

  const finalResult: FusedContextResult = {
    constitutional_rules: constitutionalRules && constitutionalRules.length > 0 ? constitutionalRules : undefined,
    degraded: faultSignal.degraded ? true : undefined,
    degraded_notes: faultSignal.degraded_notes,
    fault_notes: faultSignal.fault_notes,
    active_constraints: activeConstraints,
    relevant_memories: packedMemories,
    negative_lessons: packedNegative,
    code_anchors: matchedAnchors,
    tokens_used: usedBudget,
    token_budget: budget,
    suggested_next_steps: suggestedNextSteps,
    withheld_memories: allWithheld.length > 0 ? allWithheld : undefined,
    freshness_notice: gate.withheldNotice ?? undefined,
    freshness_stats: gate.stats,
    context_manifest,
    budget_notice: budgetNotice,
    user_profile_reserved_tokens: userProfileReservedTokens,
    mode: hasConfidentMatch ? "confident_match" : "no_confident_match",
    no_confident_match: !hasConfidentMatch,
    confident_answers,
    draft_answers: draft_answers.length > 0 ? draft_answers : undefined,
    reinjection_suppressed_count: reinjectionSuppressedCount > 0 ? reinjectionSuppressedCount : undefined,
    self_echo_suppressed_count: selfEchoSuppressedCount > 0 ? selfEchoSuppressedCount : undefined,
    seen_chunk_suppressed_count: seenChunkSuppressedCount > 0 ? seenChunkSuppressedCount : undefined,
    trivial_prompt_gated: trivialGate.isTrivial ? true : undefined,
    trivial_gate_reason: trivialGate.isTrivial ? trivialGate.reason : undefined,
    matched_routes: routeLookup.matched_routes.length > 0 ? routeLookup.matched_routes : undefined,
    route_prioritized_ids: routeLookup.prioritized_entry_ids.length > 0 ? routeLookup.prioritized_entry_ids : undefined,
  };

  // T-112: Record prefetch payload in session cache
  if (input.session_id) {
    defaultPrefetchCache.recordPrefetch(input.session_id, compositeQuery, finalResult);
  }

  return finalResult;
}

/**
 * T-091: Formats FusedContextResult into dense, structured compact context pack markdown.
 */
export function formatCompactContextPack(result: FusedContextResult): string {
  const lines: string[] = [
    "# 🧠 Muse Memory Context Pack",
    `> Budget: ${result.tokens_used}/${result.token_budget} tokens used | Constraints: ${result.active_constraints.length} | Memories: ${result.relevant_memories.length}`,
    "",
  ];

  if (result.budget_notice) {
    lines.push(`> ⚠️ **Budget Constraint**: ${result.budget_notice}`, "");
  }

  // T-133: Degraded retrieval fault notice
  if (result.degraded && result.degraded_notes && result.degraded_notes.length > 0) {
    lines.push(formatDegradedFaultNotice(result.degraded_notes).trim(), "");
  }

  // T-135: Loosened ladder matches notice
  if (result.loosened_matches_count && result.loosened_matches_count > 0) {
    lines.push(`> ⚠️ **Loosened Matches Admitted**: ${result.loosened_matches_count} candidate(s) retrieved via relaxed criteria (Rung 3).`, "");
  }

  if (result.trivial_prompt_gated) {
    lines.push("> ℹ️ _Conversational greeting or acknowledgement detected: memory recall bypassed to conserve tokens._", "");
  }

  // T-132: Constitutional Directives (injected first, trim-exempt, immutable)
  if (result.constitutional_rules && result.constitutional_rules.length > 0) {
    lines.push("## 📜 Constitutional Directives (Trim-Exempt · Immutable)");
    for (const rule of result.constitutional_rules) {
      lines.push(`- **[${rule.id}] ${rule.title}**: ${rule.rule}`);
    }
    lines.push("");
  }

  if (result.context_manifest && result.context_manifest.length > 0) {
    lines.push("## 📋 Manifest Table of Contents (TOC)");
    for (const item of result.context_manifest) {
      const status = item.truncated ? "omitted: budget" : "included";
      lines.push(`- [${item.id}] [${item.type ?? "memory"}] ${item.title} (${status})`);
    }
    lines.push("");
  }

  if (result.active_constraints.length > 0) {
    lines.push("## 🔒 Active Constraints & Invariants");
    for (const c of result.active_constraints) {
      lines.push(`### ${c.title}`);
      lines.push(c.content);
    }
    lines.push("");
  }

  if (result.negative_lessons.length > 0) {
    lines.push("## ❌ Negative Lessons & Anti-Patterns");
    for (const n of result.negative_lessons) {
      lines.push(`### ⚠️ ${n.title}`);
      lines.push(n.content);
    }
    lines.push("");
  }

  if (result.relevant_memories.length > 0) {
    lines.push("## 💡 Relevant Memories & Decisions");
    for (const m of result.relevant_memories) {
      lines.push(`### ${m.title}`);
      lines.push(m.content);
    }
    lines.push("");
  } else if (result.no_confident_match) {
    lines.push("## 💡 Relevant Memories & Decisions");
    lines.push("_No confident prior memories matched this query._", "");
  }

  if (result.suggested_next_steps.length > 0) {
    lines.push("## 🚀 Suggested Next Actions");
    for (const step of result.suggested_next_steps) {
      lines.push(`- ${step}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
