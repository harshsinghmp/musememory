# 👥 Muse Memory — Team Quickstart & Deployment Guide

> **Audience**: Engineering Leads, Technical Directors, Team Heads, and Developers.  
> **Goal**: Deploy a central, persistent cognitive memory server for your engineering team and connect all team members' AI coding agents (Cursor, Opencode, Claude Code, Antigravity, Windsurf) in under 5 minutes.

---

## 1. Architecture Overview: Single Host vs. Corrupted Mounts

When deploying Muse Memory for a multi-developer team, the storage topology is critical:

> [!CAUTION]
> **The Networked SQLite Trap**: Never mount SQLite database files over networked filesystems (NFS, SMB, CIFS, Google Drive, or Dropbox). SQLite Write-Ahead Logging (`-wal`) requires atomic POSIX shared-memory synchronization (`-shm`) and OS-level file locking. Network mounts lack these primitives and **will corrupt database headers and cause split-brain cache states**.

### The Production Standard: Single Host + MCP Streamable HTTP

Exactly **one machine or VM acts as the team host server**, owning `team.db` and the repository's shared constraints in-process. All team members connect remotely over LAN, VPN, or HTTPS via the **MCP Streamable HTTP Transport (2025-06-18 spec)** with **Bearer token authentication**.

```
                        ┌────────────────────────────────────────────────────────┐
                        │             Central Muse Memory Host Server            │
                        │           `musememory serve --port 31338 ...`          │
                        │                                                        │
                        │   ┌────────────────────┐   ┌───────────────────────┐   │
                        │   │      team.db       │   │      CURRENT.md       │   │
                        │   │ (SQLite in-process)│   │  (Shared Constraints) │   │
                        │   └────────────────────┘   └───────────────────────┘   │
                        └───────────────────────────▲────────────────────────────┘
                                                    │
                   MCP Streamable HTTP (2025-06-18) │ Authorization: Bearer <token>
        ┌───────────────────────────┬───────────────┴───────────────┬───────────────────────────┐
        │                           │                               │                           │
 ┌──────┴──────┐             ┌──────┴──────┐                 ┌──────┴──────┐             ┌──────┴──────┐
 │    Alice    │             │     Bob     │                 │   Charlie   │             │    Dana     │
 │  (Cursor)   │             │ (Opencode)  │                 │(Antigravity)│             │(Claude Code)│
 └─────────────┘             └─────────────┘                 └─────────────┘             └─────────────┘
```

---

## 2. Team Head: Server Deployment (5 Minutes)

### Step 2.1: Install Muse Memory on the Host Machine

On your shared internal server, VM, or developer bastion:

```bash
bun add -g musememory@latest
# or: npm install -g musememory@latest
```

### Step 2.2: Launch the Team Server

Choose one of two authentication modes:

#### Option A: Shared Agency Token (Quickest for small teams)
```bash
musememory serve \
  --port 31338 \
  --host 0.0.0.0 \
  --token "agency-shared-token-2026"
```

#### Option B: Per-Peer Tokens with Allowlisting (Recommended for production)
Maps individual tokens to developer names so all memory writes and audit logs are securely attributed to specific teammates:

```bash
musememory serve \
  --port 31338 \
  --host 0.0.0.0 \
  --tokens "alice:tok_alice_83f1,bob:tok_bob_94a2,charlie:tok_charlie_11c3" \
  --allowed-peers "alice,bob,charlie" \
  --allowed-origins "https://internal.mycompany.com"
```

### Step 2.3: Verify the Server is Responding

Run a quick health check from any machine on your network:

```bash
curl -X POST http://<SERVER-IP>:31338/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <YOUR-TOKEN>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```
You will receive an HTTP 200 response with `capabilities` and an `mcp-session-id` header.

---

## 3. Generating Team Member Recipes

Rather than writing manual JSON for every developer, the team head can generate ready-to-paste recipes directly from the CLI:

```bash
musememory connect --recipe \
  --endpoint http://192.168.1.50:31338/mcp \
  --token tok_alice_83f1 \
  --peer alice
```

This prints formatted configurations tailored to each editor's exact schema requirements.

---

## 4. Team Member Setup: Editor-by-Editor Configurations

> [!NOTE]
> **Why do these configurations look slightly different?**  
> While all editors connect to the same HTTP endpoint and pass the same Bearer token, **each editor expects a different configuration filename, root key, and transport declaration**. Notice the highlighted differences below.

### A. Cursor

- **Config Path**: `~/.cursor/mcp.json` (global) or `<project>/.cursor/mcp.json` (workspace-level).
- **Format Nuance**: Uses root key `"mcpServers"`. Specify `"url"` and `"headers"`.

```json
{
  "mcpServers": {
    "musememory": {
      "url": "http://192.168.1.50:31338/mcp",
      "headers": {
        "Authorization": "Bearer tok_alice_83f1",
        "mcp-peer-id": "alice"
      }
    }
  }
}
```

### B. Opencode

- **Config Path**: `~/.config/opencode/opencode.json`
- **Format Nuance**: Uses root key `"mcp"`. **Requires `"type": "remote"`** so Opencode knows to use an HTTP stream instead of executing a local binary.

```json
{
  "mcp": {
    "musememory": {
      "type": "remote",
      "url": "http://192.168.1.50:31338/mcp",
      "headers": {
        "Authorization": "Bearer tok_bob_94a2",
        "mcp-peer-id": "bob"
      }
    }
  }
}
```

### C. Claude Code & Antigravity

- **Config Path**: `~/.claude/mcp_config.json` (Claude Code) or Antigravity MCP settings.
- **Format Nuance**: Uses `"mcpServers"`. **Requires `"transport": "http"`** explicitly declared; otherwise, the runtime assumes local stdio execution and errors.

```json
{
  "mcpServers": {
    "musememory": {
      "url": "http://192.168.1.50:31338/mcp",
      "transport": "http",
      "headers": {
        "Authorization": "Bearer tok_charlie_11c3",
        "mcp-peer-id": "charlie"
      }
    }
  }
}
```

### D. Windsurf / Codeium

- **Config Path**: `~/.codeium/windsurf/mcp_config.json`
- **Format Nuance**: Uses `"mcpServers"` with `"transport": "http"`.

```json
{
  "mcpServers": {
    "musememory": {
      "url": "http://192.168.1.50:31338/mcp",
      "transport": "http",
      "headers": {
        "Authorization": "Bearer tok_dana_44d5",
        "mcp-peer-id": "dana"
      }
    }
  }
}
```

---

## 5. Memory Scoping & Governance Rules for Teams

In a shared multi-agent workspace, **memory hygiene is non-negotiable**. If one developer's agent captures unverified thoughts or temporary hacks into the shared memory store, every teammate's AI will ingest them as authoritative truth.

### The Two Tiers of Memory

| Category | Storage Target | Examples | Policy |
| :--- | :--- | :--- | :--- |
| **Shared Team Memory** | Host `team.db` & `CURRENT.md` | • Accepted Architecture Decisions (ADRs)<br>• Verified bug root-cause fixes<br>• Team conventions & hard invariants<br>• Breaking migration notices | **High Bar**: Applies to all team members immediately upon write. Requires confirmation gate. |
| **Personal Developer Memory** | Local `tenant_<user>.db` or local `.memory/` | • Personal shell aliases<br>• Local tool paths & IDE keybindings<br>• Temporary debugging scratchpads<br>• Draft notes before code review | **Isolated**: Stays strictly on the developer's local machine; never uploaded to team memory. |

### The Golden Rule of Shared Memory
> **"If an instruction is written to shared memory, it affects all team members' agents on their very next prompt."**  
> Never capture transient debugging thoughts or unverified hypotheses into the shared team store.

---

## 6. Poisoning & Prompt Injection Defense

Because `CURRENT.md` is injected into every teammate's prompt on turn 1 (`get_context`), an unauthorized or malicious write acts as a prompt injection across the entire engineering department.

Muse Memory enforces 4 built-in defense gates:
1. **Peer Attribution**: Every memory operation is stamped with the verified `mcp-peer-id` derived from their Bearer token.
2. **Audit Ledger**: All insertions, updates, and deletions append to `audit.jsonl` with cryptographic timestamps and actor identities.
3. **Vibeguard Secret Defense**: The server automatically blocks any write containing API keys, private keys, or passwords.
4. **Retention Score Gate**: Transient noise or low-quality text is automatically rejected before entering SQLite (minimum score: 0.30).

---

## 7. Troubleshooting

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| `401 Unauthorized` | Missing or malformed `Authorization` header | Ensure your editor config includes `"headers": { "Authorization": "Bearer <token>" }`. |
| `403 Forbidden` | Invalid token or peer not in `--allowed-peers` | Check that your token matches the server startup arguments and that your peer name is allowlisted. |
| `400 Bad Request` missing accept header | Client did not send MCP Streamable HTTP accept header | Verify your client supports MCP 2025-06-18 spec (`Accept: application/json, text/event-stream`). |
| Connection refused | Server not listening on `0.0.0.0` or firewall blocking port | Ensure server is started with `--host 0.0.0.0` and port `31338` (or your chosen port) is open in the firewall. |
