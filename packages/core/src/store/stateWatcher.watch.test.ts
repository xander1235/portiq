import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, type FSWatcher } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKvStore } from "./kvStore";
import { resolveDbPath } from "./dataDir";
import { StateChangeDetector, watchStateFile } from "./stateWatcher";

// Controllable stand-in for node:fs's `watch`, used only by the async-error
// test below. Spreads the real module so every other test (and kvStore's own
// mkdirSync usage) keeps working against the real filesystem.
const { watchMock } = vi.hoisted(() => ({ watchMock: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  // Default to the real implementation so every test other than the
  // async-error one below runs against the actual filesystem watcher.
  watchMock.mockImplementation(actual.watch);
  return { ...actual, watch: watchMock };
});

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "portiq-watch-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("watchStateFile", () => {
  it("fires onExternalChange when a second connection writes appState", async () => {
    const dir = tempDir();
    const main = openKvStore({ dataDir: dir }); // the "desktop app" connection
    const seen: number[] = [];
    const detector = new StateChangeDetector({
      readVersion: () => main.getVersioned("appState").version,
      onExternalChange: (v) => seen.push(v),
      initialVersion: 0,
    });
    const handle = watchStateFile({
      dbPath: resolveDbPath({ dataDir: dir }),
      detector,
      debounceMs: 10,
      pollMs: 20,
    });

    // Simulate an EXTERNAL process (CLI/MCP) writing via a separate connection.
    const external = openKvStore({ dataDir: dir });
    external.set("appState", JSON.stringify({ collections: [] }));
    external.close();

    await new Promise((r) => setTimeout(r, 150)); // allow watch/poll + debounce
    handle.close();
    main.close();

    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it("does NOT fire for the main connection's own writes", async () => {
    const dir = tempDir();
    const main = openKvStore({ dataDir: dir });
    const seen: number[] = [];
    const detector = new StateChangeDetector({
      readVersion: () => main.getVersioned("appState").version,
      onExternalChange: (v) => seen.push(v),
      initialVersion: 0,
    });
    const handle = watchStateFile({
      dbPath: resolveDbPath({ dataDir: dir }),
      detector,
      debounceMs: 10,
      pollMs: 20,
    });

    const version = main.set("appState", JSON.stringify({ collections: [] }));
    detector.noteLocalWrite(version); // main process records its own write

    await new Promise((r) => setTimeout(r, 150));
    handle.close();
    main.close();

    expect(seen).toEqual([]);
  });

  it("degrades to poll-only when the fs watcher emits an async 'error' (does not crash)", async () => {
    const dir = tempDir();
    const main = openKvStore({ dataDir: dir });
    const seen: number[] = [];
    const detector = new StateChangeDetector({
      readVersion: () => main.getVersioned("appState").version,
      onExternalChange: (v) => seen.push(v),
      initialVersion: 0,
    });

    // Fake FSWatcher: a plain EventEmitter with a `close`, exactly the shape
    // watchStateFile relies on. We fully control when 'error' fires.
    const fakeWatcher = new EventEmitter() as EventEmitter & Pick<FSWatcher, "close">;
    fakeWatcher.close = vi.fn();
    watchMock.mockImplementationOnce(() => fakeWatcher as unknown as FSWatcher);

    const handle = watchStateFile({
      dbPath: resolveDbPath({ dataDir: dir }),
      detector,
      debounceMs: 10,
      pollMs: 20,
    });

    // Node's EventEmitter throws synchronously, in-place, when an 'error'
    // event has no listener attached. Without watchStateFile's fix this line
    // throws (and, on a real FSWatcher with no handler, would surface as an
    // uncaught exception that crashes the Electron main process).
    expect(() => fakeWatcher.emit("error", new Error("boom"))).not.toThrow();
    expect(fakeWatcher.close).toHaveBeenCalled();

    // Detection must still work afterwards via the poll fallback, proving
    // the degrade-to-poll-only path (not just "didn't crash").
    const external = openKvStore({ dataDir: dir });
    external.set("appState", JSON.stringify({ collections: [] }));
    external.close();

    await new Promise((r) => setTimeout(r, 150));
    handle.close();
    main.close();

    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[seen.length - 1]).toBe(1);
  });
});
