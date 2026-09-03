# Cross-Agent Knowledge Sync & P2P Gossip Protocol Architecture (R14)

## Overview

In multi-agent collaborative workflows (e.g. Agency pods containing dedicated frontend, backend, test, and security subagents), agents frequently encounter local insights, novel bug workarounds, and working constraints in their isolated working contexts. Without an autonomous synchronization mechanism, subagents must either reinvent solutions or rely on centralized, resource-heavy coordination servers.

The **Cross-Agent Knowledge Sync Protocol** enables decentralized peer-to-peer knowledge sharing between subagents and agency pods with **zero resident background daemons**, utilizing cryptographically sealed, portable sync packets and shared filesystem gossip pools.

---

## Core Invariants

1. **Zero Resident Daemons**: Synchronization is strictly on-demand (CLI invocation or agent tool call) without background worker processes or network listeners.
2. **Deterministic Packet Integrity**: Every packet is sealed with a deterministic SHA-256 checksum over its metadata and payload. Tampered or corrupted packets are immediately rejected.
3. **Causal Vector Clock Tracking**: Knowledge causality is tracked using peer vector clocks (`Record<string, number>`) ensuring distributed consistency across asynchronous agent runs.
4. **Zero-Secret Defense (Vibeguard)**: Packets pass through inline regex secret scanning before export and upon ingestion; packets containing credentials are blocked and flagged.
5. **Semantic Contradiction Guard**: Ingested peer memories that conflict with confirmed local memories are tagged with `conflicted` status and cross-linked via mutual `conflict_ids`.

---

## Data Structures

### 1. `SyncPacket`
```typescript
interface SyncPacket {
  protocol_version: "2.0.0";
  packet_id: string;             // packet_<sender>_<timestamp>_<rand>
  sender_id: string;             // e.g. "sol@agent-box"
  timestamp: string;             // ISO 8601
  project: string;               // project name or scope
  vector_clock: Record<string, number>;
  payload: {
    memories: MemoryEntry[];     // Exported verified memory units
    constraints: string[];       // Active CURRENT.md hard invariants
    deleted_ids?: string[];      // Tombstones for purged entries
  };
  checksum: string;              // SHA-256 hex digest
}
```

### 2. `SyncPeerLedger`
Maintained in `.memory/sync_peers.json`:
```typescript
interface SyncPeerLedger {
  local_agent_id: string;
  vector_clock: Record<string, number>;
  known_peers: Record<string, {
    peer_id: string;
    last_seen: string;
    last_packet_id: string;
    vector_clock: Record<string, number>;
    total_packets_received: number;
    memories_ingested: number;
  }>;
}
```

---

## Gossip Pool Protocol Workflow

```
[Agent A (e.g. Backend Subagent)]
         │
         ├── 1. Generates SyncPacket (broadcastKnowledge)
         ├── 2. Drops packet into shared pool: /path/to/pool/packet_A_1.json
         │
         ▼
[Shared Filesystem Gossip Pool (.memory/sync_pool/)]
         ▲
         ├── 3. Scans pool for packets from uncontacted or newer peers
         ├── 4. Verifies SHA-256 packet checksum and validates schema
         ├── 5. Performs Vibeguard secret inspection
         ├── 6. Deduplicates against existing local fingerprints
         ├── 7. Detects semantic contradictions (sets conflicted status)
         └── 8. Updates local vector clock & writes peer ledger
         │
[Agent B (e.g. Frontend Subagent)]
```

---

## Integration Surface

- **CLI**:
  - `memory sync --status`
  - `memory sync --broadcast [--out <path>]`
  - `memory sync --ingest <path>`
  - `memory sync --pool [--pool-dir <path>]`
- **MCP Tools**:
  - `muse_sync_broadcast`: Generates and exports a sealed sync packet.
  - `muse_sync_ingest`: Ingests and verifies an incoming sync packet.
  - `muse_sync_status`: Inspects local agent vector clock and peer stats.
  - `muse_sync_pool`: Synchronizes bidirectionally with a shared gossip folder.
- **Web Studio**:
  - `panel-sync`: Displays peer ledger table, vector clock statuses, and one-click manual sync triggers.
