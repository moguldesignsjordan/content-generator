import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM encryption for publishing credentials stored in the
// brand_integrations table (MailerLite API keys, Sanity write tokens). The
// key lives in env (INTEGRATION_ENCRYPTION_KEY, 32 bytes base64); the
// ciphertext at rest is self-describing and rotatable:
//   "gcm:v1:<ivB64>:<tagB64>:<ctB64>"
//
// Deliberately NOT `import "server-only"` (mirrors lib/email/hero-image.ts):
// this module is exercised by vitest, and `server-only` breaks under the test
// runner. The boundary holds anyway — the only callers are themselves
// server-only (lib/publishing/credentials.ts and the connections API route),
// nothing client-facing imports `lib/crypto/*`, and the `node:crypto` import
// itself fails any accidental client bundle. Read the key lazily inside each
// function so brands with zero connections never touch it, and a missing key
// only matters the instant a secret is actually read or written.

const FORMAT_TAG = "gcm:v1";

function readKey(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY is not set. Generate one with " +
        "`openssl rand -base64 32` and add it to .env.local.",
    );
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is not valid base64.");
  }
  if (buf.length !== 32) {
    throw new Error(
      `INTEGRATION_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}). ` +
        "Regenerate with `openssl rand -base64 32`.",
    );
  }
  return buf;
}

/** True when a stored value looks like our ciphertext format. */
export function isEncryptedSecret(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Format splits into 5 parts: "gcm", "v1", iv, tag, ct.
  const parts = value.split(":");
  return parts.length === 5 && parts[0] === "gcm" && parts[1] === "v1";
}

export function encryptSecret(plaintext: string): string {
  const key = readKey();
  const iv = randomBytes(12); // 96-bit nonce is the GCM standard
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_TAG, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(ciphertext: string): string {
  if (!isEncryptedSecret(ciphertext)) {
    throw new Error("Encrypted secret has an unrecognized format.");
  }
  // Skip the "gcm" / "v1" prefix parts.
  const [, , ivB64, tagB64, ctB64] = ciphertext.split(":");
  const key = readKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}
