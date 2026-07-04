import Link from "next/link";
import { notFound } from "next/navigation";
import { getDraftForReview } from "@/lib/db/queries";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { ScreenHeader } from "../../_components/screen-header";
import { DraftStateBadge } from "../../_components/topic-badges";
import { ReviewActions } from "./_components/review-actions";

export const dynamic = "force-dynamic";

export default async function DraftReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const draft = await getDraftForReview(id);
  if (!draft) notFound();

  return (
    <>
      <Link
        href="/emails"
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon size={15} /> Emails
      </Link>
      <ScreenHeader
        title={draft.topic_title ?? draft.content.subject ?? "Email draft"}
        subtitle={`Version ${draft.version}`}
        actions={<DraftStateBadge state={draft.state} />}
      />
      <ReviewActions
        draftId={draft.id}
        version={draft.version}
        initialContent={draft.content}
        initialMeta={draft.meta}
        seoData={draft.seo_data}
        initialArchived={draft.archived}
      />
    </>
  );
}
