# Architecture – Electron + React

## Overview
The app uses Electron for the desktop shell, a React renderer for UI, and a thin local data store. AI calls are routed through a service layer that can target local or remote LLM providers.

## High‑Level Components
- Electron Main Process
  - App lifecycle
  - Window creation
  - Secure IPC bridge
- Preload
  - Exposes safe APIs to renderer
- Renderer (React)
  - Request editor
  - Response viewer
  - AI panel
  - Table explorer
- Services
  - HTTP client
  - AI client
  - Test generator
  - Format converters
- Storage
  - Local JSON or SQLite (future)

## Data Flow
1. User builds request
2. Renderer calls HTTP service
3. Response is stored in history
4. Renderer updates views
5. Optional AI summaries/tests run async

## Security Model
- Context isolation enabled
- No Node APIs in renderer
- IPC exposes only whitelisted methods
- AI calls opt‑in and configurable

## AI Integration
- Provider abstraction: OpenAI / local
- Prompts include request context, response, and user intent
- Redaction layer for secrets (optional)

## Format Converters
- JSON ⇄ XML
- JSON ⇄ CSV
- Table view uses JSON array of objects

## Suggested Folder Structure
- electron/
  - main.cjs
  - preload.cjs
- src/
  - App.jsx
  - components/
  - services/
  - styles.css
- docs/

## IPC Contracts (initial)
- `http:sendRequest` -> { request } -> { response }
- `ai:generateRequest` -> { prompt, context } -> { requestDraft }
- `ai:generateTests` -> { request, response } -> { tests }
- `ai:summarizeResponse` -> { response } -> { summary, hints }
