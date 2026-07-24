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

- **stdio only** (no HTTP transport in this phase).
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
