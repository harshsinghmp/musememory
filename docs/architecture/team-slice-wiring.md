# 👥 Muse Memory — Team Slice Wiring & Scoping Architecture (T-387)

> **Document Scope**: Team topology, MCP Streamable HTTP client recipes, and shared vs personal memory scoping policy for multi-member engineering teams.  
> **Status**: Production Standard (v2.0.0 — Wave 7: Team Slice)  
> **Axiom**: Exactly **one** server process owns the shared team store; SQLite files are **never** mounted over networked filesystems (NFS/SMB).

---

## 1. Team Topology Architecture

### The Networked SQLite Trap (Why Shared Mounts Corrupt)
SQLite's Write-Ahead Log (WAL) mode relies on POSIX shared memory (`-shm`) and OS-level file locking protocols (`-wal`) for concurrency coordination. Networked filesystems (NFS, SMB, CIFS, Google Drive, Dropbox) do not implement atomic POSIX shared-memory synchronization across different machines. Running multiple concurrent Muse processes against a shared SQLite file over a network mount results in stale cache reads, race conditions, and irreparable database header corruption.

### The Correct Topology: Single Host Process + HTTP MCP
The team topology designates **one machine or VM as the host server**. 
- The host runs `musememory serve` (or `musememory mcp --http`).
- The host owns and writes to `team.db` in-process with full WAL isolation.
- Team members connect their coding agents (Cursor, Opencode, Claude Code, Antigravity) over local LAN or remote HTTPS using the **MCP Streamable HTTP transport (2025-06-18 spec)** with **Bearer token authentication**.

```
                           ┌───────────────────────────────────────────────┐
                           │            Muse Memory Host Server            │
                           │  `musememory serve --port 31338 --token ...`  │
                           │                                               │
                           │  ┌─────────────┐  ┌────────────────────────┐  │
                           │  │   team.db   │  │       CURRENT.md       │  │
                           │  │ (In-Process)│  │   (Shared Constraints) │  │
                           │  └─────────────┘  └────────────────────────┘  │
                           └───────────────────────▲───────────────────────┘
                                                   │
                  MCP Streamable HTTP (2025-06-18) │ Authorization: Bearer <token>
       ┌───────────────────────────┬───────────────┴───────────────┬───────────────────────────┐
       │                           │                               │                           │
┌──────┴──────┐             ┌──────┴──────┐                 ┌──────┴──────┐             ┌──────┴──────┐
│   Alice     │             │    Bob      │                 │   Charlie   │             │    Dana     │
│  (Cursor)   │             │ (Opencode)  │                 │(Antigravity)│             │(Claude Code)│
│ local DB    │             │ local DB    │                 │ local DB    │             │ local DB    │
└─────────────┘             └─────────────┘                 └─────────────┘             └─────────────┘
```

---

## 2. Server Deployment & Configuration

### Starting the Team Server
Run the HTTP MCP transport on the host machine:

```bash
# Basic team server with single shared token
musememory serve --port 31338 --host 0.0.0.0 --token "agency-secret-token"

# Or with per-peer tokens and peer allowlisting (T-386)
musememory serve \
  --port 31338 \
  --host 0.0.0.0 \
  --tokens "alice:tok-alice-123,bob:tok-bob-456,charlie:tok-charlie-789" \
  --allowed-peers "alice,bob,charlie" \
  --allowed-origins "https://dashboard.internal.agency"
```

### Server Security Layers:
1. **Bearer Token Authentication (T-386)**: Every request must carry `Authorization: Bearer <token>`. Missing tokens return `401 Unauthorized` with `WWW-Authenticate`; invalid tokens return `403 Forbidden`.
2. **Per-Peer Allowlist (T-386)**: Tokens map to peer identities; only peers listed in `--allowed-peers` are authorized to execute tools.
3. **Origin Allowlist (T-151)**: Cross-origin browser requests are checked against `--allowed-origins` for CSRF defense.
4. **Host Allowlist (T-151)**: Checks incoming `Host` headers against `--allowed-hosts` to mitigate DNS rebinding attacks.

---

## 3. Client Configuration Recipes (T-387)

Team members configure their local coding assistants to connect to the team host. You can generate ready-to-paste configurations using:

```bash
musememory connect --recipe --endpoint http://192.168.1.50:31338/mcp --token tok-alice-123
```

### A. Cursor (`~/.cursor/mcp.json` or `.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "musememory": {
      "url": "http://192.168.1.50:31338/mcp",
      "headers": {
        "Authorization": "Bearer tok-alice-123",
        "mcp-peer-id": "alice"
      }
    }
  }
}
```

### B. Opencode (`~/.config/opencode/opencode.json`)
```json
{
  "mcp": {
    "musememory": {
      "type": "remote",
      "url": "http://192.168.1.50:31338/mcp",
      "headers": {
        "Authorization": "Bearer tok-bob-456",
        "mcp-peer-id": "bob"
      }
    }
  }
}
```

### C. Claude Code & Antigravity
In the MCP configuration file (`mcp_config.json`):
```json
{
  "mcpServers": {
    "musememory": {
      "url": "http://192.168.1.50:31338/mcp",
      "transport": "http",
      "headers": {
        "Authorization": "Bearer tok-charlie-789",
        "mcp-peer-id": "charlie"
      }
    }
  }
}
```

---

## 4. Scoping Policy: Shared Team Memory vs. Personal Memory

In a team environment, memory pollution is the greatest risk to agent accuracy. If ephemeral personal notes or half-baked experiments bleed into shared memory, every teammate's agent will ingest them during `get_context`.

| Classification | Storage Location | Examples | Access Rule |
| :--- | :--- | :--- | :--- |
| **Shared Team Memory** | Host `team.db` & `CURRENT.md` | - Architectural decisions (ADRs)<br>- Hard system invariants<br>- Tested bug root-cause fixes<br>- Universal team conventions | Readable by all team members; requires verified consensus or confirmation gate. |
| **Personal Developer Memory** | Local `tenant_<user>.db` or local `memory.db` | - Local shell aliases & tool paths<br>- In-flight experimental scratchpads<br>- Personal IDE keybinding preferences<br>- Draft notes prior to review | Isolated to the individual developer; never uploaded to shared team store. |

### The Golden Rule of Shared Memory
> **"If an instruction or decision is written to shared memory, it applies to all 5 team members immediately."**  
> Never capture transient debugging thoughts or unverified hypotheses into the shared team store.

---

## 5. `CURRENT.md` Governance & Poisoning Defense

### The Threat: Multi-Agent Instruction Poisoning
`CURRENT.md` serves as the prompt-grounding surface loaded by every connected agent on its first turn (`get_context`). In single-user environments, this is harmless. On a shared team network, however, an unvalidated write to `CURRENT.md` acts as a **prompt injection across the entire engineering team**.

### Governance Mandates:
1. **Never write unverified task state to `CURRENT.md`**: Only hard invariants, breaking changes, or cross-cutting migrations belong in shared constraints.
2. **Pre-Ship Peer Identification**: Every constraint write is attributed to the calling peer (via `mcp-peer-id` and Bearer token).
3. **Rollback & Audit**: All mutations to `CURRENT.md` and `team.db` are recorded in `audit.jsonl` with timestamps and peer actors.
4. **Local Task Isolation**: Team members must keep daily personal task checklists in local branch notes or personal scratchpads, leaving `CURRENT.md` reserved for repository-level invariants.
