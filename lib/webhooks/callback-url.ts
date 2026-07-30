import { randomBytes } from "node:crypto";

// Where a destination should POST its callbacks. Deliberately NOT
// `import "server-only"` (mirrors lib/crypto/secrets.ts): this is exercised by
// vitest, which `server-only` breaks. Nothing client-facing imports it.

/**
 * The app's public origin, or null when there isn't one. Null on a dev machine
 * is the normal case, not an error: localhost is unreachable from MailerLite,
 * so webhook registration is skipped and stats stay pull-only until deploy.
 *
 * PUBLIC_APP_URL wins so a custom domain (or an ngrok tunnel while testing
 * webhooks locally) can override Vercel's generated URL.
 */
export function publicAppOrigin(): string | null {
  const explicit = process.env.PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  // Vercel injects the production domain at build AND runtime; VERCEL_URL is
  // the per-deployment URL, which still beats nothing for preview deploys.
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  return null;
}

/**
 * A fresh, unguessable path segment identifying one brand's webhook endpoint.
 *
 * The token is what selects which brand's signing secret verifies a payload,
 * so it must be decided before any signature check can run. It is NOT the
 * auth: a leaked token still can't forge a delivery without the secret, and
 * the receiver re-checks that the resolved campaign belongs to the token's
 * brand.
 */
export function generateWebhookToken(): string {
  return randomBytes(24).toString("base64url");
}

/** The full callback URL for one provider + brand token. */
export function webhookCallbackUrl(
  providerId: string,
  token: string,
): string | null {
  const origin = publicAppOrigin();
  if (!origin) return null;
  return `${origin}/api/webhooks/${providerId}/${token}`;
}
