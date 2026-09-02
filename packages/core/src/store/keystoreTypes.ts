// Pure, browser-safe keystore contract. NO node: builtins or native addons —
// the renderer bundle imports this (via AiConfigOptions.encryptor). The Node-only
// implementation (AES-256-GCM keyfile) lives in ./keystore.ts.

export const ENC_PREFIX = "enc:v1:";

/** Symmetric encryptor injected per surface (desktop safeStorage / headless keyfile). */
export interface Encryptor {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
  /** false when no key source is available (e.g. Linux desktop without a keyring). */
  readonly available: boolean;
}

export function isEncrypted(s: string | null | undefined): boolean {
  return typeof s === "string" && s.startsWith(ENC_PREFIX);
}

export function tagCipher(payloadB64: string): string {
  return ENC_PREFIX + payloadB64;
}

export function untagCipher(tagged: string): string {
  if (!isEncrypted(tagged)) throw new Error("Value is not encrypted (missing enc:v1: tag)");
  return tagged.slice(ENC_PREFIX.length);
}
