// Auth-config check, safe to import anywhere (middleware, server, client).
// Distinct from lib/db/client.ts's isSupabaseConfigured(), which gates the
// service-role data client. This gates the anon-key auth client.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when Supabase Auth can run (URL + anon key present). */
export function isSupabaseAuthConfigured(): boolean {
  return Boolean(url && anonKey);
}

export function supabaseUrl(): string {
  return url ?? "";
}

export function supabaseAnonKey(): string {
  return anonKey ?? "";
}
