---
"ai-api-client": minor
---

- Added persistent layout caching (sidebar widths, right rail collapse state, request splits) across app restarts using local storage.
- Overhauled the "Manage Environments" modal with a complete redesign: sleeker UI, inline hover tooltips for active variables, and horizontal variable fields (Key, Value, Comment).
- Fixed URL interpolation bug preventing valid routing when host ports were not followed by a trailing slash.
- Added full persistence for active unsaved workspace state (method, URL, headers, and body drafts are cached gracefully).
