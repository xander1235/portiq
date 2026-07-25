# @portiq/cli — `portiq` command-line client

A standalone terminal client for your Portiq API library. It reads and writes
the same shared store as the desktop app (`<dataDir>/appdata.sqlite`), resolved
via `@portiq/core`'s `resolveDataDir()`, and executes requests through the same
`@portiq/core` transport/scripting engine the desktop app uses — so `portiq run`
and clicking "Send" in the app produce the same request/response/tests.

## Install

`@portiq/cli` is publishable (`"private": false`, `publishConfig.access: "public"`,
a `portiq` bin pointing at the bundled `dist/portiq.bundle.cjs`) but has not
been published to the npm registry yet — publishing is pending a tagged release.
Once published, the intended usage is:

```bash
npx -y @portiq/cli ls
# or
npm install -g @portiq/cli
portiq ls
```

Until then, run it from a checkout of this repository:

```bash
npm install
npm run build:cli
node packages/cli/dist/index.js --help
```

or link it onto your `PATH` locally:

```bash
cd packages/cli && npm link
portiq --help
```

## Global flags

These apply to every command:

| Flag | Description |
| --- | --- |
| `--data-dir <path>` | override the Portiq data directory |
| `--env <name>` | environment to interpolate `{{variable}}`s from (else the app's active environment) |
| `--var <k=v>` | override/add one variable (repeatable) |
| `--reporter <pretty\|json\|junit>` | output format (default: `pretty` on a TTY, `json` when piped) |
| `-o, --output <file>` | write the report to a file instead of stdout |
| `--timeout <ms>` | request timeout in milliseconds |
| `--fail-on-test` | exit `2` when any test fails (see Exit codes) |
| `--dry-run` | resolve the request (headers/URL/body) without sending it |
| `--no-color` | disable ANSI color in the `pretty` reporter |

Data-dir resolution precedence: `--data-dir` → `PORTIQ_DATA_DIR` env → CLI config
file `dataDir` (see `config`, below) → OS default
(`~/Library/Application Support/Portiq` on macOS, `%APPDATA%/Portiq` on Windows,
`~/.config/Portiq` on Linux).

## Commands

`portiq` registers 12 top-level commands: `ls, get, search, run, exec, import,
export, where, config, mcp, mock, sync`.

### `ls [kind]`

List `collections` (default), `requests`, `envs`, or `flows` as a table.

```bash
portiq ls
portiq ls requests
```

### `get <ref>`

Inspect a resolved request, collection, environment, or flow.

```bash
portiq get "API/Ping"
portiq get --id <uuid>
```

Flags: `--id <uuid>` (resolve by id instead of a `Collection/Folder/Request` path).

### `search <query>`

Fuzzy-search request paths, names, and URLs across the whole library.

```bash
portiq search ping
```

### `run <ref>`

Execute a saved request, collection, or flow and run its tests through the
shared `@portiq/core` engine. This includes saved gRPC requests — `run` sends
whatever protocol the request was saved with (HTTP or gRPC); it has no
gRPC-specific flags of its own since the call config (service/method/proto/TLS)
already lives on the saved request.

```bash
portiq run "API/Ping"
portiq run "API" --fail-on-test
portiq run "API/Ping" --dry-run
```

Flags: `--id <uuid>`. Collections run every non-`dag`/`websocket`/`grpc` request
in the tree and aggregate test results; flows run through `@portiq/core/flows`.
`--dry-run` on a single gRPC request prints the resolved service/method/URL/body
without dialing; on a saved flow it prints the flow's node names.

### `exec [url]`

Send an ad-hoc request — curl-like flags, `--from-curl`, or gRPC flags — without
saving it.

```bash
portiq exec https://api.example.com/ping
portiq exec https://api.example.com/users -X POST -H "Content-Type: application/json" -d '{"name":"a"}'
portiq exec --from-curl "curl -H 'Authorization: Bearer x' https://api.example.com"

# gRPC
portiq exec grpc://localhost:50051 --service pkg.UserService -X GetUser -d '{"id":"1"}' --proto ./user.proto
portiq exec grpc://localhost:50051 --service pkg.UserService -X GetUser --reflection
```

HTTP flags: `-X, --method <method>`, `-H, --header <header>` (repeatable,
`"Key: Value"`), `-d, --data <body>`, `--from-curl <command>`. Requires a
`<url>` or `--from-curl`.

gRPC flags (gRPC mode is triggered by `--grpc`, `--service`, or a
`grpc://`/`grpcs://` URL scheme): `--grpc`, `--service <name>` (required),
`--proto <file>` (path to a `.proto`; omit when using `--reflection`),
`--call-type <UNARY|SERVER_STREAM|CLIENT_STREAM|BIDI_STREAM>` (default
`UNARY`), `--message <json>` (repeatable; additional messages for
client/bidi streaming), `--reflection` (resolve descriptors via server
reflection instead of `--proto`), `--ca-cert <file>` / `--client-cert <file>` /
`--client-key <file>` (mTLS, PEM), `--token <token>` (call-credential bearer
token). In gRPC mode, `-X` is the RPC method name (required), `-H` entries
become gRPC metadata, and `-d` is the request message JSON.

### `import <file>`

Import a curl command, a `portiq.json` portable file, a Postman v2.1
collection, or an OpenAPI 3.x document into the shared store. The format is
auto-detected from the file's contents — no `--format` flag is needed.

```bash
portiq import ./request.curl --collection "Imported"
portiq import ./export.portiq.json
portiq import ./postman-collection.json
portiq import ./openapi.yaml
```

Flags: `--collection <name>` (default `Imported`; only used for curl imports —
Postman/OpenAPI/portable imports bring their own collection names/structure).
Retries once on an optimistic-concurrency conflict (`ConflictError`), then fails.

### `export [ref]`

Export a request as curl, or a collection/the whole library as `portiq.json`.

```bash
portiq export "API/Ping" --format curl
portiq export "API" --format portiq
portiq export --all --format portiq -o library.portiq.json
```

Flags: `--format <curl|portiq>` (default `portiq`), `--id <uuid>`, `--all`
(export the entire library; `portiq` format only).

### `where`

Print the resolved data directory, database path, and CLI config path.

```bash
portiq where
```

### `config [path|set <key> <value>]`

View or edit CLI configuration (`<dataDir>/cli-config.json`).

```bash
portiq config              # print current config
portiq config path         # print the config file path
portiq config set dataDir /custom/path
portiq config set reporter json
portiq config --recompose-legacy-blob   # rewrite the appState blob from per-entity rows
```

Settable keys: `dataDir`, `reporter`, `env`. `--recompose-legacy-blob` is a
maintenance flag — it rebuilds the legacy single-blob `appState` value from
the current per-entity rows, e.g. before downgrading to a CLI/app version that
still reads the blob directly.

### `mcp [args...]`

Start the stdio MCP server by spawning the `portiq-mcp` binary from `@portiq/mcp`
and forwarding stdio + any extra args verbatim (the CLI itself parses none of
them — `--allow-writes` below is a `portiq-mcp` flag, not a `portiq` one).

```bash
portiq mcp
portiq mcp --allow-writes
```

Prints an install hint (`portiq-mcp is not installed. Install it with: npm i -g @portiq/mcp`)
if `portiq-mcp` isn't resolvable on `PATH`.

### `mock <ref>`

Start an in-process HTTP mock server from a saved collection (routes are
generated from the collection's requests).

```bash
portiq mock "API"
portiq mock "API" --port 8080
```

Flags: `--port <number>` (default `3000`; `0` picks an OS-assigned ephemeral
port; range `0`–`65535`). Press `Ctrl-C` to stop.

### `sync login | push | pull | status`

Sync your workspace with a git remote (GitHub or a local bare/working repo).

```bash
portiq sync login
portiq sync push
portiq sync pull
portiq sync status
portiq sync push --local /path/to/repo
```

Flags (on `sync` itself, before the subcommand): `--token <token>` (else
`PORTIQ_GITHUB_TOKEN` / `GITHUB_TOKEN` / a token saved by `sync login`),
`--local <dir>` (sync to a local git repo instead of GitHub).

`sync login` authenticates via GitHub's OAuth device flow and saves the
resulting token so `push`/`pull`/`status` pick it up automatically — no more
manually exporting `GITHUB_TOKEN`. Flags: `--client-id <id>` (defaults to
Portiq's desktop app client id). It prints a one-time code and a verification
URL, then polls until you authorize in your browser.

**`sync push` sends variable values unmasked** — no desktop-style secret
redaction — do not push to shared or untrusted remotes.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | success |
| `1` | runtime error (e.g. no store found, mock/sync failure) |
| `2` | test failure (only with `--fail-on-test`) |
| `3` | usage error (bad flags/args) |

## Reporters

- `pretty` (default on a TTY) — colorized human-readable output; `--no-color` disables ANSI.
- `json` (default when piped) — `JSON.stringify` of the structured command output.
- `junit` — JUnit XML for `run`'s test results (CI-friendly).

`-o, --output <file>` writes the chosen reporter's output to a file instead of stdout.

## Notes & limitations

- Runs on plain Node. If you also run the Electron app from source, remember the
  `better-sqlite3` ABI split: `npm rebuild better-sqlite3` for Node/CLI,
  `npm run rebuild` for Electron.
- `exec` works without an existing store (best-effort `--var` interpolation only);
  every other command requires a store to already exist — run the desktop app
  once, or `portiq import`, first.
- **Concurrency:** CLI write commands (`import`, `sync pull`) read the store's
  version, write with that expected version, and retry once on a conflict. The
  desktop app's autosave, however, writes the whole `appState` unconditionally
  (no expected version) — so a desktop save that lands between the CLI's read
  and write can still silently overwrite a concurrent CLI edit. The desktop app
  does live-reload when it detects an external write (from the CLI or MCP), but
  a tight race between an in-flight desktop edit and a concurrent CLI write can
  still lose data. Prefer running write commands with the desktop app closed,
  or expect last-writer-wins on genuine races.
