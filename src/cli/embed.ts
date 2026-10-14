/**
 * `memory embed [status|build|reindex]` — R21 semantic embedding lifecycle.
 * status is local-only (no network); build/reindex probe the configured
 * endpoint first and fail with the honest reason when it is unreachable.
 */
import { requireRoot, fail, type ParsedArgs } from "./shared.ts";
import { embedStatus, buildEmbeddings, reindexEmbeddings } from "../retrieval/embed-store.ts";

export async function handleEmbedCommand(parsed: ParsedArgs): Promise<number> {
  const sub = parsed.positional[0] ?? "status";
  const ctx = requireRoot(parsed.flags);
  if (!ctx) return fail("could not resolve memory root");
  const { store } = ctx;

  if (sub === "status") {
    const s = embedStatus(store);
    if (!s.configured) {
      console.log("Embeddings: not configured");
      console.log("  set retrieval.embedderUrl (e.g. http://127.0.0.1:8081/v1) to enable; trigram vectors remain the default");
      if (s.vectorCount > 0) console.log(`  orphaned vectors: ${s.vectorCount}`);
      return 0;
    }
    console.log("Embeddings: configured");
    console.log(`  endpoint: ${s.endpoint}`);
    console.log(`  model: ${s.model ?? "(server default)"}`);
    console.log(`  vectors: ${s.vectorCount}`);
    if (s.pipeline) {
      console.log(`  pipeline: ${s.pipeline.fingerprint}`);
      console.log(`  built: ${s.pipeline.updated_at}`);
    }
    if (s.mismatch) {
      console.log("  WARNING: configured endpoint differs from the stored pipeline — recall is refused until 'memory embed reindex'");
    }
    return 0;
  }

  if (sub === "build" || sub === "reindex") {
    try {
      const res = sub === "reindex" ? await reindexEmbeddings(store) : await buildEmbeddings(store);
      console.log(`Embeddings ${sub === "reindex" ? "rebuilt" : "built"}: ${res.count} entries, ${res.dims} dims, model ${res.model}`);
      return 0;
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  return fail(`unknown embed subcommand '${sub}' (status | build | reindex)`);
}
