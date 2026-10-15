import { redirect } from "next/navigation";
import { getDraftStatuses, getSingleBrand, listDrafts } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { EmptyState, LinkButton } from "@/components/ui";
import { REVIEW_DONE_ART } from "../_components/art";
import { ScreenHeader } from "../_components/screen-header";
import { ReviewGrid } from "./_components/review-grid";

export const dynamic = "force-dynamic";

/** Everything waiting for a decision, every kind, in one place. */
export default async function ReviewPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const brand = await getSingleBrand(user.id).catch(() => null);
  if (!brand) redirect("/onboarding");

  const rows = (await listDrafts(brand.id).catch(() => [])).filter(
    (d) => d.state === "in_review" && !d.archived,
  );
  const statuses = await getDraftStatuses(
    brand.id,
    rows.map((r) => r.id),
  ).catch(() => ({}));

  return (
    <>
      <ScreenHeader
        title="Review"
        subtitle="Everything waiting for your approval. Nothing publishes until you approve it."
      />
      {rows.length ? (
        <ReviewGrid
          items={rows.map((r) => ({ id: r.id, title: r.subject || r.topic_title || "Untitled" }))}
          statuses={statuses}
        />
      ) : (
        <EmptyState
          art={REVIEW_DONE_ART}
          title="All caught up"
          action={
            <LinkButton href="/" variant="gradient" size="sm">
              Make something
            </LinkButton>
          }
        >
          Nothing is waiting for your approval. New pieces land here the moment they&apos;re made.
        </EmptyState>
      )}
    </>
  );
}
