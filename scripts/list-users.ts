/** Diagnostic: list every auth user (email, confirmation status, created). */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("✗ Missing Supabase env.");
    process.exit(1);
  }
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    console.error("✗ Couldn't list users:", error.message);
    process.exit(1);
  }
  if (data.users.length === 0) {
    console.log("No auth users exist yet.");
    return;
  }
  console.log(`Auth users (${data.users.length}):`);
  for (const u of data.users) {
    console.log(
      `  - ${u.email}  | confirmed: ${u.email_confirmed_at ? "yes" : "NO"} | created: ${u.created_at} | id: ${u.id}`,
    );
  }
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err);
  process.exit(1);
});
