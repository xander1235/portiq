# Portiq

## 0.6.1

### Patch Changes

- Fixed macOS downloads failing to open with a "damaged / can't be opened" error. The release build now ad-hoc signs the macOS app (hardened runtime + entitlements) so arm64 binaries launch after download. The build is not notarized, so the first launch is via right-click → Open (or clearing the download quarantine).
- Bumped CI/release GitHub Actions (`checkout`, `setup-node`) to v5 for the Node 24 runtime, clearing the Node 20 deprecation warning.

### Other

- Relicensed the project from MIT to AGPL-3.0.
- Refreshed the website/landing-page docs.

## 0.6.0

### Minor Changes

- Paste a cURL command into the request URL bar to build the current request: a confirmation dialog previews the parsed method, URL, query params, headers, body, and auth, and can fill undefined `{{variables}}` or parameterize literals that match existing environment values before importing. `@file` references become visible placeholders. The same parser now also backs the "Import from cURL" new-request flow, fixing a bug where it produced empty requests.
- Added a Tests tab with grouped test suites and a Visualize tab that renders SVG visualizations from response data.
- Introduced named script steps for pre/post request scripts and a more compact request toolbar.

### Patch Changes

- cURL import preserves `{{templates}}` in the URL path, keeps `=` inside header/form/query values, keeps raw environment templates in headers so they resolve at send time, and preserves URL fragments.

## 0.5.0

### Minor Changes

- Redesigned the request panel and introduced full light and dark theming, with a refreshed request/response layout and consistent theming across the app.

### Patch Changes

- Improved DAG editor performance — the graph is no longer rewritten on every drag frame, and node components are memoized for smoother panning and editing.
- Platform and dependency upgrades: React 19, Electron 41, Vite 8, TypeScript 6, and ESLint 10. Migrated from `@xenova/transformers` to `@huggingface/transformers`, clearing 4 npm audit advisories.

## 0.4.0

### Minor Changes

- Redesigned the DAG flow with a reference-first data model on a react-flow canvas, and added editing and execution controls for building and running request graphs.

### Patch Changes

- Added variable-aware secret masking, fixed request-name synchronization, refreshed the README, and added desktop build scripting.

## 0.3.2

### Patch Changes

- Add release maintainer metadata so Linux desktop packages can be generated successfully in CI.

## 0.3.1

### Patch Changes

- Improve the DAG workflow workspace, add JavaScript-aware DAG logic editors, and automate desktop release artifact generation.

## 0.3.0

### Minor Changes

- 1e13a84: Rebranded the application from Commu to Portiq.
  Fixed GitHub OAuth login issues in packaged production (DMG) builds.
  Removed legacy secret placeholders and updated security prefixes.
  Improved cross-environment request handling with a shared safeFetch utility.

## 0.2.2

### Patch Changes

- Completed the Portiq rebrand by updating remaining internal identifiers, repository-facing metadata, and documentation naming. Renamed the GitHub repository from `commu` to `portiq` and aligned release-facing branding with the new product name.

## 0.2.1

### Patch Changes

- Improved GitHub sync so request auth secrets are replaced with placeholders during sync and restored from local values on pull when available. Added background push and pull behavior with top-bar sync status feedback instead of blocking the sync modal.

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
