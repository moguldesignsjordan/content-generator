import { createBrowserClient } from "@supabase/ssr";

import { supabaseAnonKey, supabaseUrl } from "./config";

/** Browser-side Supabase auth client (anon key). For client auth flows. */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
