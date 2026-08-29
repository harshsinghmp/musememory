import { requireRoot, type ParsedArgs } from "./shared.ts";
import { compileWiki, listWikiPages, getWikiPage, type WikiPage } from "../wiki/index.ts";

export function handleWikiCommand(parsed: ParsedArgs): number {
  const ctx = requireRoot(parsed.flags);
  if (!ctx) return 1;
  const memoryDir = ctx.memoryDir;
  const store = ctx.store;

  const sub = parsed.positional[0] ?? "compile";

  if (sub === "compile") {
    const project = parsed.flags.project as string | undefined;
    const dryRun = Boolean(parsed.flags["dry-run"]);
    const typesStr = parsed.flags.types as string | undefined;
    const includeTypes = typesStr ? (typesStr.split(",") as any) : undefined;

    console.log(`Compiling wiki for ${project ?? "all projects"} (dryRun: ${dryRun})...`);
    const result = compileWiki(store, memoryDir, { project, dryRun, includeTypes });

    console.log(`Wiki compilation complete:`);
    console.log(`  Pages created: ${result.pagesCreated.length}`);
    console.log(`  Pages updated: ${result.pagesUpdated.length}`);
    console.log(`  Log entries: ${result.logEntries.length}`);

    if (result.errors.length > 0) {
      console.warn(`Warnings/Errors:`);
      for (const err of result.errors) console.warn(`  - ${err}`);
    }
    return 0;
  }

  if (sub === "list" || sub === "ls") {
    const project = parsed.flags.project as string | undefined;
    const type = parsed.flags.type as any;
    const detailLevel = parsed.flags["l1"] === "true" ? "l1" : "full";
    const pages = listWikiPages(memoryDir, { project, type, detailLevel });

    if (pages.length === 0) {
      console.log("No wiki pages found. Run `memory wiki compile` to generate pages.");
      return 0;
    }

    console.log(`Wiki Pages (${pages.length}):`);
    for (const page of pages) {
      const typeBadge = `[${page.type}]`.padEnd(10);
      console.log(`  ${typeBadge} ${page.slug} - "${page.title}" (${page.memoryRefs?.length ?? 0} memories)`);
    }
    return 0;
  }

  if (sub === "show" || sub === "get") {
    const slug = parsed.positional[1];
    if (!slug) {
      console.error("Error: please specify a page slug (e.g. `memory wiki show index` or `memory wiki show concept-name`)");
      return 2;
    }

    const type = parsed.flags.type as any;
    const page = getWikiPage(memoryDir, slug, type);
    if (!page) {
      console.error(`Error: wiki page "${slug}" not found.`);
      return 1;
    }

    const content = "content" in page && page.content ? page.content : JSON.stringify(page, null, 2);
    console.log(content);
    return 0;
  }

  console.error(`Error: unknown wiki subcommand "${sub}". Supported: compile, list, show`);
  return 2;
}
