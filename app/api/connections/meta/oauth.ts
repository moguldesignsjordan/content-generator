import { randomBytes, timingSafeEqual } from "node:crypto";

// Shared by the start and callback routes (route files may only export
// handlers). The redirect URI is built from the request's own origin so
// localhost and production each match the URI registered in the Meta app.

export const STATE_COOKIE = "meta_oauth_state";
export const CALLBACK_PATH = "/api/connections/meta/callback";

export function redirectUri(origin: string): string {
  return `${origin}${CALLBACK_PATH}`;
}

export function newState(): string {
  return randomBytes(24).toString("base64url");
}

/** Constant-time compare of the returned state against the cookie copy. */
export function statesMatch(expected: string | undefined, actual: string | null): boolean {
  if (!expected || !actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}
