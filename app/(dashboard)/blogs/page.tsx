import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/db/client";
import { getSingleBrand, listDrafts } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { Card, LinkButton } from "@/components/ui";
import { ScreenHeader } from "../_components/screen-header";
import { DraftsList } from "../_components/drafts-list";

export const dynamic = "force-dynamic";

export default async function BlogsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">Connect Supabase</h1>
        <p className="mt-2 text-sm text-muted">
          Fill the SUPABASE_* values in .env.local to load your blog posts.
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
          Build your brand profile first, then your blog posts will show up here.
        </p>
        <LinkButton href="/onboarding" variant="gradient" className="mt-5">
          Start onboarding
        </LinkButton>
      </Card>
    );
  }

  let drafts: Awaited<ReturnType<typeof listDrafts>>;
  try {
    drafts = await listDrafts(brand.id, { jobType: "blog" });
  } catch (err) {
    return (
      <Card className="p-7">
        <h1 className="font-display text-xl font-semibold">
          Couldn't load blog posts
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
        title="Blogs"
        subtitle="Every blog post, newest first. Tap to review and send to Sanity."
      />
      <DraftsList drafts={drafts} kind="blog" />
    </>
  );
}
