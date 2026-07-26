import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, statSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const BUNDLE = resolve(__dirname, "..", "..", "dist", "portiq.bundle.cjs");

describe("portiq.bundle.cjs", () => {
  beforeAll(() => {
    // The bundle is produced by `npm --workspace @portiq/cli run bundle`,
    // which the root `pretest` chain (build:cli) does NOT run — build it here.
    execFileSync("npm", ["--workspace", "@portiq/cli", "run", "bundle"], {
      cwd: resolve(__dirname, "..", "..", "..", ".."),
      stdio: "inherit",
      shell: true, // Windows resolves `npm` -> `npm.cmd` only through a shell.
    });
  });

  it("exists and is an executable single file with a node shebang", () => {
    expect(existsSync(BUNDLE)).toBe(true);
    const first = readFileSync(BUNDLE, "utf8").slice(0, 20);
    expect(first.startsWith("#!/usr/bin/env node")).toBe(true);
    // Windows has no Unix execute bits (exec goes through the npm .cmd shim /
    // NSIS launcher), so only assert the execute bit on POSIX.
    if (process.platform !== "win32") {
      expect(statSync(BUNDLE).mode & 0o111).toBeTruthy(); // any execute bit set
    }
  });

  it("runs `where` against a temp data dir with @portiq/core inlined (no module-not-found)", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "portiq-bundle-"));
    const out = execFileSync(process.execPath, [BUNDLE, "where", "--data-dir", dataDir], {
      encoding: "utf8",
    });
    // Assert on the separator-free temp-dir basename: the `where` output is JSON,
    // and on Windows the full path's backslashes get escaped (\\), so a
    // full-path substring match would spuriously fail.
    expect(out).toContain(basename(dataDir));
  });
});
