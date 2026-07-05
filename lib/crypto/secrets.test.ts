import { beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secrets";

describe("secrets (AES-256-GCM)", () => {
  beforeAll(() => {
    // 32-byte key, base64. The module reads it lazily inside each call.
    process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("round-trips a secret through encrypt → decrypt", () => {
    const plaintext = "ml-secret-sk-abc-123";
    const ciphertext = encryptSecret(plaintext);

    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext.startsWith("gcm:v1:")).toBe(true);
    expect(isEncryptedSecret(ciphertext)).toBe(true);
    expect(decryptSecret(ciphertext)).toBe(plaintext);
  });

  it("uses a fresh IV every call, so ciphertexts differ", () => {
    expect(encryptSecret("same-value")).not.toBe(encryptSecret("same-value"));
  });

  it("round-trips unicode and symbols a token might contain", () => {
    const plaintext = "p@ss-Φ_β·token/with-bits";
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });
});
