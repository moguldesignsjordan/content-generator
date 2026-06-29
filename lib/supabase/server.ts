import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabaseAnonKey, supabaseUrl } from "./config";

/**
 * Server-side Supabase auth client bound to the request cookies (anon key,
 * RLS-respecting). Used for auth/session checks in Server Components and
 * Server Actions. Data queries still use the service-role client in
 * lib/db/client.ts (single-tenant for now).
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
