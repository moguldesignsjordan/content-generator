import { redirect } from "next/navigation";
import { getDraftStatuses, getSingleBrand, listDrafts } from "@/lib/db/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
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
        <Card className="p-6 text-sm text-muted">
          Nothing to review right now. New pieces show up here as soon as they&apos;re made.
        </Card>
      )}
    </>
  );
}
