import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Server-only Supabase clients.
//
// `server-only` makes the build fail loudly if any of this is ever imported into
// a Client Component, the service-role key must never reach the browser bundle
// (Guardrail #1).
//
// v1 is a single-brand internal tool with no end-user auth yet, so reads/writes
// run with the service-role key on the server. When auth lands (plan Phase 4)
// switch user-scoped reads to the anon key + RLS.
// ─────────────────────────────────────────────────────────────────────────────

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** True once the three Supabase env vars are filled in (see .env.local). */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && serviceRoleKey);
}

let cached: SupabaseClient | null = null;

/**
 * Admin client (service role, bypasses RLS). Server code only.
 * Throws if env isn't configured, callers that want to render a "connect
 * Supabase" state should gate on `isSupabaseConfigured()` first.
 */
export function getAdminClient(): SupabaseClient {
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase env not set. Fill NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }
  if (!cached) {
    cached = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
