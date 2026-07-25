const { safeStorage } = require("electron");
const core = require("@portiq/core");

/**
 * Electron safeStorage-backed encryptor (OS keychain: macOS Keychain / Windows
 * DPAPI / Linux libsecret when a keyring is present). When encryption is not
 * available (e.g. a headless Linux desktop without a keyring), `available` is
 * false and @portiq/core's resolveEncryptor falls back to the local keyfile.
 */
function createSafeStorageEncryptor() {
  const available = safeStorage.isEncryptionAvailable();
  return {
    available,
    encrypt(plaintext) {
      return core.tagCipher(safeStorage.encryptString(plaintext).toString("base64"));
    },
    decrypt(ciphertext) {
      return safeStorage.decryptString(Buffer.from(core.untagCipher(ciphertext), "base64"));
    },
  };
}

module.exports = { createSafeStorageEncryptor };
