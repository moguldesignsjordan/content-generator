import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { isSupabaseConfigured } from "@/lib/db/client";
import { countDraftsInReview, getSingleBrand, getUserRole } from "@/lib/db/queries";
import { availableImageTiers } from "@/lib/clients/image-render";
import { AppShell } from "./_components/app-shell";
import { ImageModelsProvider } from "./_components/image-models-context";

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
      <AppShell userEmail={null} role="user" reviewCount={0}>
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
  // service-role client getUserRole needs). The Review badge is a nicety, so
  // any failure there just hides it.
  const configured = isSupabaseConfigured();
  const [role, reviewCount] = await Promise.all([
    configured ? getUserRole(user.id) : ("user" as const),
    configured ? countReviewFor(user.id).catch(() => 0) : 0,
  ]);

  return (
    <AppShell userEmail={user.email ?? null} role={role} reviewCount={reviewCount}>
      <ImageModelsProvider tiers={availableImageTiers()}>{children}</ImageModelsProvider>
    </AppShell>
  );
}

async function countReviewFor(userId: string): Promise<number> {
  const brand = await getSingleBrand(userId);
  return brand ? countDraftsInReview(brand.id) : 0;
}
