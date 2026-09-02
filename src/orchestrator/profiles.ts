import type { McpProfile } from "./types.ts";

export const PROFILE_TOOL_DEFINITIONS: Record<McpProfile, string[]> = {
  core: [
    "memory_read",
    "get_context",
    "memory_capture",
    "memory_current",
    "search",
  ],
  coding: [
    "muse_context",
    "memory_anchor_create",
    "memory_anchor_verify",
    "memory_read",
    "memory_capture",
    "memory_current",
    "muse_code_for_memory",
    "muse_memory_for_code",
  ],
  debugging: [
    "muse_context",
    "memory_record_observation",
    "memory_capture_negative",
    "memory_distill",
    "memory_anchor_verify",
    "memory_read",
    "muse_code_for_memory",
    "muse_memory_for_code",
  ],
  review: [
    "muse_context",
    "memory_anchor_audit",
    "memory_conflict_detect",
    "memory_tree_search",
    "memory_wiki_page",
    "muse_memory_for_code",
  ],
  architecture: [
    "muse_context",
    "memory_evaluate_promotion",
    "memory_promote",
    "memory_generalize",
    "memory_wiki_compile",
    "memory_wiki_page",
    "memory_tree_index",
  ],
  maintenance: [
    "memory_lifecycle_status",
    "memory_archive",
    "memory_rehydrate",
    "memory_dedup",
    "memory_anchor_audit",
    "memory_audit_query",
  ],
  full: [], // empty list means include all registered tools
};

export const PROFILE_DESCRIPTIONS: Record<McpProfile, string> = {
  core: "Minimal footprint for lightweight context injection and rapid capture",
  coding: "Optimized for active development, code anchors, and contextual fusion",
  debugging: "Optimized for bug diagnosis, error message resolution, observations, and negative lessons",
  review: "Optimized for code reviews, architectural audits, and conflict verification",
  architecture: "Optimized for system design, promotions, entity wikis, and tree indexing",
  maintenance: "Optimized for repository health, deduplication, and archival lifecycle sweeping",
  full: "Exposes the complete suite of all available Muse Memory tools",
};

/**
 * Returns the tool names allowed for a given profile.
 */
export function getProfileToolNames(profile: McpProfile): string[] {
  return PROFILE_TOOL_DEFINITIONS[profile] || [];
}

/**
 * Filters an array of tool objects based on the selected MCP profile.
 */
export function filterToolsForProfile<T extends { name: string }>(
  allTools: T[],
  profile: McpProfile = "full"
): T[] {
  if (!profile || profile === "full") return allTools;
  const allowed = new Set(getProfileToolNames(profile));
  return allTools.filter((tool) => allowed.has(tool.name));
}

/**
 * Resolves the active MCP profile from environment or explicit setting.
 */
export function getActiveMcpProfile(envProfile?: string): McpProfile {
  const profile = envProfile || process.env.MUSE_MCP_PROFILE;
  if (profile && Object.keys(PROFILE_TOOL_DEFINITIONS).includes(profile as McpProfile)) {
    return profile as McpProfile;
  }
  return "full";
}

/**
 * Lists all available MCP profiles and their metadata.
 */
export function listMcpProfiles(): Array<{
  profile: McpProfile;
  description: string;
  tools: string[];
}> {
  return (Object.keys(PROFILE_TOOL_DEFINITIONS) as McpProfile[]).map((p) => ({
    profile: p,
    description: PROFILE_DESCRIPTIONS[p],
    tools: PROFILE_TOOL_DEFINITIONS[p],
  }));
}
