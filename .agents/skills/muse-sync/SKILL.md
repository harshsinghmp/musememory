---
name: muse-sync
description: Cross-agent knowledge sync and P2P gossip mesh protocol. Enables multi-agent swarms and isolated subagent teams to exchange insights, deduplicate knowledge, and resolve contradictions asynchronously.
---

# 🤝 Muse Sync (`muse-sync`)

> **When to use**: Execute when coordinating multi-agent workflows (e.g., frontend, backend, and test subagents), sharing verified bug fixes between worktrees, or consolidating swarm learnings.

---

## 🚀 Execution Workflow

### Step 1: Check Peer Mesh & Vector Clock Status
Call the `muse_sync_status` MCP tool (or run `memory sync --status`):

```json
{
  "dir": "."
}
```

Returns peer agent vector clocks, tracked packet generations, and pending incoming packets.

### Step 2: Broadcast a Sealed Knowledge Packet
To export recent confirmed memories, bug fixes, and active constraints into a portable packet:

```json
{
  "project": "my-project",
  "export_constraints": true
}
```

The engine creates a cryptographically sealed `SyncPacket` with:
- Whole-packet SHA-256 checksum verification.
- Vector clock causal sequencing (`sender_id` + logical sequence).
- Automatic Vibeguard secret inspection prior to packaging.

### Step 3: Synchronize via Zero-Daemon Shared Pool
Call `muse_sync_pool` (or run `memory sync --pool`):
- Broadcasts un-synced memories into `.memory/sync_pool/`.
- Ingests new packets dropped by peer subagents.
- Eliminates duplicate entries automatically.
- Flags semantic contradictions with mutual `conflict_ids` and triggers dispute resolution.

---

## 💻 CLI Equivalents (Zero-MCP Fallback)

```bash
# View peer agent sync status and vector clocks
memory sync --status

# Broadcast confirmed memories to an exported packet
memory sync --broadcast --out ./shared_sync.json

# Ingest peer knowledge packet with secret scrubbing
memory sync --ingest ./shared_sync.json

# Bidirectionally sync with the shared filesystem gossip pool
memory sync --pool
```
