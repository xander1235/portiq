export type ExternalReloadAction = "reload" | "prompt";

/**
 * Decide how to react to an external appState write detected by the main
 * process (delivered via window.api.onExternalStateChange).
 *
 * - "reload": no autosave is pending, so in-memory state already matches disk —
 *   silently pick up the newer external state.
 * - "prompt": the user has un-persisted local edits (an autosave is armed);
 *   reloading now would clobber them, so surface a non-destructive prompt.
 */
export function computeExternalReloadAction(args: { hasPendingLocalEdits: boolean }): ExternalReloadAction {
  return args.hasPendingLocalEdits ? "prompt" : "reload";
}
