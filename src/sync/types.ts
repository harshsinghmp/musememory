import type { MemoryEntry } from "../types.ts";

/**
 * Vector clock mapping agent ID to monotonic sequence number or timestamp.
 */
export type VectorClock = Record<string, number>;

/**
 * Supersession link gossiped across agents.
 */
export interface GossipSupersession {
  old_id: string;
  new_id: string;
  reason: string;
  actor: string;
  timestamp: string;
}

/**
 * Self-contained, portable knowledge envelope exchanged between peer agents.
 */
export interface SyncPacket {
  protocol_version: "2.0.0";
  sender_id: string;
  packet_id: string;
  created_at: string;
  vector_clock: VectorClock;
  project: string;
  payload: {
    memories: MemoryEntry[];
    constraints: string[];
    supersessions: GossipSupersession[];
    hashes: Record<string, string>;
  };
  checksum: string;
}

/**
 * Options for generating a sync broadcast packet.
 */
export interface BroadcastOptions {
  agentId?: string;
  project?: string;
  sinceTimestamp?: string;
  includeHistorical?: boolean;
  limit?: number;
}

/**
 * Result of ingesting a peer gossip packet into the local store.
 */
export interface SyncResult {
  success: boolean;
  sender_id: string;
  packet_id: string;
  ingested_count: number;
  duplicate_count: number;
  conflict_count: number;
  superseded_count: number;
  details: {
    ingested_ids: string[];
    duplicate_ids: string[];
    conflicted_ids: string[];
    superseded_ids: string[];
  };
  errors: string[];
}

/**
 * Persistent tracking record for a known peer agent.
 */
export interface PeerRecord {
  agent_id: string;
  last_seen_at: string;
  last_packet_id: string;
  vector_clock: VectorClock;
  total_packets_received: number;
  total_memories_ingested: number;
}

/**
 * Overall synchronization status report.
 */
export interface SyncStatusReport {
  local_agent_id: string;
  local_vector_clock: VectorClock;
  known_peers: PeerRecord[];
  total_peers: number;
  pending_outgoing_memories: number;
  last_sync_at?: string;
  shared_pool_path?: string;
}

/**
 * Summary of synchronizing with a shared folder pool.
 */
export interface PoolSyncReport {
  pool_dir: string;
  agent_id: string;
  peers_contacted: string[];
  packets_processed: number;
  total_ingested: number;
  total_duplicates: number;
  total_conflicts: number;
  broadcast_packet_id: string;
  timestamp: string;
}
