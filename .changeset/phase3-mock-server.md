---
"@portiq/core": minor
---

Add a `mock/` core module (a plain factory — no registry, per Phase 0.5 Part C):
relocate the mock-server engine (`MockServerManager`, `matchPath`) out of
`transport/`, expose a `createMockManager()` factory, and port the headless
route helpers (`sanitizeRoutes`, `generateRoutesFromCollection`). Electron's
`mock:*` IPC handlers now delegate to `createMockManager()`.

Part B (`portiq mock <ref>` CLI command) is deferred: `packages/cli/src/registry.ts`
(the assumed Phase 2 CLI scaffold) is not present in this repo yet.
