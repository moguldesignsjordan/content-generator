import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/db/client";
import {
  getBrandIntegrations,
  getSingleBrand,
  listScheduledSocialPosts,
} from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { providersForKind } from "@/lib/publishing/registry";
import { utcDate } from "@/lib/scheduling/cadence";
import { Card } from "@/components/ui";
import { ScreenHeader } from "../_components/screen-header";
import { SocialQueue } from "./_components/social-queue";

export const dynamic = "force-dynamic";

export default async function SocialPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">Connect Supabase</h1>
        <p className="mt-2 text-sm text-muted">
          Fill the SUPABASE_* values in .env.local to load your social queue.
        </p>
      </Card>
    );
  }

  const user = await getSessionUser();
  if (!user) redirect("/login");
  const brand = await getSingleBrand(user.id);
  if (!brand) redirect("/onboarding");

  // Two weeks back keeps last week's posts visible as "Posted".
  const since = utcDate(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000));
  const [posts, integrations] = await Promise.all([
    listScheduledSocialPosts(brand.id, since),
    getBrandIntegrations(brand.id),
  ]);
  const connected = providersForKind("social")
    .filter((p) => p.isConfigured(brand, integrations.find((i) => i.provider_id === p.id) ?? null))
    .map((p) => p.label);

  return (
    <>
      <ScreenHeader
        title="Social"
        subtitle="This week's posts. Approve them once and each goes out on its day."
      />
      <SocialQueue posts={posts} connected={connected} />
    </>
  );
}
