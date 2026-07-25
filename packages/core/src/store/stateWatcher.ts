// @portiq/core state-change watcher (Node-only: uses node:fs `watch`).
//
// Detects appState writes made by OTHER processes (CLI/MCP or a second app
// instance) so the desktop app can live-reload. External-vs-self is decided by
// the kv `version` (monotonic, bumped by every set/setIfVersion — see
// kvStore.ts:38-50), NOT by fs event heuristics: the main process records every
// version it writes itself (noteLocalWrite) so its own saves are never
// re-broadcast. `fs.watch` only wakes the detector cheaply; a low-frequency
// poll covers WAL writes/checkpoints fs.watch may miss.
//
// Framework-free: exported from the Node barrel (src/index.ts) ONLY. NEVER add
// to src/index.browser.ts — node:fs is not renderer-safe.
import { watch, type FSWatcher } from "node:fs";
import { dirname, basename } from "node:path";

export interface StateChangeDetectorOptions {
  /** Reads the current on-disk version of the watched key
   *  (e.g. () => kv.getVersioned("appState").version). */
  readVersion: () => number;
  /** Invoked once per detected EXTERNAL advance, with the new version. */
  onExternalChange: (version: number) => void;
  /** Seed for last-known version (defaults to a single readVersion() call). */
  initialVersion?: number;
}

/**
 * Pure version-comparison state machine — no timers, no fs, fully unit-testable
 * with an injected readVersion. `check()` fires onExternalChange only when the
 * on-disk version has advanced past every version this process wrote itself.
 */
export class StateChangeDetector {
  private lastKnownVersion: number;

  constructor(private readonly opts: StateChangeDetectorOptions) {
    this.lastKnownVersion = opts.initialVersion ?? opts.readVersion();
  }

  /** Record a write THIS process just performed so it is not re-broadcast. */
  noteLocalWrite(version: number): void {
    if (version > this.lastKnownVersion) this.lastKnownVersion = version;
  }

  /** Re-sync after a local clear() (kv_version reset to 0). */
  reset(version = 0): void {
    this.lastKnownVersion = version;
  }

  /** Compare on-disk version to last-known; fire onExternalChange on advance. */
  check(): void {
    const current = this.opts.readVersion();
    if (current > this.lastKnownVersion) {
      this.lastKnownVersion = current;
      this.opts.onExternalChange(current);
    }
  }

  get version(): number {
    return this.lastKnownVersion;
  }
}

/** Trailing-edge debounce over the global timer functions. */
export function debounce(fn: () => void, waitMs: number): (() => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, waitMs);
  };
  debounced.cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return debounced;
}
