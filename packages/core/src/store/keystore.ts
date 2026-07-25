// Node-only headless encryptor. Uses node:crypto + node:fs, so it MUST stay off
// the browser barrels (exported only from ./index.ts, never ./index.browser.ts).
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { resolveDataDir, type ResolveDataDirOptions } from "./dataDir";
import { tagCipher, untagCipher, type Encryptor } from "./keystoreTypes";

export const KEYSTORE_FILE = "keystore.key";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

export interface LocalEncryptorOptions extends ResolveDataDirOptions {
  /** Inject a 32-byte key directly (tests). */
  key?: Buffer;
}

function parseEnvKey(raw: string): Buffer | null {
  const b64 = Buffer.from(raw, "base64");
  if (b64.length === 32) return b64;
  const hex = /^[0-9a-fA-F]{64}$/.test(raw.trim()) ? Buffer.from(raw.trim(), "hex") : null;
  return hex && hex.length === 32 ? hex : null;
}

function resolveKey(opts: LocalEncryptorOptions): Buffer {
  if (opts.key) return opts.key;
  const env = opts.env ?? process.env;
  if (env.PORTIQ_KEYSTORE_KEY) {
    const parsed = parseEnvKey(env.PORTIQ_KEYSTORE_KEY);
    if (parsed) return parsed;
    throw new Error("PORTIQ_KEYSTORE_KEY must be 32 bytes (base64 or hex)");
  }
  const dir = resolveDataDir(opts);
  mkdirSync(dir, { recursive: true });
  const keyPath = join(dir, KEYSTORE_FILE);
  if (existsSync(keyPath)) return Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString("base64"), { encoding: "utf8", mode: 0o600 });
  try { chmodSync(keyPath, 0o600); } catch { /* best-effort on non-POSIX */ }
  return key;
}

export function createLocalEncryptor(opts: LocalEncryptorOptions = {}): Encryptor {
  const key = resolveKey(opts);
  return {
    available: true,
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_LEN);
      const cipher = createCipheriv(ALGO, key, iv);
      const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return tagCipher(Buffer.concat([iv, tag, enc]).toString("base64"));
    },
    decrypt(ciphertext: string): string {
      const buf = Buffer.from(untagCipher(ciphertext), "base64");
      const iv = buf.subarray(0, IV_LEN);
      const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
      const data = buf.subarray(IV_LEN + TAG_LEN);
      const decipher = createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    },
  };
}
