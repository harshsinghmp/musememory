import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { scanSecrets } from "./secrets.ts";
import { loadSources } from "./provenance.ts";
import type { ClaimEntry, ClaimConfidence } from "./types.ts";

export type { ClaimEntry, ClaimConfidence };

export function getClaimsFilePath(memoryDir: string): string {
  return join(memoryDir, "claims.json");
}

export function loadClaims(memoryDir: string): ClaimEntry[] {
  const filePath = getClaimsFilePath(memoryDir);
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveClaims(memoryDir: string, claims: ClaimEntry[]): void {
  mkdirSync(memoryDir, { recursive: true });
  const filePath = getClaimsFilePath(memoryDir);
  writeFileSync(filePath, JSON.stringify(claims, null, 2), "utf-8");
}

export function recordClaim(
  memoryDir: string,
  input: {
    claim: string;
    confidence_tag?: ClaimConfidence;
    source_ids?: string[];
    memory_ids?: string[];
    notes?: string;
    verified?: boolean;
    id?: string;
    created_at?: string;
    validate_sources?: boolean;
  },
): ClaimEntry {
  const textToScan = `${input.claim}\n${input.notes ?? ""}`;
  const secrets = scanSecrets(textToScan);
  if (secrets.length > 0) {
    throw new Error(`Vibeguard: Detected secret in claim: ${secrets.join(", ")}`);
  }

  // T-391: Validate citations against live registry
  const sources = loadSources(memoryDir);
  const liveSourceIds = new Set(sources.map((s) => s.id));
  if (input.source_ids && input.source_ids.length > 0) {
    if (sources.length > 0 || input.validate_sources) {
      for (const srcId of input.source_ids) {
        if (!liveSourceIds.has(srcId)) {
          throw new Error(`Grounding failure: unknown source_id "${srcId}" in claim citation`);
        }
      }
    }
  }

  // T-391: Derive verified status from live registry citations rather than accepting blind caller assertion
  const hasValidSources = Boolean(
    input.source_ids &&
      input.source_ids.length > 0 &&
      input.source_ids.every((id) => liveSourceIds.has(id)),
  );
  const derivedVerified = Boolean(input.verified && hasValidSources);

  const claims = loadClaims(memoryDir);
  const id = input.id ?? `clm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const created_at = input.created_at ?? new Date().toISOString();

  const claimEntry: ClaimEntry = {
    id,
    claim: input.claim,
    confidence_tag: input.confidence_tag ?? "INFER",
    source_ids: input.source_ids ?? [],
    memory_ids: input.memory_ids ?? [],
    notes: input.notes,
    created_at,
    verified: derivedVerified,
  };

  const existingIdx = claims.findIndex((c) => c.id === id);
  if (existingIdx >= 0) {
    claims[existingIdx] = claimEntry;
  } else {
    claims.push(claimEntry);
  }

  saveClaims(memoryDir, claims);
  return claimEntry;
}

export function getClaim(memoryDir: string, id: string): ClaimEntry | null {
  const claims = loadClaims(memoryDir);
  return claims.find((c) => c.id === id) ?? null;
}

export function listClaims(
  memoryDir: string,
  filter?: { confidence_tag?: ClaimConfidence | string; query?: string; verified?: boolean },
): ClaimEntry[] {
  let claims = loadClaims(memoryDir);
  if (filter?.confidence_tag) {
    const tag = filter.confidence_tag.toUpperCase();
    claims = claims.filter((c) => c.confidence_tag.toUpperCase() === tag);
  }
  if (filter?.verified !== undefined) {
    claims = claims.filter((c) => !!c.verified === filter.verified);
  }
  if (filter?.query && filter.query.trim()) {
    const q = filter.query.toLowerCase().trim();
    claims = claims.filter(
      (c) =>
        c.claim.toLowerCase().includes(q) ||
        (c.notes && c.notes.toLowerCase().includes(q)),
    );
  }
  return claims;
}

export function findClaims(memoryDir: string, query: string): ClaimEntry[] {
  return listClaims(memoryDir, { query });
}
