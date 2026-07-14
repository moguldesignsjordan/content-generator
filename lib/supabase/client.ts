import { createBrowserClient } from "@supabase/ssr";
import { parse, serialize } from "cookie";

import { supabaseAnonKey, supabaseUrl } from "./config";
import { applyRememberPolicy, REMEMBER_COOKIE } from "./remember";

function documentCookieGetAll() {
  const parsed = parse(document.cookie);
  return Object.entries(parsed).map(([name, value]) => ({ name, value: value ?? "" }));
}

/**
 * Browser-side Supabase auth client (anon key). For client auth flows.
 *
 * Uses a custom cookie store (mirroring @supabase/ssr's own document.cookie
 * fallback) so the background autoRefreshToken writes can be downgraded to
 * session cookies when the user didn't check "remember me" at /login. See
 * lib/supabase/remember.ts for why cookieOptions.maxAge can't do this alone.
 */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: documentCookieGetAll,
      setAll(cookiesToSet) {
        const remembered = parse(document.cookie)[REMEMBER_COOKIE] === "1";
        cookiesToSet.forEach(({ name, value, options }) => {
          document.cookie = serialize(name, value, applyRememberPolicy(name, options, remembered));
        });
      },
    },
  });
}
