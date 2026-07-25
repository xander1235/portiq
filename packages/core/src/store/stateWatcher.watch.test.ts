import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKvStore } from "./kvStore";
import { resolveDbPath } from "./dataDir";
import { StateChangeDetector, watchStateFile } from "./stateWatcher";

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
});
