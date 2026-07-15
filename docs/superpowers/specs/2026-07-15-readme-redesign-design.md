# README Redesign — Design

**Date:** 2026-07-15
**Status:** Approved
**Area:** `README.md` (single file)

## Problem

The current README is thorough but reads as a dense wall of feature-lists — a documentation dump rather than a landing page. It buries the value proposition, has a heavy 9-image screenshot grid, and contains concrete defects:

- Leaked local absolute paths: `README.md:474` (`/Users/ss/Documents/Commu/docs/mobile-packaging-plan.md`) and the Contributing links (`README.md:505-506`) render `/Users/ss/Documents/Portiq/...` as their link text.
- Inaccuracy: `README.md:493` references `src/App.jsx`, but the codebase uses `src/App.tsx`.

## Goal

Restructure `README.md` into a **polished, landing-page-style** document: a punchy hero, a scannable value proposition, and an emoji feature grid up top, with the exhaustive reference material folded into collapsible `<details>` sections so the top stays clean.

This is a **content/presentation change to a single markdown file** — no code, no build, no new assets. All referenced files already exist (verified): `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `LICENSE`, `docs/mobile-packaging-plan.md`, `src/assets/logo_bg.png`, and all nine screenshots under `src/assets/screenshots/`.

## Approved decisions

- **Direction:** polished landing page (exhaustive lists move into `<details>`).
- **Feature highlights:** emoji feature grid (2–3 column table, emoji + bold title + one-line description).
- **Screenshots:** hero workspace screenshot at top; a curated inline set of **DAG flow · GraphQL · AI panel** in the Screenshots section; the other five screenshots are dropped.
- **Badges:** keep the static tech/license/platform badges only (no dynamic/live repo badges), restyled for consistency.

## Structure

1. **Hero** (centered): logo → tagline **"The modern, AI-powered API client"** → one-line value prop → restyled static badge row (`MIT` · `Electron 30` · `React 18` · `Vite 5` · `macOS | Windows | Linux`) → wide workspace hero screenshot.
2. **Intro:** 2–3 sentences — open-source, local-first, multi-protocol desktop API client with built-in AI and Git-based sync; no account or backend required.
3. **✨ Highlights:** emoji feature grid (9 cells): Multi-protocol, DAG flows, AI-assisted, Collections, Environments, Response tools, Git-based sync, Scripts & tests, Local-first. This grid replaces the verbose "Functionality" link-list and doubles as the visual nav.
4. **🚀 Quick Start:** concise install/dev (+ Nix, native-rebuild note).
5. **📸 Screenshots:** curated inline set — DAG flow, GraphQL, AI panel (2-wide layout).
6. **Protocol Support:** keep the existing status table and its two caveat notes verbatim (GraphQL subscriptions; gRPC maturity).
7. **Features (deep reference):** each of the current exhaustive sections becomes a collapsible `<details>` block, content preserved: Request Building, Collections/Workspaces/History, Environments & Variables, Response Inspection & Data Tools, Scripts & Tests, AI Features, Import & Export, GitHub Sync (including the sync-layout directory tree), Settings, Local Storage & Data Paths.
8. **🛠️ Development:** prerequisites, install, run, useful scripts.
9. **📦 Packaging & Release:** collapsed `<details>` (long/detailed content preserved).
10. **🗂️ Repository Structure**, **🤝 Contributing**, **📄 License**.

## Bug fixes folded in

- Replace the three leaked `/Users/ss/...` absolute paths with repo-relative links: mobile plan → `docs/mobile-packaging-plan.md`; `[CONTRIBUTING.md](CONTRIBUTING.md)`; `[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)`.
- Fix `src/App.jsx` → `src/App.tsx` in Repository Structure.

## Scope & non-goals

- **In scope:** rewriting `README.md` per the structure above; no factual content is invented — feature descriptions are drawn from the existing README and verified against the codebase where practical.
- **Non-goals:** no new screenshots or asset generation, no dynamic badges, no changes to `CONTRIBUTING.md`/`CODE_OF_CONDUCT.md`, no code changes. The recently regenerated `portiq-dag.png` is reused as-is.

## Testing / verification

- All internal anchor links resolve to a heading that exists in the new document.
- All image and file paths point to files that exist in the repo.
- No absolute local filesystem paths remain.
- Rendered preview reads cleanly on GitHub (tables, `<details>`, centered blocks).
