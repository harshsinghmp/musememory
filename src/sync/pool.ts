import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Store } from "../store.ts";
import type { PoolSyncReport, SyncPacket } from "./types.ts";
import { broadcastKnowledge, ingestKnowledge, resolveLocalAgentId, loadPeers } from "./engine.ts";
import { resolveExternal, resolveWithin } from "../paths.ts";

/** Operator-owned root for shared sync pools. Never derived from a tool argument. */
export const SYNC_POOL_ROOT_ENV = "MUSE_SYNC_POOL_DIR";

/** Broadcasts are written into a dedicated, owner-only subdirectory of the pool. */
export const SYNC_POOL_PACKETS_DIRNAME = "packets";

/**
 * Resolves the pool root the operator configured.
 *
 * The root is `MUSE_SYNC_POOL_DIR` when set, otherwise `<memoryDir>/sync/pool`. A
 * caller-supplied `pool_dir` may only narrow this root (see `confinePoolDir`) — it
 * can never relocate it, because the model, not the operator, chooses that argument.
 */
export function resolveSyncPoolRoot(memoryDir: string): { root: string; configuredByEnv: boolean } {
  const defaultRoot = join(memoryDir, "sync", "pool");
  const override = process.env[SYNC_POOL_ROOT_ENV];
  if (override !== undefined && override.trim() !== "") {
    const root = resolveExternal(override.trim());
    // Self-ingest guard: an operator root inside our own store would be read back
    // as memories on the next store scan, so it stays off-limits — except for the
    // built-in default location itself, which the product owns.
    if (root !== defaultRoot) {
      const rel = relative(memoryDir, root);
      if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) {
        throw new Error(
          `syncWithSharedPool: ${SYNC_POOL_ROOT_ENV} "${root}" must not resolve inside the memory store "${memoryDir}"`,
        );
      }
    }
    return { root, configuredByEnv: true };
  }
  return { root: defaultRoot, configuredByEnv: false };
}

/**
 * Confines a requested pool dir to the configured root.
 *
 * Accepts the root itself or any descendant; rejects everything else before a
 * single byte is read or written. Containment is delegated to `resolveWithin` so
 * there is exactly one traversal rule in the codebase.
 */
function confinePoolDir(requested: string, root: string): string {
  // `resolveExternal` normalizes and rejects empty paths / NUL bytes.
  const resolved = resolveExternal(requested);
  if (resolved === root) return root;

  const rel = relative(root, resolved);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(
      `syncWithSharedPool: pool_dir "${resolved}" must resolve inside the configured sync pool root "${root}" ` +
        `(set ${SYNC_POOL_ROOT_ENV} to choose a different root)`,
    );
  }
  // Re-derive through the shared helper: it re-checks the same lexical rule.
  return resolveWithin(root, rel);
}

/** Lists `*.json` files directly inside `dir`, ignoring subdirectories. */
function listPacketFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(dir, name));
}

/**
 * Synchronizes with an in-process / filesystem shared gossip pool directory.
 * Multiple subagents (e.g. Sol, Jasper, Nexus, Crew) can drop and read packets here.
 *
 * The pool root is operator-configured (`MUSE_SYNC_POOL_DIR`, default
 * `<memory_dir>/sync/pool`); `customPoolDir` can only select a directory inside
 * that root, never an arbitrary filesystem location.
 */
export function syncWithSharedPool(
  store: Store,
  workspaceRoot: string,
  customPoolDir?: string,
  localAgentId?: string
): PoolSyncReport {
  const agentId = resolveLocalAgentId(localAgentId);
  const memoryDir = resolve(store.memoryDir || join(workspaceRoot, ".memory"));

  // Fix #455: the pool root is operator-configured, the tool argument only narrows it.
  const { root: poolRoot } = resolveSyncPoolRoot(memoryDir);
  const poolDir = customPoolDir !== undefined ? confinePoolDir(customPoolDir, poolRoot) : poolRoot;
  const packetsDir = join(poolDir, SYNC_POOL_PACKETS_DIRNAME);

  if (!existsSync(poolDir)) {
    mkdirSync(poolDir, { recursive: true, mode: 0o700 });
  }
  // Owner-only: packets carry memory content and are read by every peer on this host.
  mkdirSync(packetsDir, { recursive: true, mode: 0o700 });

  const peers = loadPeers(memoryDir);
  const peersContacted = new Set<string>();
  let packetsProcessed = 0;
  let totalIngested = 0;
  let totalDuplicates = 0;
  let totalConflicts = 0;

  // 1. Ingest packets from all peers in the pool: the root itself (peers may drop
  //    files there by hand) plus our own `packets/` outbox directory.
  const files = [...listPacketFiles(poolDir), ...listPacketFiles(packetsDir)];
  for (const filePath of files) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const packet: SyncPacket = JSON.parse(raw);

      // Skip own broadcast packets
      if (packet.sender_id === agentId) continue;

      // Skip already processed packets from this peer
      const knownPeer = peers[packet.sender_id];
      if (knownPeer && knownPeer.last_packet_id === packet.packet_id) {
        continue;
      }

      peersContacted.add(packet.sender_id);
      packetsProcessed++;

      const res = ingestKnowledge(store, workspaceRoot, packet, agentId);
      totalIngested += res.ingested_count;
      totalDuplicates += res.duplicate_count;
      totalConflicts += res.conflict_count;
    } catch {
      // Ignore unparseable or corrupted pool files gracefully
    }
  }

  // 2. Broadcast own updated knowledge packet into the pool's packets/ directory.
  const broadcastPacket = broadcastKnowledge(store, workspaceRoot, { agentId });
  const myPacketPath = join(packetsDir, `packet_${agentId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  let broadcastSkipped = false;
  try {
    // `wx` refuses to clobber a packet another run already published.
    writeFileSync(myPacketPath, JSON.stringify(broadcastPacket, null, 2), {
      encoding: "utf-8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
    broadcastSkipped = true;
  }

  return {
    pool_dir: poolDir,
    packets_dir: packetsDir,
    agent_id: agentId,
    peers_contacted: Array.from(peersContacted),
    packets_processed: packetsProcessed,
    total_ingested: totalIngested,
    total_duplicates: totalDuplicates,
    total_conflicts: totalConflicts,
    broadcast_packet_id: broadcastPacket.packet_id,
    broadcast_skipped: broadcastSkipped,
    timestamp: new Date().toISOString(),
  };
}
