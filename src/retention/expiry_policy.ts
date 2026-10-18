/**
 * T-080: Pin-Capable First-Match-Wins Expiry Policy YAML Engine.
 *
 * Provides declarative YAML policy evaluation for memory expiration and pinning.
 * Rules are evaluated sequentially in declaration order (first-match-wins).
 * Pin-capable rules can mark entries as pinned, permanently exempting them from expiration.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { MemoryEntry } from "../types.ts";
import { defaultExpiryDays } from "../retention.ts";
import { type Store, list, expireEntry, save } from "../store.ts";

export interface ExpiryRule {
  /** Unique rule name identifying the policy in audit logs and stamped metadata. */
  name: string;

  /** Conditions (predicates) — all specified conditions must match for rule to trigger */
  type?: string;
  types?: string[];
  tags?: string[];
  project?: string;
  trust?: string;
  temporal_mode?: string;
  pattern?: string;

  /** Actions / Outcomes */
  /** If true or action is 'pin', marks entry as permanently pinned against expiration */
  pinned?: boolean;
  /** Explicit TTL in days from created_at. null means never expires */
  ttl_days?: number | null;
  /** Action directive: 'pin' | 'expire' | 'keep' */
  action?: "pin" | "expire" | "keep";
  /** Optional reason stamped when expired */
  reason?: string;
}

export interface ExpiryPolicyConfig {
  version?: number | string;
  /** Ordered list of rules evaluated with first-match-wins semantics */
  rules: ExpiryRule[];
}

export interface ExpiryMatchResult {
  rule: ExpiryRule;
  pinned: boolean;
  ttl_days: number | null;
  expires_at?: string;
  is_expired: boolean;
}

export interface ExpiryPolicyApplicationResult {
  matched: number;
  expired: MemoryEntry[];
  pinned: MemoryEntry[];
  skipped: number;
  dryRun: boolean;
}

/** Builtin fallback policy based on standard per-type TTLs */
export const DEFAULT_BUILTIN_EXPIRY_POLICY: ExpiryPolicyConfig = {
  version: 1,
  rules: [
    { name: "rule:discovery_30d", type: "discovery", ttl_days: 30 },
    { name: "rule:fix_90d", type: "fix", ttl_days: 90 },
    { name: "rule:operation_180d", type: "operation", ttl_days: 180 },
    { name: "rule:architecture_365d", type: "architecture", ttl_days: 365 },
    { name: "rule:adr_365d", type: "adr", ttl_days: 365 },
    { name: "rule:negative_180d", type: "negative", ttl_days: 180 },
    { name: "rule:preference_permanent", type: "preference", pinned: true },
    { name: "rule:constraint_permanent", type: "constraint", pinned: true },
  ],
};

/**
 * Parses raw YAML text into an ExpiryPolicyConfig.
 */
export function parseExpiryPolicyYaml(content: string): ExpiryPolicyConfig {
  if (!content || !content.trim()) {
    return { version: 1, rules: [] };
  }

  const parsed = yaml.load(content, { schema: yaml.JSON_SCHEMA }) as any;
  if (!parsed || typeof parsed !== "object") {
    return { version: 1, rules: [] };
  }

  const rawRules = Array.isArray(parsed.rules)
    ? parsed.rules
    : Array.isArray(parsed.policies)
    ? parsed.policies
    : [];

  const rules: ExpiryRule[] = [];
  for (let i = 0; i < rawRules.length; i++) {
    const r = rawRules[i];
    if (!r || typeof r !== "object") continue;

    const name = String(r.name ?? r.id ?? `rule_${i + 1}`);
    const rule: ExpiryRule = {
      name,
      type: r.type ? String(r.type) : undefined,
      types: Array.isArray(r.types) ? r.types.map(String) : undefined,
      tags: Array.isArray(r.tags) ? r.tags.map(String) : undefined,
      project: r.project ? String(r.project) : undefined,
      trust: r.trust ? String(r.trust) : undefined,
      temporal_mode: r.temporal_mode ? String(r.temporal_mode) : undefined,
      pattern: r.pattern ? String(r.pattern) : undefined,
      pinned: typeof r.pinned === "boolean" ? r.pinned : r.action === "pin",
      ttl_days: r.ttl_days !== undefined ? (r.ttl_days === null ? null : Number(r.ttl_days)) : undefined,
      action: r.action ? (String(r.action) as "pin" | "expire" | "keep") : undefined,
      reason: r.reason ? String(r.reason) : undefined,
    };
    rules.push(rule);
  }

  return {
    version: parsed.version ?? 1,
    rules,
  };
}

/**
 * Loads and parses an expiry policy YAML file from a directory or exact path.
 * Checks for:
 * 1. Exact path (if ends with .yaml or .yml or exists)
 * 2. <dir>/expiry.yaml
 * 3. <dir>/expiry_policy.yaml
 */
export function loadExpiryPolicyYaml(pathOrDir: string): ExpiryPolicyConfig | null {
  let targetPath: string | null = null;

  if (existsSync(pathOrDir)) {
    const stat = (pathOrDir.endsWith(".yaml") || pathOrDir.endsWith(".yml"));
    if (stat) {
      targetPath = pathOrDir;
    } else {
      const candidate1 = join(pathOrDir, "expiry.yaml");
      const candidate2 = join(pathOrDir, "expiry_policy.yaml");
      if (existsSync(candidate1)) {
        targetPath = candidate1;
      } else if (existsSync(candidate2)) {
        targetPath = candidate2;
      }
    }
  }

  if (!targetPath || !existsSync(targetPath)) {
    return null;
  }

  try {
    const raw = readFileSync(targetPath, "utf8");
    return parseExpiryPolicyYaml(raw);
  } catch {
    return null;
  }
}

/**
 * Checks whether an entry satisfies all predicates of a given ExpiryRule.
 */
export function matchExpiryRule(
  entry: MemoryEntry,
  rule: ExpiryRule,
  now: number = Date.now(),
): boolean {
  if (rule.type && entry.type !== rule.type) return false;
  if (rule.types && (!entry.type || !rule.types.includes(entry.type))) return false;
  if (rule.project && entry.project !== rule.project) return false;
  if (rule.trust && entry.trust !== rule.trust) return false;
  if (rule.temporal_mode && entry.temporal_mode !== rule.temporal_mode) return false;

  if (rule.tags && rule.tags.length > 0) {
    const entryTags = new Set((entry.tags ?? []).map((t) => t.toLowerCase()));
    const matchesAny = rule.tags.some((t) => entryTags.has(t.toLowerCase()));
    if (!matchesAny) return false;
  }

  if (rule.pattern) {
    try {
      const reg = new RegExp(rule.pattern, "i");
      const text = `${entry.title ?? ""} ${entry.content}`;
      if (!reg.test(text)) return false;
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Evaluates a memory entry against an ExpiryPolicyConfig using first-match-wins semantics.
 * Returns the match result from the first matching rule, or null if no rule matched.
 */
export function evaluateExpiryPolicy(
  entry: MemoryEntry,
  policy: ExpiryPolicyConfig,
  now: number = Date.now(),
): ExpiryMatchResult | null {
  for (const rule of policy.rules) {
    if (matchExpiryRule(entry, rule, now)) {
      const isPinned = rule.pinned === true || rule.action === "pin" || entry.pinned === true;
      let ttlDays = rule.ttl_days !== undefined ? rule.ttl_days : (isPinned ? null : defaultExpiryDays(entry.type));
      if (isPinned) {
        ttlDays = null;
      }

      let expiresAt: string | undefined;
      let isExpired = false;

      if (!isPinned && ttlDays !== null && ttlDays !== undefined) {
        const createdMs = Date.parse(entry.created_at);
        if (!Number.isNaN(createdMs)) {
          const expiryMs = createdMs + ttlDays * 86_400_000;
          expiresAt = new Date(expiryMs).toISOString();
          isExpired = now >= expiryMs;
        }
      }

      return {
        rule,
        pinned: isPinned,
        ttl_days: ttlDays,
        expires_at: expiresAt,
        is_expired: isExpired,
      };
    }
  }

  return null;
}

/**
 * Applies an ExpiryPolicyConfig across all candidate/active entries in a store.
 * Executes pinning and expiration transitions with structured audit logs.
 */
export function applyExpiryPolicy(
  store: Store,
  policy?: ExpiryPolicyConfig,
  options?: {
    now?: number;
    dryRun?: boolean;
    project?: string;
  },
): ExpiryPolicyApplicationResult {
  const effectivePolicy =
    policy ??
    (store.memoryDir ? loadExpiryPolicyYaml(store.memoryDir) : null) ??
    DEFAULT_BUILTIN_EXPIRY_POLICY;

  const nowMs = options?.now ?? Date.now();
  const dryRun = options?.dryRun ?? false;

  const result: ExpiryPolicyApplicationResult = {
    matched: 0,
    expired: [],
    pinned: [],
    skipped: 0,
    dryRun,
  };

  // Inspect entries
  const entries = list(store, { project: options?.project });

  for (const entry of entries) {
    if (entry.status === "expired" || entry.status === "archived" || entry.status === "superseded") {
      result.skipped++;
      continue;
    }

    const match = evaluateExpiryPolicy(entry, effectivePolicy, nowMs);
    if (!match) {
      result.skipped++;
      continue;
    }

    result.matched++;

    // Pinning transition
    if (match.pinned && !entry.pinned) {
      if (!dryRun) {
        entry.pinned = true;
        save(store, entry);
      }
      result.pinned.push(entry);
      continue;
    }

    // Expiration transition
    if (match.is_expired && !entry.pinned) {
      if (!dryRun) {
        const expired = expireEntry(store, entry.id, {
          rule: match.rule.name,
          expired_at: new Date(nowMs).toISOString(),
          reason: match.rule.reason,
        });
        if (expired) {
          result.expired.push(expired);
        }
      } else {
        result.expired.push({
          ...entry,
          status: "expired",
          expired_at: new Date(nowMs).toISOString(),
          expired_by: match.rule.name,
        });
      }
    }
  }

  return result;
}
