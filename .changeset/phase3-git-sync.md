---
"@portiq/core": minor
---

Add @portiq/core/sync: headless GitHub-backed sync (serialization, secret
sanitize/restore, SyncRemote port with github + local-git remotes,
push/pull/status engine with optimistic store writes) and headless token
resolution. Renderer githubSync now delegates to core with no behavior change.
