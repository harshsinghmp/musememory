import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv, { type ValidateFunction } from "ajv";
import type { Store } from "./store.ts";
import { list, get, extractEntryText } from "./store.ts";
import { scanSecrets } from "./secrets.ts";
import { stalePolicyDays, daysSince } from "./retrieval.ts";
import type { MemoryEntry } from "./types.ts";

let cachedValidate: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  if (cachedValidate) return cachedValidate;
  const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
  // ajv v8 has no built-in formats; register date-time manually (no extra deps).
  ajv.addFormat("date-time", (value: unknown) => {
    if (typeof value !== "string") return false;
    return !Number.isNaN(Date.parse(value));
  });
  const candidates = [
    join(import.meta.dir, "..", "schema.json"),
    join(import.meta.dir, "schema.json"),
    join(process.cwd(), "schema.json"),
  ];
  let schemaContent: string | null = null;
  for (const p of candidates) {
    if (existsSync(p)) {
      schemaContent = readFileSync(p, "utf8");
      break;
    }
  }
  if (!schemaContent) {
    throw new Error(`Cannot locate schema.json in ${candidates.join(", ")}`);
  }
  const schema = JSON.parse(schemaContent);
  cachedValidate = ajv.compile(schema);
  return cachedValidate;
}

/** Reset cached compiled validator (useful for testing or dynamic schema reloading). */
export function clearSchemaCache(): void {
  cachedValidate = null;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface StoreValidationReport {
  total: number;
  validCount: number;
  schemaErrors: { id: string; errors: string[] }[];
  secretErrors: { id: string; secrets: string[] }[];
  brokenLinks: { id: string; field: string; targetId: string }[];
  integrityErrors: { id: string; message: string }[];
  staleWarnings: { id: string; type?: string; ageDays: number; policyDays: number }[];
  isValid: boolean;
}

/**
 * Validate an entry against schema.json (draft-07).
 * schema.json enforces additionalProperties: false and requires source + tags.
 */
export function validateEntry(entry: unknown): ValidationResult {
  const validate = getValidator();
  const valid = validate(entry);
  const errors: string[] = [];
  if (!valid && validate.errors) {
    for (const err of validate.errors) {
      errors.push(`${err.instancePath || "/"} ${err.message}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function normalizeIdList(val: string | string[] | null | undefined): string[] {
  if (!val) return [];
  if (typeof val === "string") return [val];
  return val;
}

/**
 * Deep validation of entire memory store:
 * 1. Schema compliance
 * 2. Secret scanning (across all fields)
 * 3. Broken link detection (supersedes, superseded_by, related_memory_ids)
 * 4. Referential integrity and lifecycle consistency
 * 5. Stale-by-policy detection
 */
export function validateStore(store: Store): StoreValidationReport {
  const entries = list(store);
  const now = Date.now();
  const idSet = new Set(entries.map((e) => e.id));

  const schemaErrors: { id: string; errors: string[] }[] = [];
  const secretErrors: { id: string; secrets: string[] }[] = [];
  const brokenLinks: { id: string; field: string; targetId: string }[] = [];
  const integrityErrors: { id: string; message: string }[] = [];
  const staleWarnings: { id: string; type?: string; ageDays: number; policyDays: number }[] = [];

  for (const e of entries) {
    // 1. Schema
    const sv = validateEntry(e);
    if (!sv.valid) {
      schemaErrors.push({ id: e.id, errors: sv.errors });
    }

    // 2. Secrets across all metadata fields
    const scannable = extractEntryText(e);
    const sec = scanSecrets(scannable);
    if (sec.length > 0) {
      secretErrors.push({ id: e.id, secrets: sec });
    }

    // 3. Broken Links
    const supersedesList = normalizeIdList(e.supersedes);
    for (const sid of supersedesList) {
      if (!idSet.has(sid)) {
        brokenLinks.push({ id: e.id, field: "supersedes", targetId: sid });
      } else {
        const target = get(store, sid);
        if (target && target.status !== "superseded") {
          integrityErrors.push({ id: e.id, message: `supersedes ${sid} but ${sid} has status ${target.status} (expected superseded)` });
        }
      }
    }

    const supersededByList = normalizeIdList(e.superseded_by);
    for (const sbid of supersededByList) {
      if (!idSet.has(sbid)) {
        brokenLinks.push({ id: e.id, field: "superseded_by", targetId: sbid });
      }
    }

    for (const rid of e.related_memory_ids ?? []) {
      if (!idSet.has(rid)) {
        brokenLinks.push({ id: e.id, field: "related_memory_ids", targetId: rid });
      }
    }

    // 4. Lifecycle Integrity
    if (e.status === "superseded" && supersededByList.length === 0) {
      integrityErrors.push({ id: e.id, message: `entry has status 'superseded' but no superseded_by link` });
    }

    // 5. Staleness Advisory
    const policy = stalePolicyDays(e.type);
    if (e.status === "active" && policy !== null) {
      const days = daysSince(e.updated_at, now);
      if (days > policy) {
        staleWarnings.push({ id: e.id, type: e.type, ageDays: Math.floor(days), policyDays: policy });
      }
    }
  }

  const errorIdSet = new Set([
    ...schemaErrors.map((e) => e.id),
    ...secretErrors.map((e) => e.id),
    ...brokenLinks.map((e) => e.id),
    ...integrityErrors.map((e) => e.id),
  ]);
  const validCount = Math.max(0, entries.length - errorIdSet.size);

  return {
    total: entries.length,
    validCount,
    schemaErrors,
    secretErrors,
    brokenLinks,
    integrityErrors,
    staleWarnings,
    isValid: errorIdSet.size === 0,
  };
}
