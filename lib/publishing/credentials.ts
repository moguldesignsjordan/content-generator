import "server-only";
import { decryptSecret, isEncryptedSecret } from "@/lib/crypto/secrets";
import type { BrandIntegration } from "@/lib/db/types";

// Shared, low-level credential resolution used by every provider. Per-field
// env fallback is the point: a connected provider with one blank secret still
// works if the env var fills it, so a partial connection degrades gracefully
// instead of failing. Full per-provider config assembly (which fields, which
// env vars, which brand-column legacy values) stays in each provider/client
// file; this module only knows how to read one field safely.

/**
 * Resolves a secret field: the brand's stored (encrypted) value if set, else
 * the named env var. Returns undefined when neither source has it.
 */
export function resolveSecret(
  integration: BrandIntegration | null,
  key: string,
  envVar: string,
): string | undefined {
  const stored = integration?.config?.[key];
  if (isEncryptedSecret(stored)) {
    return decryptSecret(stored);
  }
  return process.env[envVar];
}

/**
 * Resolves a plain (non-secret) field: the brand's stored value if set, else a
 * caller-supplied fallback. The fallback is whatever the caller passes — an
 * env-var value, a brand-column legacy value, or a hard-coded default.
 */
export function resolvePlain<T = string>(
  integration: BrandIntegration | null,
  key: string,
  fallback?: T,
): T | undefined {
  const v = integration?.config?.[key];
  if (v !== undefined && v !== null && v !== "") return v as T;
  return fallback;
}
