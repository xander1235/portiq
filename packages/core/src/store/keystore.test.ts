import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createLocalEncryptor, KEYSTORE_FILE } from "./keystore";
import { isEncrypted } from "./keystoreTypes";

const dirs: string[] = [];
function tempDir(): string { const d = mkdtempSync(join(tmpdir(), "portiq-ks-")); dirs.push(d); return d; }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("createLocalEncryptor", () => {
  it("round-trips and produces a tagged, non-plaintext ciphertext", () => {
    const enc = createLocalEncryptor({ dataDir: tempDir() });
    const c = enc.encrypt("sk-secret-123");
    expect(isEncrypted(c)).toBe(true);
    expect(c).not.toContain("sk-secret-123");
    expect(enc.decrypt(c)).toBe("sk-secret-123");
    expect(enc.available).toBe(true);
  });

  it("generates a keyfile with 0600 perms and reuses it across instances", () => {
    const dir = tempDir();
    const a = createLocalEncryptor({ dataDir: dir });
    const c = a.encrypt("value");
    const keyPath = join(dir, KEYSTORE_FILE);
    expect(existsSync(keyPath)).toBe(true);
    if (platform() !== "win32") {
      expect((statSync(keyPath).mode & 0o777).toString(8)).toBe("600");
    }
    const b = createLocalEncryptor({ dataDir: dir }); // reads the same keyfile
    expect(b.decrypt(c)).toBe("value");
  });

  it("honors PORTIQ_KEYSTORE_KEY (base64) without touching a keyfile", () => {
    const dir = tempDir();
    const keyB64 = randomBytes(32).toString("base64");
    const enc = createLocalEncryptor({ dataDir: dir, env: { PORTIQ_KEYSTORE_KEY: keyB64 } });
    const c = enc.encrypt("x");
    expect(existsSync(join(dir, KEYSTORE_FILE))).toBe(false);
    expect(enc.decrypt(c)).toBe("x");
  });

  it("throws on a tampered ciphertext (GCM auth failure)", () => {
    const enc = createLocalEncryptor({ dataDir: tempDir() });
    const c = enc.encrypt("data");
    const mid = Math.floor(c.length / 2);
    const flipped = c[mid] === "A" ? "B" : "A";
    const tampered = c.slice(0, mid) + flipped + c.slice(mid + 1);
    expect(() => enc.decrypt(tampered)).toThrow();
  });
});
