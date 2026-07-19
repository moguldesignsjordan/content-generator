import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getSingleBrand, listDrafts } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { Card, LinkButton } from "@/components/ui";
import { PlusIcon } from "@/components/ui/icons";
import { ScreenHeader } from "../_components/screen-header";
import { DraftsList } from "../_components/drafts-list";

export const dynamic = "force-dynamic";

export default async function FlyersPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">Connect Supabase</h1>
        <p className="mt-2 text-sm text-muted">
          Fill the SUPABASE_* values in .env.local to load your flyers.
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
          Build your brand profile first, then your flyers will show up here.
        </p>
        <LinkButton href="/onboarding" variant="gradient" className="mt-5">
          Start onboarding
        </LinkButton>
      </Card>
    );
  }

  let drafts: Awaited<ReturnType<typeof listDrafts>>;
  try {
    drafts = await listDrafts(brand.id, { jobType: "social" });
  } catch (err) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">
          Couldn't load flyers
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
        title="Flyers"
        subtitle="Social post designs for Facebook and Instagram. Approve, then download and post."
        actions={
          <LinkButton href="/flyers/new" variant="gradient" size="sm">
            <PlusIcon size={16} /> New flyer
          </LinkButton>
        }
      />
      <DraftsList drafts={drafts} kind="social" />
    </>
  );
}
