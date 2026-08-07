// electron-builder afterPack hook: emit PATH launcher scripts into Resources/bin.
const fs = require("fs");
const path = require("path");

/** @param {{ appOutDir: string, electronPlatformName: string, packager: any }} context */
exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const exeName = packager.executableName || "Portiq";

  // Resolve Resources/bin and the app executable per platform.
  let resourcesBin;
  let launchers; // { name, contents }[]
  if (electronPlatformName === "darwin" || electronPlatformName === "mas") {
    const appDir = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
    resourcesBin = path.join(appDir, "Contents", "Resources", "bin");
    const exeRel = `../../MacOS/${exeName}`;
    const nodePathRel = `../app.asar.unpacked/node_modules`;
    launchers = shLaunchers(exeRel, nodePathRel);
  } else if (electronPlatformName === "linux") {
    resourcesBin = path.join(appOutDir, "resources", "bin");
    const exeRel = `../../${exeName}`;
    const nodePathRel = `../app.asar.unpacked/node_modules`;
    launchers = shLaunchers(exeRel, nodePathRel);
  } else {
    // win32
    resourcesBin = path.join(appOutDir, "resources", "bin");
    const exeRel = `..\\..\\${exeName}.exe`;
    const nodePathRel = `..\\app.asar.unpacked\\node_modules`;
    launchers = cmdLaunchers(exeRel, nodePathRel);
  }

  fs.mkdirSync(resourcesBin, { recursive: true });
  for (const { name, contents, exec } of launchers) {
    const p = path.join(resourcesBin, name);
    fs.writeFileSync(p, contents);
    if (exec) fs.chmodSync(p, 0o755);
  }
};

// POSIX-only: resolve the real directory of `$0` so the launcher keeps working
// when it is reached through a symlink (e.g. `/usr/bin/portiq` → the app's
// Resources/bin). Without this, `dirname $0` would be `/usr/bin` and the
// relative references to the bundle / node_modules would break.
const SYMLINK_BOOTSTRAP = `
PRG="$0"
while [ -h "$PRG" ]; do
  ls="$(ls -ld "$PRG")"
  link="$(expr "$ls" : '.*-> \\(.*\\)$')"
  case "$link" in
    /*) PRG="$link" ;;
    *) PRG="$(dirname "$PRG")/$link" ;;
  esac
done
DIR="$(cd "$(dirname "$PRG")" && pwd)"
`;

function shLaunchers(exeRel, nodePathRel) {
  const body = (bundle) =>
    `#!/bin/sh\n` +
    SYMLINK_BOOTSTRAP +
    `export ELECTRON_RUN_AS_NODE=1\n` +
    `export NODE_PATH="$DIR/${nodePathRel}"\n` +
    `exec "$DIR/${exeRel}" "$DIR/${bundle}" "$@"\n`;
  return [
    { name: "portiq", contents: body("portiq.bundle.cjs"), exec: true },
    { name: "portiq-mcp", contents: body("portiq-mcp.bundle.cjs"), exec: true },
  ];
}

function cmdLaunchers(exeRel, nodePathRel) {
  const body = (bundle) =>
    `@echo off\r\n` +
    `set "ELECTRON_RUN_AS_NODE=1"\r\n` +
    `set "NODE_PATH=%~dp0${nodePathRel}"\r\n` +
    `"%~dp0${exeRel}" "%~dp0${bundle}" %*\r\n`;
  return [
    { name: "portiq.cmd", contents: body("portiq.bundle.cjs"), exec: false },
    { name: "portiq-mcp.cmd", contents: body("portiq-mcp.bundle.cjs"), exec: false },
  ];
}

exports.shLaunchers = shLaunchers;
exports.cmdLaunchers = cmdLaunchers;
