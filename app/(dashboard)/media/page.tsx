import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getSessionUser } from "@/lib/supabase/server";
import {
  getSingleBrand,
  listCompetitorReferences,
  listMediaAssets,
  listStyleReferences,
} from "@/lib/db/queries";
import { Card, LinkButton } from "@/components/ui";
import { ScreenHeader } from "../_components/screen-header";
import { MediaLibraryClient } from "./_components/media-library-client";

export const dynamic = "force-dynamic";

export default async function MediaPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">Connect Supabase</h1>
        <p className="mt-2 text-sm text-muted">
          Fill the SUPABASE_* values in .env.local to load your media library.
        </p>
      </Card>
    );
  }

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const brand = await getSingleBrand(user.id);
  if (!brand) {
    return (
      <Card className="p-7 text-center">
        <h1 className="font-display text-xl font-semibold">No brand yet</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Run onboarding to build your brand profile before saving media.
        </p>
        <LinkButton href="/onboarding" variant="gradient" className="mt-5">
          Start onboarding
        </LinkButton>
      </Card>
    );
  }

  let media, flyerStyles, emailDesigns, competitorRefs;
  try {
    [media, flyerStyles, emailDesigns, competitorRefs] = await Promise.all([
      listMediaAssets(brand.id),
      listStyleReferences(brand.id, "flyer"),
      listStyleReferences(brand.id, "email"),
      listCompetitorReferences(brand.id),
    ]);
  } catch (err) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">
          Couldn't load your media
        </h1>
        <p className="mt-2 text-sm text-muted">
          {err instanceof Error ? err.message : "Try again in a moment."}
        </p>
      </Card>
    );
  }

  return (
    <>
      <ScreenHeader
        title="Media"
        subtitle="Every image you've generated or uploaded, plus your saved flyer and email design references."
      />
      <MediaLibraryClient
        initialMedia={media}
        initialFlyerStyles={flyerStyles}
        initialEmailDesigns={emailDesigns}
        initialCompetitorRefs={competitorRefs}
      />
    </>
  );
}
