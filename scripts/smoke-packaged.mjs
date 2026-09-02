// Packaged-build smoke: proves @portiq/core (incl. sync/grpc/flows dist) is bundled
// into app.asar and requireable via the packaged Electron binary run as Node.
// Assumes `electron-builder --dir` has produced an unpacked app under release/.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";

const ASAR = join("node_modules", ".bin", "asar");

// Locate the unpacked app dir + its app.asar + the Electron executable per-OS.
function layout() {
  const p = platform();
  if (p === "darwin") {
    const app = join("release", process.arch === "arm64" ? "mac-arm64" : "mac", "Portiq.app");
    return {
      asar: join(app, "Contents", "Resources", "app.asar"),
      exe: join(app, "Contents", "MacOS", "Portiq"),
    };
  }
  if (p === "win32") {
    return {
      asar: join("release", "win-unpacked", "resources", "app.asar"),
      exe: join("release", "win-unpacked", "Portiq.exe"),
    };
  }
  return {
    asar: join("release", "linux-unpacked", "resources", "app.asar"),
    exe: join("release", "linux-unpacked", "portiq"),
  };
}

const { asar, exe } = layout();
if (!existsSync(asar)) {
  console.error(`smoke: app.asar not found at ${asar}. Run an electron-builder --dir build first.`);
  process.exit(1);
}

// 1) Assert the core dist subpaths the app requires at runtime are inside the asar.
const listing = execFileSync(process.execPath, [ASAR, "list", asar], { encoding: "utf8" });
const required = [
  "node_modules/@portiq/core/dist/index.js",
  "node_modules/@portiq/core/dist/sync/index.cjs",
  "node_modules/@portiq/core/dist/transport/grpc.js",
  "node_modules/@portiq/core/dist/flows/index.js",
];
const missing = required.filter((f) => !listing.includes(f));
if (missing.length) {
  console.error("smoke: MISSING from app.asar:\n" + missing.join("\n"));
  process.exit(1);
}
console.log("smoke: core dist subpaths present in app.asar");

// 2) Require core through the packaged Electron binary run as plain Node,
//    proving the runtime resolution main.cjs relies on (main.cjs:4-9) works.
const probe =
  "const c=require('@portiq/core');" +
  "const g=require('@portiq/core/grpc');" +
  "require('@portiq/core/sync');" +
  "if(typeof c.resolveDataDir!=='function')throw new Error('resolveDataDir missing');" +
  "if(typeof g.GrpcTransport!=='function')throw new Error('GrpcTransport missing');" +
  "console.log('smoke: require @portiq/core + /grpc + /sync OK');";
execFileSync(exe, ["-e", probe], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});

// 3) Run the generated PATH launcher and assert it prints a version.
const binDir = join(
  asar.replace(/app\.asar$/, ""), // .../Resources/ or .../resources/
  "bin",
);
const launcher = platform() === "win32" ? join(binDir, "portiq.cmd") : join(binDir, "portiq");
const ver = execFileSync(launcher, ["--version"], { encoding: "utf8" }).trim();
if (!/\d+\.\d+\.\d+/.test(ver)) {
  console.error(`smoke: launcher --version returned unexpected output: ${ver}`);
  process.exit(1);
}
console.log(`smoke: PATH launcher OK (portiq --version -> ${ver})`);
