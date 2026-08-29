import type { ConceptPage, EntityPage, IndexPage, LogPage, LogEntry } from "./types.ts";

export function renderConceptPage(page: ConceptPage): string {
  const frontmatter = [
    "---",
    `title: "${page.title}"`,
    `type: ${page.type}`,
    `project: ${page.project}`,
    `updatedAt: ${page.updatedAt}`,
    `tags: [${page.tags.map((t) => `"${t}"`).join(", ")}]`,
    `relatedConcepts: [${page.relatedConcepts.map((s) => `"${s}"`).join(", ")}]`,
    `relatedEntities: [${page.relatedEntities.map((s) => `"${s}"`).join(", ")}]`,
    `memoryRefs: [${page.memoryRefs.map((s) => `"${s}"`).join(", ")}]`,
    "---",
  ].join("\n");

  const related = [
    page.relatedConcepts.length > 0 && `## Related Concepts\n\n${page.relatedConcepts.map((s) => `- [[${s}]]`).join("\n")}`,
    page.relatedEntities.length > 0 && `## Related Entities\n\n${page.relatedEntities.map((s) => `- [[${s}]]`).join("\n")}`,
  ].filter(Boolean).join("\n\n");

  const memories = page.memoryRefs.length > 0 
    ? `\n## Source Memories\n\n${page.memoryRefs.map((id) => `- [[${id}]]`).join("\n")}`
    : "";

  return `${frontmatter}\n\n# ${page.title}\n\n## Summary\n\n${page.summary}\n\n## Content\n\n${page.content}\n\n${related}${memories}\n`;
}

export function renderEntityPage(page: EntityPage): string {
  const frontmatter = [
    "---",
    `title: "${page.title}"`,
    `type: ${page.type}`,
    `entityType: ${page.entityType}`,
    `project: ${page.project}`,
    `updatedAt: ${page.updatedAt}`,
    `relatedEntities: [${page.relatedEntities.map((s) => `"${s}"`).join(", ")}]`,
    `relatedConcepts: [${page.relatedConcepts.map((s) => `"${s}"`).join(", ")}]`,
    `memoryRefs: [${page.memoryRefs.map((s) => `"${s}"`).join(", ")}]`,
    "---",
  ].join("\n");

  const related = [
    page.relatedEntities.length > 0 && `## Related Entities\n\n${page.relatedEntities.map((s) => `- [[${s}]]`).join("\n")}`,
    page.relatedConcepts.length > 0 && `## Related Concepts\n\n${page.relatedConcepts.map((s) => `- [[${s}]]`).join("\n")}`,
  ].filter(Boolean).join("\n\n");

  const mentions = page.mentions.length > 0
    ? `\n## Mentions\n\n${page.mentions.map((m) => `- [[${m.memoryId}]]: ${m.context}`).join("\n")}`
    : "";

  return `${frontmatter}\n\n# ${page.title}\n\n**Type:** ${page.entityType}\n\n## Summary\n\n${page.summary}\n\n## Content\n\n${page.content}\n\n${related}${mentions}\n`;
}

export function renderIndexPage(page: IndexPage): string {
  const frontmatter = [
    "---",
    `title: "${page.title}"`,
    `type: ${page.type}`,
    `project: ${page.project}`,
    `updatedAt: ${page.updatedAt}`,
    "---",
  ].join("\n");

  const sections = page.sections.map((section) => {
    const items = section.items.map((slug) => `- [[${slug}]]`).join("\n");
    return `## ${section.title}\n\n${items}`;
  }).join("\n\n");

  return `${frontmatter}\n\n# ${page.title}\n\n${sections}\n`;
}

export function renderLogPage(page: LogPage): string {
  const frontmatter = [
    "---",
    `title: "${page.title}"`,
    `type: ${page.type}`,
    `project: ${page.project}`,
    `updatedAt: ${page.updatedAt}`,
    "---",
  ].join("\n");

  const entries = page.entries.map((entry) => {
    const memRefs = entry.memoryIds && entry.memoryIds.length > 0
      ? ` (${entry.memoryIds.map((id) => `[[${id}]]`).join(", ")})`
      : "";
    return `- **${entry.timestamp}** [${entry.action}] ${entry.pageSlug}${memRefs}${entry.details ? `: ${entry.details}` : ""}`;
  }).join("\n");

  return `${frontmatter}\n\n# ${page.title}\n\n${entries}\n`;
}