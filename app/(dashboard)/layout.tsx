import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { AppShell } from "./_components/app-shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // When Supabase isn't configured at all, render the shell without a user so
  // the per-page "Connect Supabase" guides still show (graceful degradation).
  if (!isSupabaseAuthConfigured()) {
    return <AppShell userEmail={null}>{children}</AppShell>;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already gates this, but defend in depth.
  if (!user) redirect("/login");

  return <AppShell userEmail={user.email ?? null}>{children}</AppShell>;
}
