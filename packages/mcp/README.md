# @portiq/mcp — `portiq-mcp` stdio MCP server

A Model Context Protocol server exposing your Portiq API library to AI hosts.
It reads the same shared store as the desktop app (`<dataDir>/appdata.sqlite`)
resolved via `@portiq/core`'s `resolveDataDir()`.

## Run

```bash
# Read + execute only (default; writes disabled):
portiq-mcp

# Enable guarded write tools:
portiq-mcp --allow-writes
# or: PORTIQ_MCP_ALLOW_WRITES=1 portiq-mcp

# Point at a specific data dir (else PORTIQ_DATA_DIR, else OS default):
portiq-mcp --data-dir /path/to/dir
```

### HTTP transport (streamable HTTP)

```bash
# Serve over HTTP instead of stdio (default host 127.0.0.1, port 3939, endpoint /mcp):
portiq-mcp --http
# or: PORTIQ_MCP_HTTP=1 portiq-mcp

# Custom bind host/port and a required bearer token:
portiq-mcp --http --host 127.0.0.1 --port 8080 --auth-token my-secret
# env equivalents: PORTIQ_MCP_HOST, PORTIQ_MCP_PORT, PORTIQ_MCP_AUTH_TOKEN
```

Clients connect to `http://<host>:<port>/mcp` and send `Authorization: Bearer <token>` when a token is set.
The HTTP server is **single-session** (one client at a time) and defaults to the **loopback** interface;
binding to a non-loopback host without `--auth-token` prints a warning. HTTP host-config drop-in:

```json
{ "mcpServers": { "portiq": { "url": "http://127.0.0.1:3939/mcp" } } }
```

### Execution allow/deny-list (host safety knob)

```bash
# Only permit executions targeting these hosts (repeatable; comma lists; supports *.example.com and host:port):
portiq-mcp --exec-allow api.example.com --exec-allow '*.internal.test'
# Always block these hosts (deny wins over allow):
portiq-mcp --exec-deny 169.254.169.254 --exec-deny localhost:5432
# env equivalents: PORTIQ_MCP_EXEC_ALLOW, PORTIQ_MCP_EXEC_DENY (comma-separated)
```

The list gates the execute tools (`run_request`, `run_ad_hoc_request`, `run_collection`, `run_flow`) by the
resolved target host of each network send; a blocked host returns a tool error naming the deny- or allow-list.

## Tools

- **Read (always on):** `list_collections`, `list_requests`, `get_request`,
  `search`, `list_environments`, `get_environment`, `import_curl` (parse-only).
- **Execute (always on):** `run_request`, `run_ad_hoc_request`, `run_collection`,
  `run_flow`.
- **Write (opt-in via `--allow-writes`; hidden otherwise):** `create_request`,
  `update_request`, `delete_request`, `create_collection`,
  `set_environment_variable`, `save_ad_hoc_as_request`.

## Resources

`portiq://collections`, `portiq://collection/{id}`, `portiq://request/{id}`,
`portiq://environments`, `portiq://environment/{id}`, `portiq://flows`,
`portiq://flow/{id}`, `portiq://history`.

## Claude Code

```bash
claude mcp add portiq -- portiq-mcp
# with writes:
claude mcp add portiq -- portiq-mcp --allow-writes
```

Or add to `.mcp.json` / your Claude Code config:

```json
{
  "mcpServers": {
    "portiq": { "command": "portiq-mcp", "args": [] }
  }
}
```

## Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "portiq": {
      "command": "npx",
      "args": ["-y", "@portiq/mcp"]
    }
  }
}
```

## Notes & limitations

- **Transports:** stdio (default) or streamable HTTP (`--http`). The HTTP server is single-session and
  loopback-first; multi-session pooling is out of scope.
- **Gate precedence (independent gates over disjoint tool categories):**
  - `--allow-writes` gates library-MUTATION tools (`create_*`, `update_*`, `delete_*`,
    `set_environment_variable`, `save_ad_hoc_as_request`) — unrelated to transport and to host policy.
  - The exec allow/deny-list gates EXECUTE tools by resolved target host. **Deny wins**: a denied host is
    blocked even if allow-listed; an empty allow-list permits all non-denied hosts; a non-empty allow-list
    default-denies unlisted hosts.
  - A mutating tool is never subject to the host policy; an execute tool is never subject to `--allow-writes`.
  - HTTP bind-host + `--auth-token` act at the transport layer, before any tool gate.
- **Protocols:** `http` and `graphql` execute; `websocket`/`grpc` return a clear
  "not supported headlessly yet" error (gRPC will run through `run_request` once
  its core sender lands).
- **History:** `portiq://history` reflects only history stored in the shared
  `appState` blob; the desktop app currently keeps history in renderer
  `localStorage`, so this is typically empty.
- **Concurrency:** while the desktop app is running, its writes do not bump the
  optimistic `kv_version` counter yet, so MCP write tools cannot detect a
  concurrent app edit (last-writer-wins). Prefer running write tools with the
  desktop app closed until version reconciliation lands.
- Runs on plain Node. If you also run the Electron app from source, remember the
  `better-sqlite3` ABI split: `npm rebuild better-sqlite3` for Node/MCP,
  `npm run rebuild` for Electron.
