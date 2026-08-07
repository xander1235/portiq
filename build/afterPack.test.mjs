import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import afterPackPkg from "./afterPack.cjs";

const { shLaunchers, cmdLaunchers } = afterPackPkg;

describe("afterPack launchers", () => {
  it("emits the expected launcher file names and executable bits", () => {
    const sh = shLaunchers("../../MacOS/Portiq", "../app.asar.unpacked/node_modules");
    expect(sh.map((l) => l.name)).toEqual(["portiq", "portiq-mcp"]);
    expect(sh.every((l) => l.exec === true)).toBe(true);
    const cmd = cmdLaunchers("..\\..\\Portiq.exe", "..\\app.asar.unpacked\\node_modules");
    expect(cmd.map((l) => l.name)).toEqual(["portiq.cmd", "portiq-mcp.cmd"]);
    expect(cmd.every((l) => l.exec === false)).toBe(true);
  });

  it("runs correctly when invoked through a symlink (linux /usr/bin shim)", () => {
    // Simulate the packaged layout: Resources/bin holds the launcher, the
    // bundle, and a stub "electron" executable. A symlink in another directory
    // mimics `/usr/bin/portiq -> /opt/Portiq/resources/bin/portiq`.
    const base = mkdtempSync(join(tmpdir(), "portiq-afterpack-"));
    try {
      const binDir = join(base, "opt", "Portiq", "resources", "bin");
      const linkDir = join(base, "usr", "bin");
      mkdirSync(binDir, { recursive: true });
      mkdirSync(linkDir, { recursive: true });

      const [launcher] = shLaunchers("../../MacOS/Portiq", "../app.asar.unpacked/node_modules");
      const launcherPath = join(binDir, launcher.name);
      writeFileSync(launcherPath, launcher.contents);
      chmodSync(launcherPath, 0o755);

      // Stub bundle + a stub electron that prints the resolved location. The
      // electron lives at Contents/MacOS/Portiq, two levels above resources/bin.
      writeFileSync(join(binDir, "portiq.bundle.cjs"), "// stub");
      const macosDir = join(binDir, "..", "..", "MacOS");
      mkdirSync(macosDir, { recursive: true });
      writeFileSync(join(macosDir, "Portiq"), "#!/bin/sh\necho \"DIR=$DIR NODE_PATH=$NODE_PATH bundle=$1 arg=$2\"\n");
      chmodSync(join(macosDir, "Portiq"), 0o755);

      const linkPath = join(linkDir, "portiq");
      symlinkSync(launcherPath, linkPath);

      const out = execFileSync(linkPath, ["hello"], { encoding: "utf8" });
      // NODE_PATH and the bundle path must resolve from the REAL launcher dir
      // (the app's Resources/bin), not the symlink's directory (/usr/bin).
      expect(out).toContain(`NODE_PATH=${binDir}/../app.asar.unpacked/node_modules`);
      expect(out).toContain("bundle=" + join(binDir, "portiq.bundle.cjs"));
      expect(out).toContain("arg=hello");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("keeps the MacOS/Windows relative paths intact", () => {
    const [sh] = shLaunchers("../../MacOS/Portiq", "../app.asar.unpacked/node_modules");
    expect(sh.contents).toContain('exec "$DIR/../../MacOS/Portiq" "$DIR/portiq.bundle.cjs" "$@"');
    const [cmd] = cmdLaunchers("..\\..\\Portiq.exe", "..\\app.asar.unpacked\\node_modules");
    expect(cmd.contents).toContain('"%~dp0..\\..\\Portiq.exe" "%~dp0portiq.bundle.cjs" %*');
  });
});
