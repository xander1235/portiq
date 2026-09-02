// Regenerate src/version.ts SERVER_VERSION from this package's package.json.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
const src = `export const SERVER_NAME = "portiq-mcp";\nexport const SERVER_VERSION = "${pkg.version}";\n`;
writeFileSync(join(here, "..", "src", "version.ts"), src);
