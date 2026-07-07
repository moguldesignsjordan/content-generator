/**
 * Directly set (or create) a user's password with the Supabase service-role
 * key. Bypasses email entirely — the reliable fix when the magic-link /
 * reset-password email flow is broken (redirect-URL mismatch, Vercel
 * Deployment Protection, deliverability, etc.).
 *
 *   npx tsx scripts/reset-password.ts <email> <new-password>
 *
 * Loads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local,
 * same pattern as db/seed.ts. If the user exists, their password is updated;
 * if not, a confirmed user is created. Either way you can then sign in at
 * /login with this email + password.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.argv[2]?.trim().toLowerCase();
  const password = process.argv[3];

  if (!url || !serviceRoleKey) {
    console.error(
      "✗ Missing Supabase env. Fill NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
    process.exit(1);
  }
  if (!email || !password) {
    console.error("Usage: npx tsx scripts/reset-password.ts <email> <new-password>");
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("✗ Password must be at least 6 characters.");
    process.exit(1);
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Find an existing user by email. listUsers is paginated; page through.
  let userId: string | undefined;
  let page = 1;
  while (!userId) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      console.error("✗ Couldn't list users:", error.message);
      process.exit(1);
    }
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
    if (data.users.length < 1000) break;
    page += 1;
  }

  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) {
      console.error("✗ Couldn't update password:", error.message);
      process.exit(1);
    }
    console.log(`✓ Password updated for ${email}.`);
  } else {
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) {
      console.error("✗ Couldn't create user:", error.message);
      process.exit(1);
    }
    console.log(`✓ Created ${email} (email confirmed).`);
  }

  console.log("Sign in at /login with this email + password.");
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err);
  process.exit(1);
});
