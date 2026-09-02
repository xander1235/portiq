import type { Collection } from "./request";
import type { Environment } from "./environment";
import type { RequestResponse } from "./response";

/** A single history record. Stored separately from AppState (localStorage "ui_history"
 *  in the renderer); modeled here for CLI/MCP consumers. */
export interface HistoryEntry {
  timestamp: number;
  request: { protocol: string; [key: string]: any };
  response: RequestResponse;
}

/** The persisted app-state blob (SQLite kv row key "appState").
 *  Mirrors the payload literal built in src/App.tsx. `history` is NOT part of it. */
export interface AppState {
  collections: Collection[];
  activeCollectionId: string;
  environments: Environment[];
  activeEnvId: string | null;
  historyRetentionDays: number;
  // Flattened current-request draft + UI view state (optional; ignored headlessly).
  [key: string]: any;
}
