import { requireRoot, type ParsedArgs } from "./shared.ts";
import { list } from "../store.ts";
import {
  extractEntitiesFromMemories,
  saveEntities,
  loadEntities,
  findEntity,
  findRelatedEntities,
  type EntityType,
} from "../entities/index.ts";

export function handleExtractEntitiesCommand(parsed: ParsedArgs): number {
  const ctx = requireRoot(parsed.flags);
  if (!ctx) return 1;
  const memoryDir = ctx.memoryDir;
  const store = ctx.store;

  const project = parsed.flags.project as string | undefined;
  const dryRun = Boolean(parsed.flags["dry-run"]);

  let memories = list(store).filter((e) => e.status === "confirmed");
  if (project) memories = memories.filter((e) => e.project === project);

  console.log(`Extracting entities from ${memories.length} confirmed memories (dryRun: ${dryRun})...`);
  const result = extractEntitiesFromMemories(memories);

  console.log(`Extracted ${result.entities.length} unique entities across memories:`);
  const countsByType = new Map<string, number>();
  for (const ent of result.entities) {
    countsByType.set(ent.type, (countsByType.get(ent.type) ?? 0) + 1);
  }
  for (const [type, count] of countsByType) {
    console.log(`  - ${type}: ${count}`);
  }

  if (!dryRun) {
    saveEntities(memoryDir, result.entities);
    console.log(`Saved entity index to .memory/entities.json`);
  }
  return 0;
}

export function handleEntitiesCommand(parsed: ParsedArgs): number {
  const ctx = requireRoot(parsed.flags);
  if (!ctx) return 1;
  const memoryDir = ctx.memoryDir;
  const sub = parsed.positional[0] ?? "list";

  if (sub === "list" || sub === "ls") {
    const type = parsed.flags.type as EntityType | undefined;
    const project = parsed.flags.project as string | undefined;

    let entities = loadEntities(memoryDir);
    if (entities.length === 0) {
      console.log("No entities found. Run `memory extract-entities` to scan memories.");
      return 0;
    }

    if (type) entities = entities.filter((e) => e.type === type);
    if (project) entities = entities.filter((e) => !e.project || e.project === project);

    console.log(`Entities (${entities.length}):`);
    for (const ent of entities) {
      const typeBadge = `[${ent.type}]`.padEnd(14);
      console.log(`  ${typeBadge} ${ent.id} ("${ent.name}") - ${ent.memoryRefs.length} refs, ${ent.relatedEntities.length} related`);
    }
    return 0;
  }

  if (sub === "show" || sub === "get") {
    const id = parsed.positional[1];
    if (!id) {
      console.error("Error: please specify an entity ID or name (e.g. `memory entities show nextjs`)");
      return 2;
    }

    const entity = findEntity(memoryDir, id);
    if (!entity) {
      console.error(`Error: entity "${id}" not found.`);
      return 1;
    }

    console.log(JSON.stringify(entity, null, 2));
    return 0;
  }

  if (sub === "related") {
    const id = parsed.positional[1];
    if (!id) {
      console.error("Error: please specify an entity ID or name (e.g. `memory entities related nextjs`)");
      return 2;
    }

    const related = findRelatedEntities(memoryDir, id);
    if (related.length === 0) {
      console.log(`No related entities found for "${id}".`);
      return 0;
    }

    console.log(`Related Entities for "${id}":`);
    for (const { entity, strength } of related) {
      console.log(`  - [strength ${strength}] ${entity.id} (${entity.type}: "${entity.name}")`);
    }
    return 0;
  }

  console.error(`Error: unknown entities subcommand "${sub}". Supported: list, show, related`);
  return 2;
}
