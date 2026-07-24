---
"@portiq/cli": minor
---

Add the `portiq` CLI (`@portiq/cli`): ls/get/search/run/exec/import/export/where/config plus an `mcp` passthrough, with pretty/json/junit reporters and CI-friendly exit codes. Consumes `@portiq/core` read-only (including its canonical `assembleRequest` and the `./flows` `require`→`dist` mapping, both owned by Phase 0.5); the CLI makes no core edit, so no `@portiq/core` bump is needed here.
