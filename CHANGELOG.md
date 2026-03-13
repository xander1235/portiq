# ai-api-client

## 0.2.0

### Minor Changes

- f5b9967: Added CodeMirror edit-in-place Tooltips for inline Environment Variables interpolation inside Request Bodies.
- b8a5d50: Added GitHub Sync feature to backup and restore collections and environments to a GitHub gist. Added support for secret environment variables.
- 76e0358: - Added persistent layout caching (sidebar widths, right rail collapse state, request splits) across app restarts using local storage.
  - Overhauled the "Manage Environments" modal with a complete redesign: sleeker UI, inline hover tooltips for active variables, and horizontal variable fields (Key, Value, Comment).
  - Fixed URL interpolation bug preventing valid routing when host ports were not followed by a trailing slash.
  - Added full persistence for active unsaved workspace state (method, URL, headers, and body drafts are cached gracefully).

### Patch Changes

- 171fc8f: Updated README.md with comprehensive instructions for building native desktop versions of the app for macOS (Intel & Apple Silicon), Windows, and Linux via Electron Builder. Also included guidance on how to export for Website/Web App hosting, and outlined the workflow for creating iOS/Android apps via Capacitor or Cordova.
- ef777a7: Improved the open-source release docs with a clearer README focused on functionality, setup, settings, and GitHub sync. Refined response table tooling with path-based loading, wildcard expansion, and better derived-field error handling. Added HTTP body `none` mode, improved cURL import behavior, and fixed multipart handling for non-multipart requests.
- f80f544: - Redesigned dropdowns for Collections, Environments, Body Type, and Auth Type to use a premium, interactive custom UI component.
  - Implemented an interactive GitHub Sync Review screen to allow users to automatically detect and exclusively mask specific environment variables before pushing, securely substituting them with local placeholders on the remote repository.
  - Re-architected environments so "No Environment" is the default setting until explicitly toggled, preventing unforeseen interpolations.
  - Repositioned the GitHub Sync action button to the Top Navigation Bar for enhanced accessibility.
  - Refined the Request History UI into compact, card-structured elements with distinct margins and elevated hover states.
  - Removed legacy libsodium GitHub Actions Secrets encryption logic and replaced it with local symmetric placeholder mappings for enhanced stability and predictability.
- 0316271: Added FullScreenModal and native CodeMirror Command+F search functionality to both Request Editor and Response Viewer code components.
- 23f2251: Refined the find/replace experience in CodeMirror with a custom top-positioned search panel and improved automatic scrolling into view. Fixed a `TypeError` in the search plugin and improved character cursor alignment for the URL input. Enhanced AI model management with trimmed date-suffixes and a new "Test Connection" tool. Polished terminal logs and execution outputs for a cleaner UI.
- 89a6676: Unified variable interpolation highlighting across all input fields including URL, Table Editor (Headers, Query Params), and Authentication (Bearer, Basic, API Key).
