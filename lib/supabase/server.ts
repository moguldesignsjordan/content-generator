import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { isSupabaseAuthConfigured, supabaseAnonKey, supabaseUrl } from "./config";

/**
 * The authenticated user for the current request, or null. One lightweight
 * getUser() round trip (Supabase validates the cached JWT); the dashboard
 * middleware + layout already guarantee a user for (dashboard) pages, but each
 * server component / route handler that needs to resolve "this user's brand"
 * for multi-tenancy reads it here. Returns null when Supabase isn't configured
 * (the unconfigured path is dev-only; production fails closed in middleware).
 */
export async function getSessionUser() {
  if (!isSupabaseAuthConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Server-side Supabase auth client bound to the request cookies (anon key,
 * RLS-respecting). Used for auth/session checks in Server Components and
 * Server Actions. Data queries still use the service-role client in
 * lib/db/client.ts.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // The `setAll` method was called from a Server Component where
          // cookies can't be set. This can be ignored if middleware refreshes
          // the session (it does).
        }
      },
    },
  });
}
