---
"@portiq/core": minor
---

Add a Node-only state-change watcher to `@portiq/core`: `StateChangeDetector`
(kv-version comparison + self-write suppression) and `watchStateFile`
(`fs.watch` + fallback poll). The Electron desktop app uses these to detect
`appdata.sqlite` writes from other processes (CLI/MCP or a second instance) and
live-reload `appState`, prompting non-destructively when the user has unsaved
local edits.
