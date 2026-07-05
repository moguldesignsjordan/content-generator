import "server-only";
import { isEncryptedSecret } from "@/lib/crypto/secrets";
import type { Brand, BrandIntegration } from "@/lib/db/types";
import type { PublishProvider } from "./provider";

export type ConnectionState = "account" | "env" | "none";

export interface ConnectionDescription {
  /** Where the effective credentials come from, for the form banner. */
  state: ConnectionState;
  /** Plain field values (never secrets). */
  values: Record<string, string | string[]>;
  /** Per-secret "is a value stored?" booleans (values never decrypted). */
  secretIsSet: Record<string, boolean>;
}

/**
 * The single source of truth for what the Connections form shows for one
 * provider, used by both the settings page (initial render) and the
 * connections API route (after a save/disconnect). Plain field values come
 * back as-is; secrets are never decrypted here, only a boolean "is set".
 *
 * `state` is "account" when the brand's connection row has at least one set
 * value, else "env" when the provider is reachable via env fallback, else
 * "none".
 */
export function describeConnection(
  provider: PublishProvider,
  brand: Brand,
  integration: BrandIntegration | null,
): ConnectionDescription {
  const values: Record<string, string | string[]> = {};
  const secretIsSet: Record<string, boolean> = {};
  let hasAccountValue = false;

  for (const f of provider.fields) {
    const stored = integration?.config?.[f.key];
    if (f.secret) {
      const set = isEncryptedSecret(stored);
      secretIsSet[f.key] = set;
      if (set) hasAccountValue = true;
    } else if (f.list) {
      const arr = Array.isArray(stored)
        ? stored.filter((v): v is string => typeof v === "string")
        : [];
      values[f.key] = arr;
      if (arr.length) hasAccountValue = true;
    } else {
      const s = typeof stored === "string" ? stored : "";
      values[f.key] = s;
      if (s.trim()) hasAccountValue = true;
    }
  }

  const state: ConnectionState = hasAccountValue
    ? "account"
    : provider.isConfigured(brand, integration)
      ? "env"
      : "none";

  return { state, values, secretIsSet };
}
