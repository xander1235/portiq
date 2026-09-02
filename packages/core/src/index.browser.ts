// @portiq/core — renderer-safe entry.
//
// Vite resolves this file via the "browser" export condition (see
// package.json `exports["."]`). It re-exports ONLY modules that are safe to
// *evaluate* in a Chromium renderer: no `node:` builtins, no native addons.
//
// The renderer imports the bare `@portiq/core` barrel in ~12 files (protocol
// metadata, scripting, curl helpers, model types). The full `.` barrel
// (`./index.ts`) also `export *`s Node-only modules; because Vite evaluates a
// re-export barrel eagerly (dev) — and Rollup would only tree-shake them in
// prod — pulling the full barrel into the renderer drags `node:os` etc. in and
// throws at module init against Vite's browser stubs (blank screen). This
// mirrors the existing `./flows`, `./grpc`, and `./sync/browser` split.
//
// Deliberately EXCLUDED (Node-only; evaluated only in electron main / CLI /
// MCP, which get the full `.` barrel via the "require"/"import" conditions):
//   ./store/dataDir, ./store/kvStore, ./store/appStateStore  — node:os/path/fs, better-sqlite3
//   ./transport/http, ./transport/websocket                  — node:http/https/http2, ws, node:events
//   ./mock                                                    — node:http mock server
// The renderer reaches persistence + real transports through `window.api`
// (IPC), never these modules directly (verified: no renderer import references
// them, nor any `@portiq/core/{store,transport,mock}` subpath).
export const CORE_VERSION = "0.0.0";
export * from "./model";
export * from "./store/keystoreTypes";
export * from "./store/portable";
export * from "./exec/interpolate";
export * from "./exec/headers";
export * from "./exec/autoHeaders";
export * from "./exec/multipart";
export * from "./exec/assembleRequest";
export * from "./import/curlParser";
export * from "./import/types";
export * from "./import/ids";
export * from "./import/postmanParser";
export * from "./import/openapiParser";
export * from "./import/collectionImport";
export * from "./transport/httpResult";
export * from "./transport/graphql";
export * from "./scripting/testRunner";
export * from "./scripting/scriptSteps";
export * from "./scripting/pm";
export * from "./protocols";
