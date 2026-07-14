import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getUserRole } from "@/lib/db/queries";
import { AppShell } from "./_components/app-shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // In development with Supabase unconfigured, render the shell without a user
  // so the per-page "Connect Supabase" guides still show (first-run setup). In
  // production auth is mandatory (billing depends on it); middleware already
  // returns 503 there, but defend in depth rather than render an anonymous shell.
  if (!isSupabaseAuthConfigured()) {
    if (process.env.NODE_ENV !== "development") {
      redirect("/login");
    }
    return (
      <AppShell userEmail={null} role="user">
        {children}
      </AppShell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already gates this, but defend in depth.
  if (!user) redirect("/login");

  // Role gates admin-only nav (Logs). Fail closed to 'user' if the
  // user_profiles table isn't migrated yet (isSupabaseConfigured checks the
  // service-role client getUserRole needs).
  const role = isSupabaseConfigured() ? await getUserRole(user.id) : "user";

  return (
    <AppShell userEmail={user.email ?? null} role={role}>
      {children}
    </AppShell>
  );
}
