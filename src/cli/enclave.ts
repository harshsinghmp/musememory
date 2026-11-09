import { randomUUID } from "node:crypto";
import { requireRoot, usageError } from "./shared.ts";
import type { ParsedArgs } from "./shared.ts";
import { createEnclave, listEnclaveEntries, putEnclaveEntry } from "../store/enclaves.ts";
import type { MemoryEntry, MemoryType } from "../types.ts";

export async function handleEnclaveCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const sub = positional[0];
  const client = positional[1];
  if (!sub || !client) return usageError("enclave requires <create|list|put> <client>");
  const division = flags["division"] ?? "default";

  switch (sub) {
    case "create":
      createEnclave(ctx.memoryDir, client, division);
      console.log(`enclave ready: ${client}/${division}`);
      return 0;
    case "list": {
      const entries = listEnclaveEntries(ctx.memoryDir, client, division);
      console.log(`${client}/${division}: ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`);
      for (const entry of entries) console.log(`  ${entry.id} ${entry.type} ${entry.title}`);
      return 0;
    }
    case "put": {
      const content = positional[2];
      if (!content) return usageError("enclave put requires <content>");
      const id = `m_${Date.now()}_${randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      const entry: MemoryEntry = {
        id,
        title: content.slice(0, 80),
        content,
        project: client,
        type: (flags["type"] as MemoryType) ?? "discovery",
        status: "confirmed",
        created_at: now,
        updated_at: now,
        tags: [],
      } as MemoryEntry;
      putEnclaveEntry(ctx.memoryDir, client, entry, division);
      console.log(`stored ${id} in ${client}/${division}`);
      return 0;
    }
    default:
      return usageError(`unknown enclave subcommand '${sub}' (expected create | list | put)`);
  }
}
