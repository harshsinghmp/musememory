import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { requireRoot, usageError } from "./shared.ts";
import type { ParsedArgs } from "./shared.ts";
import { createEnclave, listEnclaveEntries, putEnclaveEntry, rotateEnclaveKey, validateEnclaveName } from "../store/enclaves.ts";
import { recordAuditEvent } from "../audit.ts";
import type { MemoryEntry, MemoryType } from "../types.ts";

const MEMORY_TYPES: MemoryType[] = [
  "session", "decision", "fix", "failure", "architecture", "operation",
  "constraint", "preference", "discovery", "negative", "adr",
];

export async function handleEnclaveCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const sub = positional[0];
  const client = positional[1];
  if (!sub) return usageError("enclave requires <create|list|put|rotate> [client]");
  if (sub !== "rotate" && !client) return usageError("enclave requires <create|list|put> <client>");
  let division: string;
  try {
    division = validateEnclaveName(flags["division"] ?? "default", "division");
  } catch (err) {
    return usageError(err instanceof Error ? err.message : String(err));
  }

  try {
  switch (sub) {
    case "rotate": {
      const rotation = rotateEnclaveKey(ctx.memoryDir, { reencrypt: flags["no-reencrypt"] === undefined });
      console.log(`rotated enclave key ${rotation.old_key_id} -> ${rotation.new_key_id} (${rotation.reencrypted} vault(s) re-encrypted)`);
      return 0;
    }
    case "create":
      createEnclave(ctx.memoryDir, client, division);
      console.log(`enclave ready: ${client}/${division}`);
      return 0;
    case "list": {
      const entries = listEnclaveEntries(ctx.memoryDir, client, division);
      recordAuditEvent(ctx.memoryDir, {
        operation: "enclave_read",
        entry_id: "enclave",
        actor: "cli",
        reason: "enclave_list",
        details: { client, division, count: entries.length },
      });
      console.log(`${client}/${division}: ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`);
      for (const entry of entries) console.log(`  ${entry.id} ${entry.type} ${entry.title}`);
      return 0;
    }
    case "put": {
      const file = flags["file"];
      let content = positional[2];
      if (file) content = readFileSync(file, "utf8");
      else if (content === "-") content = readFileSync(0, "utf8");
      if (!content) return usageError("enclave put requires <content>, --file <path> or '-' for stdin");
      const type = (flags["type"] ?? "discovery") as MemoryType;
      if (!MEMORY_TYPES.includes(type)) return usageError(`invalid --type '${type}'`);
      const id = `m_${Date.now()}_${randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      const entry: MemoryEntry = {
        id,
        title: content.slice(0, 80),
        content,
        project: client,
        source: "enclave",
        type,
        status: "confirmed",
        created_at: now,
        updated_at: now,
        tags: [],
      } as MemoryEntry;
      putEnclaveEntry(ctx.memoryDir, client, entry, division);
      recordAuditEvent(ctx.memoryDir, {
        operation: "enclave_put",
        entry_id: id,
        project: client,
        actor: "cli",
        reason: "enclave_put",
        details: { client, division, type },
      });
      console.log(`stored ${id} in ${client}/${division}`);
      return 0;
    }
    default:
      return usageError(`unknown enclave subcommand '${sub}' (expected create | list | put | rotate)`);
  }
  } catch (err) {
    return usageError(err instanceof Error ? err.message : String(err));
  }
}
