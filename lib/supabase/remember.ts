import type { CookieOptions } from "@supabase/ssr";

/** Non-httpOnly cookie holding the user's "remember me" choice from /login. */
export const REMEMBER_COOKIE = "remember_me";

function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token");
}

/**
 * @supabase/ssr always forces a 400-day maxAge onto every cookie it writes
 * (DEFAULT_COOKIE_OPTIONS is spread last, after any cookieOptions we pass).
 * When the user didn't check "remember me", strip maxAge/expires from the
 * auth-token cookie(s) after the library computes them, downgrading them to
 * session cookies that die when the browser closes. Must run last, inside
 * every factory's setAll — passing cookieOptions.maxAge has no effect.
 */
export function applyRememberPolicy(
  name: string,
  options: CookieOptions,
  remembered: boolean,
): CookieOptions {
  if (remembered || !isSupabaseAuthCookie(name)) return options;
  const { maxAge, expires, ...rest } = options;
  return rest;
}
