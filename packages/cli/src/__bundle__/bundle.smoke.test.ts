import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, statSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BUNDLE = resolve(__dirname, "..", "..", "dist", "portiq.bundle.cjs");

describe("portiq.bundle.cjs", () => {
  beforeAll(() => {
    // The bundle is produced by `npm --workspace @portiq/cli run bundle`,
    // which the root `pretest` chain (build:cli) does NOT run — build it here.
    execFileSync("npm", ["--workspace", "@portiq/cli", "run", "bundle"], {
      cwd: resolve(__dirname, "..", "..", "..", ".."),
      stdio: "inherit",
    });
  });

  it("exists and is an executable single file with a node shebang", () => {
    expect(existsSync(BUNDLE)).toBe(true);
    const mode = statSync(BUNDLE).mode;
    expect(mode & 0o111).toBeTruthy(); // any execute bit set
    const first = readFileSync(BUNDLE, "utf8").slice(0, 20);
    expect(first.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("runs `where` against a temp data dir with @portiq/core inlined (no module-not-found)", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "portiq-bundle-"));
    const out = execFileSync(process.execPath, [BUNDLE, "where", "--data-dir", dataDir], {
      encoding: "utf8",
    });
    expect(out).toContain(dataDir);
  });
});
